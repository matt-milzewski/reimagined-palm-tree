import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb } from '../../shared/ddb';
import { getTenantContext } from '../../shared/auth';
import { log } from '../../shared/logger';
import { newId } from '../../shared/ids';
import { vectorSearch } from './postgres';
import { validateDatasetForChat } from './chat-utils';

const s3 = new S3Client({});
const ses = new SESv2Client({});
const bedrock = new BedrockRuntimeClient({});

const DATASETS_TABLE = process.env.DATASETS_TABLE || '';
const FILES_TABLE = process.env.FILES_TABLE || '';
const JOBS_TABLE = process.env.JOBS_TABLE || '';
const AUDIT_TABLE = process.env.AUDIT_TABLE || '';
const RAW_BUCKET = process.env.RAW_BUCKET || '';
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET || '';
const CONTACT_RECIPIENT_EMAIL = process.env.CONTACT_RECIPIENT_EMAIL || '';
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || '';
const BEDROCK_EMBED_MODEL_ID = process.env.BEDROCK_EMBED_MODEL_ID || '';
const BEDROCK_CHAT_MODEL_ID = process.env.BEDROCK_CHAT_MODEL_ID || '';
const EMBEDDING_DIMENSION = Number.parseInt(process.env.EMBEDDING_DIMENSION || '0', 10);
const CHAT_TOP_K_DEFAULT = Number.parseInt(process.env.CHAT_TOP_K_DEFAULT || '8', 10);
const CONVERSATIONS_TABLE = process.env.CONVERSATIONS_TABLE || '';
const MESSAGES_TABLE = process.env.MESSAGES_TABLE || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body)
  };
}

