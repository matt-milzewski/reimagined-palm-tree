# RagReady

RagReady is a production style SaaS starter that ingests construction documents, cleans and normalises them, and produces RAG ready outputs. It includes a static marketing site, an authenticated app, and an automated processing pipeline on AWS.

## What this repo includes
- Static marketing site at `/` plus `/contact`
- Authenticated app at `/login` with datasets, uploads, and job status
- S3 based upload flow using presigned URLs
- Step Functions pipeline for extract, normalise, quality checks, chunking, and persistence
- OpenSearch Serverless vector storage with Bedrock embeddings for retrieval
- DynamoDB metadata tables for datasets, files, jobs, and audit events
- CloudFront hosted frontend

## Architecture at a glance
- Cognito User Pool for auth, tenantId is the Cognito `sub`
- API Gateway REST API + Lambda (Node.js)
- S3 raw and processed buckets
- SQS ingestion queue + dispatcher Lambda
- Step Functions pipeline (Extract -> Normalise -> Quality -> Chunk -> Vector ingest -> Persist)
- DynamoDB tables for datasets, files, jobs, audit log
- OpenSearch Serverless vector collection for chunk storage and retrieval
- Bedrock embeddings for chunk and query vectors
- CloudFront + S3 for static Next.js export

## Repo structure
```
/infra          CDK app (TypeScript)
/backend
  /api          Lambda for REST API (TypeScript)
  /pipeline     Python pipeline steps + tests
  /shared       Shared TS utils
/frontend       Next.js static app (Pages Router)
/scripts        Deploy + smoke test scripts
```

## Prerequisites
- Node.js 18+
- Python 3.11+
- AWS CLI configured for the target account
- Docker Desktop running (used for Lambda bundling)

## Install dependencies
```
npm run install:all
```

## Deploy infrastructure
```
cd infra
npm run cdk bootstrap
npm run cdk deploy --all --require-approval never
```

Capture the CDK outputs:
- `ApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `UserPoolDomainName`
- `FrontendBucketName`
- `FrontendDistributionId`
- `FrontendUrl`
- `VectorCollectionEndpoint`
- `VectorIndexName`

## Configure frontend
```
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:
```
NEXT_PUBLIC_REGION=ap-southeast-2
NEXT_PUBLIC_USER_POOL_ID=<from output>
NEXT_PUBLIC_USER_POOL_CLIENT_ID=<from output>
NEXT_PUBLIC_API_BASE_URL=<from output, no trailing slash>
```

## Build and export frontend
```
npm run build:frontend
npm run export:frontend
```

## Deploy frontend
```
FRONTEND_BUCKET=<FrontendBucketName> \
CLOUDFRONT_DISTRIBUTION_ID=<FrontendDistributionId> \
npm run deploy:frontend
```

## Create a user
Self sign up is enabled. Go to `/login`, create an account, confirm the email code, and sign in.

## Contact form email
The contact form posts to `POST /public/contact` and sends an email using SES.

By default it sends to `mattmilzewski@gmail.com`. You can override this when you deploy the API stack:
```
cd infra
npm run cdk deploy RagReadinessApiStack --require-approval never \
  -c contactRecipientEmail=you@example.com \
  -c contactFromEmail=you@example.com
```

Make sure the sender address is verified in SES. In SES sandbox you can only send to verified addresses.

## Vector search configuration
The vector ingestion pipeline uses Bedrock to embed chunks and OpenSearch Serverless to store them. These settings are passed to the pipeline and API Lambdas as environment variables:

```
OPENSEARCH_COLLECTION_ENDPOINT=https://<collection-id>.<region>.aoss.amazonaws.com
OPENSEARCH_INDEX_NAME=ragready_chunks_v1
BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
BEDROCK_CHAT_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
EMBEDDING_DIMENSION=1024
CHAT_TOP_K_DEFAULT=8
INGEST_BATCH_SIZE=50
INGEST_CONCURRENCY=4
```

Bedrock access must be enabled in the AWS account and region you deploy to.

## Retrieval API
Query the vector store with `POST /rag/query`:

```
curl -X POST "$API_BASE_URL/rag/query" \
  -H "Authorization: Bearer <id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "ds_123",
    "query": "What are the installation requirements?",
    "top_k": 8
  }'
```

Results include `doc_id`, `filename`, `page`, and `chunk_id`. Use the presign endpoint to open the original file.

## Chat API
Chat uses Bedrock for generation and OpenSearch for retrieval. The dataset must be READY.

```
curl -X POST "$API_BASE_URL/chat" \
  -H "Authorization: Bearer <id-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "dataset_id": "ds_123",
    "message": "Summarise the key requirements.",
    "top_k": 8
  }'
```

The response includes `conversation_id`, `message_id`, an `answer`, and citations.

## Source presign
Use `GET /documents/{docId}/presign?datasetId=...` to get a short lived URL for the original PDF.

## Custom domain for the frontend
The frontend stack supports a custom domain through CDK context or environment variables. This sets up:
- ACM certificate in us-east-1 for CloudFront
- Route53 A and AAAA alias records for the domain

Deploy with context values:
```
cd infra
npm run cdk deploy RagReadinessFrontendStack --require-approval never \
  -c domainName=getragready.com \
  -c includeWww=true
```

Or use environment variables:
```
export DOMAIN_NAME=getragready.com
export INCLUDE_WWW=true
npm --prefix infra run cdk -- deploy RagReadinessFrontendStack --require-approval never
```

Make sure the hosted zone exists in Route53 and the domain is using the Route53 name servers.

## Smoke test
The smoke test signs in, creates a dataset, uploads a PDF, waits for completion, prints the readiness score, and runs a vector search query against the new index.

```
export AWS_REGION=ap-southeast-2
export API_BASE_URL=<ApiUrl>
export COGNITO_CLIENT_ID=<UserPoolClientId>
export SMOKE_TEST_EMAIL=<existing-user-email>
export SMOKE_TEST_PASSWORD=<user-password>

python3 scripts/smoke_test.py
```

By default it uses `Resume-5.pdf` in the repo. You can override the file:
```
export SMOKE_TEST_PDF=/path/to/file.pdf
```

## Run unit tests
```
python3 -m pip install -r backend/pipeline/requirements-dev.txt
cd backend/pipeline
pytest
```

```
cd backend/api
npm test
```

## Optional seed script
```
API_BASE_URL=<ApiUrl> ACCESS_TOKEN=<CognitoAccessToken> npm run seed
```

## Notes and gotchas
- Uploaded files are stored in `raw/<tenantId>/<datasetId>/<fileId>/` and processed artifacts in `processed/<tenantId>/<datasetId>/<fileId>/`.
- The frontend upload path includes the SSE header required by the presigned URL. If a custom client uploads directly, include `x-amz-server-side-encryption: AES256`.
- If files stay in `UPLOADED_PENDING`, check S3 CORS on the raw bucket and confirm the upload completed.
- Hosted UI callback URLs default to `http://localhost:3000`. Update them to your CloudFront URL if you use the hosted UI.
