# RAG Readiness Pipeline MVP

Production-style monorepo for a complete SaaS MVP that ingests PDFs, runs a multi-step processing pipeline, and returns extracted text, normalized JSON, RAG chunks, and a quality report.

## Architecture
- Cognito User Pool for auth (tenantId = Cognito `sub`)
- API Gateway (REST) + Lambda (Node.js)
- S3 raw bucket + S3 processed bucket
- SQS ingestion queue + dispatcher Lambda
- Step Functions pipeline (Extract -> Normalize -> Quality -> Chunk -> Persist)
- DynamoDB tables for datasets, files, jobs, audit log
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

Take note of the CDK outputs:
- `ApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `UserPoolDomain`
- `FrontendBucketName`
- `FrontendDistributionId`
- `FrontendUrl`

## Configure frontend
```
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:
```
NEXT_PUBLIC_REGION=us-east-1
NEXT_PUBLIC_USER_POOL_ID=<from output>
NEXT_PUBLIC_USER_POOL_CLIENT_ID=<from output>
NEXT_PUBLIC_API_BASE_URL=<from output>
```

## Build + export frontend
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
Self-sign-up is enabled on the Cognito User Pool. Create a user via the Cognito hosted UI or the AWS console. Use that email/password to log in to the frontend.

## Run the smoke test
The smoke test signs in, creates a dataset, uploads a sample PDF, waits for completion, and prints the readiness score.

```
export AWS_REGION=us-east-1
export API_BASE_URL=<ApiUrl>
export COGNITO_CLIENT_ID=<UserPoolClientId>
export SMOKE_TEST_EMAIL=<existing-user-email>
export SMOKE_TEST_PASSWORD=<user-password>

python3 scripts/smoke_test.py
```

## Run unit tests
```
python3 -m pip install -r backend/pipeline/requirements-dev.txt
cd backend/pipeline
pytest
```

## Optional seed script
```
API_BASE_URL=<ApiUrl> ACCESS_TOKEN=<CognitoAccessToken> npm run seed
```

## Notes
- The pipeline writes all artifacts into `processed/<tenantId>/<datasetId>/<fileId>/`.
- Quality report findings are fetched in the UI via a signed download URL.
- Hosted UI callback URLs default to `http://localhost:3000`. Update them to your CloudFront URL if you want to use Hosted UI.