function parseJson(body?: string | null): any {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readBody(body: any): Promise<string> {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf-8');
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf-8');
  if (typeof body.transformToString === 'function') {
    return await body.transformToString();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function embedQuery(text: string): Promise<number[]> {
  if (!BEDROCK_EMBED_MODEL_ID) {
    throw new Error('Missing Bedrock model configuration.');
  }
  const command = new InvokeModelCommand({
    modelId: BEDROCK_EMBED_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: text })
  });
  const response = await bedrock.send(command);
  const payload = JSON.parse(await readBody(response.body));
  const embedding = payload.embedding || (Array.isArray(payload.embeddings) ? payload.embeddings[0] : payload.vector);
  if (!embedding) {
    throw new Error('Unsupported embedding response format.');
  }
  if (EMBEDDING_DIMENSION && embedding.length !== EMBEDDING_DIMENSION) {
    throw new Error('Embedding dimension mismatch.');
  }
  return embedding;
}

type Citation = {
  chunk_id: string;
  filename: string;
  page?: number | null;
  snippet?: string;
  score?: number;
  doc_id?: string;
  // Construction-specific metadata
  doc_type?: string;
  discipline?: string;
  section_reference?: string;
  standards_referenced?: string[];
};

const chatSystemPrompt = [
  'You are RagReady, an AI assistant specializing in Australian construction documentation.',
  '',
  'CONTEXT:',
  '- You assist construction professionals (project managers, site supervisors, engineers, estimators, contract administrators)',
  '- Documents include specifications, contracts, SWMS, ITPs, drawings, RFIs, variations, and correspondence',
  '- Australian standards (AS, AS/NZS, BCA, NCC) are authoritative references',
  '',
  'RESPONSE GUIDELINES:',
  '1. Always cite sources using [S1], [S2] format - cite at the end of each relevant sentence or claim',
  '2. For safety-related queries, emphasize WHS requirements and highlight any hazards or controls mentioned',
  '3. For contract queries, note if clauses reference other sections and flag any time-critical requirements',
  '4. For technical specs, include relevant Australian standard references when mentioned in sources',
  '5. If information appears dated, mention the document date if visible in sources',
  '6. Prefer concise answers with bullet points for lists and step-by-step procedures',
  '',
  'CONSTRUCTION TERMINOLOGY (interpret these correctly):',
  '- PC = Practical Completion (not Personal Computer)',
  '- EOT = Extension of Time',
  '- VO = Variation Order',
  '- DLP = Defects Liability Period',
  '- PCBU = Person Conducting Business or Undertaking (WHS Act)',
  '- SWMS = Safe Work Method Statement',
  '- ITP = Inspection Test Plan',
  '- RFI = Request for Information',
  '- NCC/BCA = National Construction Code / Building Code of Australia',
  '- Head Contractor = Main/Principal Contractor',
  '',
  'If you cannot find the answer in the sources, say:',
  '"I couldn\'t find this information in your uploaded documents. You may need to check [suggest document type] or contact [relevant party]."'
].join('\n');

// Construction abbreviations for query expansion
const CONSTRUCTION_ABBREVIATIONS: Record<string, string> = {
  'SWMS': 'Safe Work Method Statement',
  'ITP': 'Inspection Test Plan',
  'EOT': 'Extension of Time',
  'VO': 'Variation Order',
  'PC': 'Practical Completion',
  'DLP': 'Defects Liability Period',
  'RFI': 'Request for Information',
  'TQ': 'Technical Query',
  'NCR': 'Non-Conformance Report',
  'WHS': 'Work Health and Safety',
  'PPE': 'Personal Protective Equipment',
  'PCBU': 'Person Conducting Business or Undertaking',
  'NCC': 'National Construction Code',
  'BCA': 'Building Code of Australia',
};

function expandConstructionQuery(query: string): string {
  let expanded = query;
  // Expand known abbreviations in the query for better retrieval
  for (const [abbr, full] of Object.entries(CONSTRUCTION_ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    if (regex.test(query)) {
      // Add the expansion to improve semantic matching
      expanded = `${expanded} (${full})`;
      break; // Only expand the first match to avoid overly long queries
    }
  }
  return expanded;
}

function normalizeSnippet(text: string, maxLength: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength).trim()}...`;
}

function buildCitations(hits: any[]): { citations: Citation[]; sourcesText: string } {
  const citations: Citation[] = [];
  const sources: string[] = [];

  hits.forEach((hit, index) => {
    const source = hit?._source || {};
    const rawText = typeof source.text === 'string' ? source.text : '';
    const snippet = normalizeSnippet(rawText, 260);
    const contextText = normalizeSnippet(rawText, 1200);
    const filename = source.filename || 'source';
    const page = source.page ?? null;
    const pageLabel = page !== null && page !== undefined ? ` p${page}` : '';

    // Extract construction metadata from the source
    const docType = source.doc_type || undefined;
    const discipline = source.discipline || undefined;
    const sectionRef = source.section_reference || undefined;
    const standards = source.standards_referenced || undefined;

    citations.push({
      chunk_id: source.chunk_id || hit._id,
      filename,
      page,
      doc_id: source.doc_id,
      score: hit._score ?? 0,
      snippet,
      doc_type: docType,
      discipline: discipline,
      section_reference: sectionRef,
      standards_referenced: standards
    });

    // Build source label with document type if available
    const docTypeLabel = docType ? ` [${docType.toUpperCase()}]` : '';
    const sectionLabel = sectionRef ? ` §${sectionRef}` : '';
    sources.push(`[S${index + 1}] ${filename}${docTypeLabel}${pageLabel}${sectionLabel}\n${contextText}`);
  });

  return { citations, sourcesText: sources.join('\n\n') };
}

function buildChatPrompt(question: string, sourcesText: string): string {
  return `Question:\n${question}\n\nSources:\n${sourcesText}\n\nAnswer:`;
}

async function invokeChatModel(prompt: string): Promise<string> {
  if (!BEDROCK_CHAT_MODEL_ID) {
    throw new Error('Missing Bedrock chat model configuration.');
  }

  let body = '';
  const modelId = BEDROCK_CHAT_MODEL_ID;

  if (modelId.startsWith('anthropic.')) {
    body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 800,
      temperature: 0.2,
      system: chatSystemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });
  } else if (modelId.startsWith('amazon.titan-text')) {
    body = JSON.stringify({
      inputText: `${chatSystemPrompt}\n\n${prompt}`,
      textGenerationConfig: { maxTokenCount: 800, temperature: 0.2, topP: 0.9 }
    });
  } else {
    body = JSON.stringify({ inputText: `${chatSystemPrompt}\n\n${prompt}` });
  }

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body
  });
  const response = await bedrock.send(command);
  const payload = JSON.parse(await readBody(response.body));

  if (modelId.startsWith('anthropic.')) {
    const content = Array.isArray(payload.content) ? payload.content : [];
    const text = content.map((part: any) => part.text || '').join('');
    if (text) return text;
    if (payload.completion) return payload.completion;
  }

  if (payload.results?.[0]?.outputText) return payload.results[0].outputText;
  if (payload.outputText) return payload.outputText;

  throw new Error('Unsupported chat model response format.');
}

function getPath(event: APIGatewayProxyEvent): string {
  if (event.pathParameters?.proxy) {
    return `/${event.pathParameters.proxy}`;
  }
  const rawPath = event.path || '/';
  const stage = event.requestContext?.stage;
  if (stage && rawPath.startsWith(`/${stage}`)) {
    const trimmed = rawPath.slice(stage.length + 1);
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
  return rawPath;
}

async function putAudit(
  tenantId: string,
  type: string,
  metadata: Record<string, unknown>,
  actor?: string
): Promise<void> {
  const createdAt = nowIso();
  const eventId = newId();
  await ddb.send(
    new PutCommand({
      TableName: AUDIT_TABLE,
      Item: {
        tenantId,
        createdAtEventId: `${createdAt}#${eventId}`,
        eventId,
        type,
        createdAt,
        metadata: { ...metadata, actor }
      }
    })
  );
}

