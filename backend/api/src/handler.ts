import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ddb } from '../../shared/ddb';
import { getTenantContext } from '../../shared/auth';
import { log } from '../../shared/logger';
import { newId } from '../../shared/ids';

const s3 = new S3Client({});

const DATASETS_TABLE = process.env.DATASETS_TABLE || '';
const FILES_TABLE = process.env.FILES_TABLE || '';
const JOBS_TABLE = process.env.JOBS_TABLE || '';
const AUDIT_TABLE = process.env.AUDIT_TABLE || '';
const RAW_BUCKET = process.env.RAW_BUCKET || '';
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET || '';

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

  await ddb.send(
    new PutCommand({
      TableName: DATASETS_TABLE,
      Item: {
        tenantId,
        datasetId,
        name: body.name.trim(),
        createdAt
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

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    const proxyPath = event.pathParameters?.proxy || '';
    const path = `/${proxyPath}`;
    const method = event.httpMethod;

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
