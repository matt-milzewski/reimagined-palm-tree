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
import { buildKnnQuery, openSearchRequest } from './opensearch';

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
const OPENSEARCH_INDEX_NAME = process.env.OPENSEARCH_INDEX_NAME || '';
const BEDROCK_EMBED_MODEL_ID = process.env.BEDROCK_EMBED_MODEL_ID || '';
const EMBEDDING_DIMENSION = Number.parseInt(process.env.EMBEDDING_DIMENSION || '0', 10);

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
  if (!OPENSEARCH_INDEX_NAME) {
    return jsonResponse(500, { message: 'Vector index not configured.' });
  }

  const vector = await embedQuery(query);
  const searchPayload = buildKnnQuery({
    tenantId,
    datasetId,
    vector,
    topK
  });

  const response = await openSearchRequest('POST', `/${OPENSEARCH_INDEX_NAME}/_search`, searchPayload);
  if (response.status >= 300) {
    log('ERROR', 'OpenSearch query failed', { status: response.status, body: response.body });
    return jsonResponse(500, { message: 'Vector query failed.' });
  }

  const payload = response.body ? JSON.parse(response.body) : {};
  const hits = payload.hits?.hits || [];
  const results = hits.map((hit: any) => ({
    text: hit._source?.text || '',
    score: hit._score || 0,
    citation: {
      filename: hit._source?.filename,
      page: hit._source?.page ?? null,
      source_uri: hit._source?.source_uri,
      chunk_id: hit._source?.chunk_id,
      doc_id: hit._source?.doc_id
    }
  }));

  return jsonResponse(200, { results });
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

    if (path === '/rag/query' && method === 'POST') {
      return await handleRagQuery(event);
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
