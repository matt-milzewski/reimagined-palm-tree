import { Pool } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

interface DbCredentials {
  username: string;
  password: string;
}

export interface SearchResult {
  chunk_id: string;
  doc_id: string;
  filename: string;
  page: number | null;
  chunk_index: number;
  text: string;
  source_uri: string;
  content_hash: string;
  doc_type: string | null;
  discipline: string | null;
  section_reference: string | null;
  standards_referenced: string[] | null;
  score: number;
}

export type SearchFilters = {
  docTypes?: string[];
  disciplines?: string[];
  standards?: string[];
};

let pool: Pool | null = null;
const secretsClient = new SecretsManagerClient({});

async function getDbCredentials(): Promise<DbCredentials> {
  const secretArn = process.env.DB_SECRET_ARN || '';
  if (!secretArn) {
    throw new Error('Missing DB_SECRET_ARN environment variable');
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  if (!response.SecretString) {
    throw new Error('Failed to retrieve database credentials');
  }

  return JSON.parse(response.SecretString);
}

async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  const credentials = await getDbCredentials();

  pool = new Pool({
    host: process.env.DB_HOST || '',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'ragready',
    user: credentials.username,
    password: credentials.password,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  return pool;
}

export async function vectorSearch(params: {
  tenantId: string;
  datasetId: string;
  vector: number[];
  topK: number;
  filters?: SearchFilters;
  excludeDocIds?: string[];
}): Promise<SearchResult[]> {
  const { tenantId, datasetId, vector, topK, filters, excludeDocIds } = params;
  const db = await getPool();

  // Format vector as PostgreSQL array string for pgvector
  const vectorStr = `[${vector.join(',')}]`;

  const conditions = ['tenant_id = $2', 'dataset_id = $3'];
  const values: Array<string | number | string[]> = [vectorStr, tenantId, datasetId];
  let paramIndex = 4;

  if (filters?.docTypes?.length) {
    conditions.push(`doc_type = ANY($${paramIndex}::text[])`);
    values.push(filters.docTypes);
    paramIndex += 1;
  }

  if (filters?.disciplines?.length) {
    conditions.push(`discipline = ANY($${paramIndex}::text[])`);
    values.push(filters.disciplines);
    paramIndex += 1;
  }

  if (filters?.standards?.length) {
    conditions.push(`standards_referenced && $${paramIndex}::text[]`);
    values.push(filters.standards);
    paramIndex += 1;
  }

  if (excludeDocIds?.length) {
    conditions.push(`doc_id <> ALL($${paramIndex}::text[])`);
    values.push(excludeDocIds);
    paramIndex += 1;
  }

  const limitParam = `$${paramIndex}`;
  values.push(topK);

  const result = await db.query<SearchResult>(
    `
    SELECT
      chunk_id, doc_id, filename, page, chunk_index, text,
      source_uri, content_hash, doc_type, discipline,
      section_reference, standards_referenced,
      1 - (embedding <=> $1::vector) AS score
    FROM chunks
    WHERE ${conditions.join(' AND ')}
    ORDER BY embedding <=> $1::vector
    LIMIT ${limitParam}
    `,
    values
  );

  return result.rows;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function deleteDatasetChunks(tenantId: string, datasetId: string): Promise<void> {
  const db = await getPool();
  await db.query('DELETE FROM chunks WHERE tenant_id = $1 AND dataset_id = $2', [tenantId, datasetId]);
}