async function handleGetMe(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  return jsonResponse(200, {
    tenantId,
    email,
    username
  });
}

async function handleListDatasets(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { tenantId } = getTenantContext(event);

  const result = await ddb.send(
    new QueryCommand({
      TableName: DATASETS_TABLE,
      KeyConditionExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: { ':tenantId': tenantId }
    })
  );

  return jsonResponse(200, {
    datasets: result.Items || []
  });
}

async function handleCreateDataset(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  const body = parseJson(event.body);

  if (!body.name || typeof body.name !== 'string') {
    return jsonResponse(400, { message: 'Dataset name is required.' });
  }

  const datasetId = newId();
  const createdAt = nowIso();
  const updatedAt = createdAt;

  await ddb.send(
    new PutCommand({
      TableName: DATASETS_TABLE,
      Item: {
        tenantId,
        datasetId,
        name: body.name.trim(),
        createdAt,
        updatedAt,
        status: 'UPLOADED'
      }
    })
  );

  await putAudit(tenantId, 'DATASET_CREATED', { datasetId, name: body.name.trim() }, email || username || tenantId);

  return jsonResponse(201, { datasetId, name: body.name.trim(), createdAt });
}

async function handleListFiles(event: APIGatewayProxyEvent, datasetId: string): Promise<APIGatewayProxyResult> {
  const { tenantId } = getTenantContext(event);
  const tenantDatasetId = `${tenantId}#${datasetId}`;

  const result = await ddb.send(
    new QueryCommand({
      TableName: FILES_TABLE,
      KeyConditionExpression: 'tenantDatasetId = :td',
      ExpressionAttributeValues: { ':td': tenantDatasetId }
    })
  );

  return jsonResponse(200, { files: result.Items || [] });
}

