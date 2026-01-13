import { SignatureV4 } from '@aws-sdk/signature-v4';
import { HttpRequest } from '@aws-sdk/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-sdk/hash-node';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';

type OpenSearchResponse = {
  status: number;
  body: string;
};

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

function ensureEndpoint(endpoint: string): URL {
  const value = endpoint.startsWith('http') ? endpoint : `https://${endpoint}`;
  return new URL(value);
}

async function streamToString(stream: any): Promise<string> {
  if (!stream) return '';
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function openSearchRequest(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json'
): Promise<OpenSearchResponse> {
  const endpoint = process.env.OPENSEARCH_COLLECTION_ENDPOINT || '';
  if (!endpoint) {
    throw new Error('Missing OpenSearch endpoint configuration.');
  }

  const url = ensureEndpoint(endpoint);
  const safePath = path.startsWith('/') ? path : `/${path}`;
  const request = new HttpRequest({
    method,
    protocol: url.protocol,
    hostname: url.hostname,
    path: safePath,
    headers: {
      host: url.hostname,
      'content-type': contentType
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined
  });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region,
    service: 'aoss',
    sha256: Sha256
  });
  const signed = await signer.sign(request);
  const handler = new NodeHttpHandler();
  const { response } = await handler.handle(signed);
  const bodyText = await streamToString(response.body);
  return { status: response.statusCode || 0, body: bodyText };
}

export function buildKnnQuery(params: {
  tenantId: string;
  datasetId: string;
  vector: number[];
  topK: number;
}): Record<string, unknown> {
  const k = Math.max(20, params.topK * 3);
  return {
    size: params.topK,
    query: {
      bool: {
        filter: [
          { term: { tenant_id: params.tenantId } },
          { term: { dataset_id: params.datasetId } }
        ],
        must: [
          {
            knn: {
              vector: {
                vector: params.vector,
                k
              }
            }
          }
        ]
      }
    }
  };
}