async function handlePresign(event: APIGatewayProxyEvent, datasetId: string): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  const body = parseJson(event.body);

  if (!body.filename || typeof body.filename !== 'string') {
    return jsonResponse(400, { message: 'filename is required.' });
  }
  if (!body.contentType || typeof body.contentType !== 'string') {
    return jsonResponse(400, { message: 'contentType is required.' });
  }

  const dataset = await ddb.send(
    new GetCommand({
      TableName: DATASETS_TABLE,
      Key: { tenantId, datasetId }
    })
  );

  if (!dataset.Item) {
    return jsonResponse(404, { message: 'Dataset not found.' });
  }

  const fileId = newId();
  const createdAt = nowIso();
  const rawS3Key = `raw/${tenantId}/${datasetId}/${fileId}/${body.filename}`;
  const tenantDatasetId = `${tenantId}#${datasetId}`;

  await ddb.send(
    new UpdateCommand({
      TableName: DATASETS_TABLE,
      Key: { tenantId, datasetId },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': 'UPLOADED', ':updatedAt': createdAt }
    })
  );

  await ddb.send(
    new PutCommand({
      TableName: FILES_TABLE,
      Item: {
        tenantDatasetId,
        fileId,
        tenantId,
        datasetId,
        filename: body.filename,
        contentType: body.contentType,
        rawS3Key,
        createdAt,
        status: 'UPLOADED_PENDING'
      }
    })
  );

  const putCommand = new PutObjectCommand({
    Bucket: RAW_BUCKET,
    Key: rawS3Key,
    ContentType: body.contentType,
    ServerSideEncryption: 'AES256'
  });

  const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 900 });

  await putAudit(tenantId, 'UPLOAD', { datasetId, fileId, filename: body.filename }, email || username || tenantId);

  return jsonResponse(200, {
    fileId,
    uploadUrl,
    rawS3Key
  });
}

async function handleGetFile(event: APIGatewayProxyEvent, datasetId: string, fileId: string): Promise<APIGatewayProxyResult> {
  const { tenantId } = getTenantContext(event);
  const tenantDatasetId = `${tenantId}#${datasetId}`;

  const fileResult = await ddb.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { tenantDatasetId, fileId }
    })
  );

  if (!fileResult.Item) {
    return jsonResponse(404, { message: 'File not found.' });
  }

  let job = null;
  if (fileResult.Item.latestJobId) {
    const jobResult = await ddb.send(
      new GetCommand({
        TableName: JOBS_TABLE,
        Key: { tenantFileId: `${tenantId}#${fileId}`, jobId: fileResult.Item.latestJobId }
      })
    );
    job = jobResult.Item || null;
  }

  return jsonResponse(200, { file: fileResult.Item, job });
}

async function handleGetJob(event: APIGatewayProxyEvent, datasetId: string, fileId: string, jobId: string): Promise<APIGatewayProxyResult> {
  const { tenantId } = getTenantContext(event);

  const result = await ddb.send(
    new GetCommand({
      TableName: JOBS_TABLE,
      Key: { tenantFileId: `${tenantId}#${fileId}`, jobId }
    })
  );

  if (!result.Item || result.Item.datasetId !== datasetId) {
    return jsonResponse(404, { message: 'Job not found.' });
  }

  return jsonResponse(200, { job: result.Item });
}

async function handleDownload(
  event: APIGatewayProxyEvent,
  datasetId: string,
  fileId: string,
  jobId: string
): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  const type = event.queryStringParameters?.type;

  const result = await ddb.send(
    new GetCommand({
      TableName: JOBS_TABLE,
      Key: { tenantFileId: `${tenantId}#${fileId}`, jobId }
    })
  );

  if (!result.Item || result.Item.datasetId !== datasetId) {
    return jsonResponse(404, { message: 'Job not found.' });
  }

  const artifacts = result.Item.artifacts || {};
  const keyMap: Record<string, string | undefined> = {
    extracted: artifacts.extractedTextKey,
    document: artifacts.documentJsonKey,
    chunks: artifacts.chunksJsonlKey,
    quality: artifacts.qualityReportKey
  };

  if (!type || !keyMap[type]) {
    return jsonResponse(400, { message: 'Invalid or missing download type.' });
  }

  const getCommand = new GetObjectCommand({
    Bucket: PROCESSED_BUCKET,
    Key: keyMap[type]
  });

  const url = await getSignedUrl(s3, getCommand, { expiresIn: 900 });

  await putAudit(tenantId, 'DOWNLOAD', { datasetId, fileId, jobId, type }, email || username || tenantId);

  return jsonResponse(200, { url });
}

async function handlePublicContact(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = parseJson(event.body);

  if (!body.name || !body.email || !body.company || !body.segment || !body.goal || !body.volume) {
    return jsonResponse(400, { message: 'Missing required fields.' });
  }
  if (!Array.isArray(body.storage) || body.storage.length === 0) {
    return jsonResponse(400, { message: 'Storage selection is required.' });
  }

  const recipient = CONTACT_RECIPIENT_EMAIL || CONTACT_FROM_EMAIL;
  const fromEmail = CONTACT_FROM_EMAIL || CONTACT_RECIPIENT_EMAIL;
  if (!recipient || !fromEmail) {
    log('ERROR', 'Contact email not configured');
    return jsonResponse(500, { message: 'Contact email not configured.' });
  }

  const submittedAt = nowIso();
  const emailBody = [
    'New contact request',
    `Name: ${body.name}`,
    `Company: ${body.company}`,
    `Email: ${body.email}`,
    `Phone: ${body.phone || 'Not provided'}`,
    `Segment: ${body.segment}`,
    `Goal: ${body.goal}`,
    `Document volume: ${body.volume}`,
    `Storage: ${body.storage.join(', ')}`,
    `Submitted at: ${submittedAt}`
  ].join('\n');

  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: fromEmail,
      Destination: { ToAddresses: [recipient] },
      Content: {
        Simple: {
          Subject: { Data: 'RagReady contact request' },
          Body: { Text: { Data: emailBody } }
        }
      }
    })
  );

  log('INFO', 'Public contact submission delivered', {
    name: body.name,
    company: body.company,
    email: body.email,
    phone: body.phone,
    segment: body.segment,
    goal: body.goal,
    volume: body.volume,
    storage: body.storage,
    submittedAt
  });

  return jsonResponse(200, { ok: true });
}

async function handleDocumentPresign(event: APIGatewayProxyEvent, docId: string): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  const datasetId = event.queryStringParameters?.datasetId;

  if (!datasetId) {
    return jsonResponse(400, { message: 'datasetId is required.' });
  }
  if (!RAW_BUCKET) {
    return jsonResponse(500, { message: 'Raw bucket not configured.' });
  }

  const tenantDatasetId = `${tenantId}#${datasetId}`;
  const result = await ddb.send(
    new GetCommand({
      TableName: FILES_TABLE,
      Key: { tenantDatasetId, fileId: docId }
    })
  );

  if (!result.Item) {
    return jsonResponse(404, { message: 'Document not found.' });
  }

  const rawKey =
    result.Item.rawS3Key ||
    `raw/${tenantId}/${datasetId}/${docId}/${result.Item.filename || 'document.pdf'}`;

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: RAW_BUCKET,
      Key: rawKey
    }),
    { expiresIn: 300 }
  );

  await putAudit(tenantId, 'DOWNLOAD_SOURCE', { datasetId, fileId: docId }, email || username || tenantId);

  return jsonResponse(200, { url, expires_in: 300 });
}

async function handleRagQuery(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { tenantId } = getTenantContext(event);
  const body = parseJson(event.body);
  const datasetId = body.dataset_id || body.datasetId;
  const query = typeof body.query === 'string' ? body.query.trim() : body.query;
  const topK = Number.isFinite(body.top_k) ? Math.max(1, Math.min(body.top_k, 20)) : 8;

  if (!datasetId || typeof datasetId !== 'string') {
    return jsonResponse(400, { message: 'dataset_id is required.' });
  }
  if (!query || typeof query !== 'string') {
    return jsonResponse(400, { message: 'query is required.' });
  }

  const vector = await embedQuery(query);

  // Use PostgreSQL pgvector for similarity search
  const hits = await vectorSearch({
    tenantId,
    datasetId,
    vector,
    topK
  });

  const results = hits.map((hit) => ({
    text: hit.text || '',
    score: hit.score || 0,
    citation: {
      filename: hit.filename,
      page: hit.page ?? null,
      chunk_id: hit.chunk_id,
      doc_id: hit.doc_id
    }
  }));

  return jsonResponse(200, { results });
}

async function handleChat(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const { tenantId, email, username } = getTenantContext(event);
  const body = parseJson(event.body);
  const datasetId = body.dataset_id || body.datasetId;
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const topK = Number.isFinite(body.top_k)
    ? Math.max(1, Math.min(Number(body.top_k), 20))
    : Math.max(1, Math.min(CHAT_TOP_K_DEFAULT || 8, 20));

  if (!datasetId || typeof datasetId !== 'string') {
    return jsonResponse(400, { message: 'dataset_id is required.' });
  }
  if (!message) {
    return jsonResponse(400, { message: 'message is required.' });
  }
  if (!CONVERSATIONS_TABLE || !MESSAGES_TABLE) {
    return jsonResponse(500, { message: 'Chat storage not configured.' });
  }

  const datasetResult = await ddb.send(
    new GetCommand({
      TableName: DATASETS_TABLE,
      Key: { tenantId, datasetId }
    })
  );

  const datasetValidation = validateDatasetForChat(tenantId, datasetResult.Item as Record<string, any> | undefined);
  if (!datasetValidation.ok) {
    return jsonResponse(datasetValidation.statusCode, { message: datasetValidation.message });
  }

  let conversationId = body.conversation_id || body.conversationId;
  const now = nowIso();
  if (conversationId) {
    const existing = await ddb.send(
      new GetCommand({
        TableName: CONVERSATIONS_TABLE,
        Key: { tenantId, conversationId }
      })
    );
    if (!existing.Item) {
      return jsonResponse(404, { message: 'Conversation not found.' });
    }
    if (existing.Item.datasetId !== datasetId) {
      return jsonResponse(409, { message: 'Conversation dataset mismatch.' });
    }
  } else {
    conversationId = newId();
    await ddb.send(
      new PutCommand({
        TableName: CONVERSATIONS_TABLE,
        Item: {
          tenantId,
          conversationId,
          datasetId,
          title: message.slice(0, 60),
          createdAt: now,
          updatedAt: now
        }
      })
    );
  }

  const userMessageId = newId();
  const userCreatedAt = nowIso();
  await ddb.send(
    new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: {
        tenantConversationId: `${tenantId}#${conversationId}`,
        createdAtMessageId: `${userCreatedAt}#${userMessageId}`,
        messageId: userMessageId,
        conversationId,
        tenantId,
        datasetId,
        role: 'user',
        content: message,
        createdAt: userCreatedAt
      }
    })
  );

  // Expand query with construction terminology for better retrieval
  const expandedQuery = expandConstructionQuery(message);
  const vector = await embedQuery(expandedQuery);

  // Use PostgreSQL pgvector for similarity search
  const pgHits = await vectorSearch({
    tenantId,
    datasetId,
    vector,
    topK
  });

  // Transform PostgreSQL results to match expected format for buildCitations
  const hits = pgHits.map((hit) => ({
    _id: hit.chunk_id,
    _score: hit.score,
    _source: {
      chunk_id: hit.chunk_id,
      doc_id: hit.doc_id,
      filename: hit.filename,
      page: hit.page,
      text: hit.text,
      doc_type: hit.doc_type,
      discipline: hit.discipline,
      section_reference: hit.section_reference,
      standards_referenced: hit.standards_referenced
    }
  }));

  const { citations, sourcesText } = buildCitations(hits);

  let answer = 'I do not know based on the available sources.';
  if (citations.length > 0) {
    const prompt = buildChatPrompt(message, sourcesText);
    answer = await invokeChatModel(prompt);
  }

  const assistantMessageId = newId();
  const assistantCreatedAt = nowIso();
  await ddb.send(
    new PutCommand({
      TableName: MESSAGES_TABLE,
      Item: {
        tenantConversationId: `${tenantId}#${conversationId}`,
        createdAtMessageId: `${assistantCreatedAt}#${assistantMessageId}`,
        messageId: assistantMessageId,
        conversationId,
        tenantId,
        datasetId,
        role: 'assistant',
        content: answer,
        citations,
        createdAt: assistantCreatedAt
      }
    })
  );

  await ddb.send(
    new UpdateCommand({
      TableName: CONVERSATIONS_TABLE,
      Key: { tenantId, conversationId },
      UpdateExpression: 'SET updatedAt = :u',
      ExpressionAttributeValues: { ':u': assistantCreatedAt }
    })
  );

  await putAudit(
    tenantId,
    'CHAT_MESSAGE',
    { datasetId, conversationId, messageId: assistantMessageId },
    email || username || tenantId
  );

  return jsonResponse(200, {
    conversation_id: conversationId,
    message_id: assistantMessageId,
    answer,
    citations
  });
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    const path = getPath(event);
    const method = event.httpMethod;

    if (path === '/public/contact' && method === 'POST') {
      return await handlePublicContact(event);
    }

    if (path === '/chat' && method === 'POST') {
      return await handleChat(event);
    }

    if (path === '/rag/query' && method === 'POST') {
      return await handleRagQuery(event);
    }

    const documentPresignMatch = path.match(/^\/documents\/([^/]+)\/presign$/);
    if (documentPresignMatch && method === 'GET') {
      return await handleDocumentPresign(event, documentPresignMatch[1]);
    }

    if (path === '/me' && method === 'GET') {
      return await handleGetMe(event);
    }

    if (path === '/datasets' && method === 'GET') {
      return await handleListDatasets(event);
    }

    if (path === '/datasets' && method === 'POST') {
      return await handleCreateDataset(event);
    }

    const datasetFilesMatch = path.match(/^\/datasets\/([^/]+)\/files$/);
    if (datasetFilesMatch && method === 'GET') {
      return await handleListFiles(event, datasetFilesMatch[1]);
    }

    const presignMatch = path.match(/^\/datasets\/([^/]+)\/files\/presign$/);
    if (presignMatch && method === 'POST') {
      return await handlePresign(event, presignMatch[1]);
    }

    const fileMatch = path.match(/^\/datasets\/([^/]+)\/files\/([^/]+)$/);
    if (fileMatch && method === 'GET') {
      return await handleGetFile(event, fileMatch[1], fileMatch[2]);
    }

    const jobMatch = path.match(/^\/datasets\/([^/]+)\/files\/([^/]+)\/jobs\/([^/]+)$/);
    if (jobMatch && method === 'GET') {
      return await handleGetJob(event, jobMatch[1], jobMatch[2], jobMatch[3]);
    }

    const downloadMatch = path.match(/^\/datasets\/([^/]+)\/files\/([^/]+)\/jobs\/([^/]+)\/download$/);
    if (downloadMatch && method === 'GET') {
      return await handleDownload(event, downloadMatch[1], downloadMatch[2], downloadMatch[3]);
    }

    return jsonResponse(404, { message: 'Not found' });
  } catch (error) {
    if ((error as Error).message === 'Invalid JSON body') {
      return jsonResponse(400, { message: 'Invalid JSON body.' });
    }
    log('ERROR', 'API handler failed', { error: (error as Error).message });
    return jsonResponse(500, { message: (error as Error).message || 'Internal error' });
  }
};
