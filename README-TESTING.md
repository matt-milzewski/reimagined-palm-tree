# RagReady E2E Testing Guide

## Overview

This document describes the automated end-to-end (E2E) testing setup for the RagReady application. The test suite covers critical user flows across frontend, API, and data pipeline components.

## Architecture

The E2E testing follows a layered approach:

```
┌─────────────────────────────────────────┐
│   Playwright E2E Tests (Critical Paths) │  ← Frontend + Full Stack
├─────────────────────────────────────────┤
│   API Integration Tests (Node.js)       │  ← API Lambda + AWS
├─────────────────────────────────────────┤
│   Pipeline E2E Tests (pytest)           │  ← Step Functions → OpenSearch
├─────────────────────────────────────────┤
│   Unit Tests (existing)                 │  ← Business logic
└─────────────────────────────────────────┘
```

## Test Coverage

### Playwright E2E Tests (`tests/e2e/`)

**1. Authentication Flow** (`specs/auth.spec.ts`)
- Login with valid credentials
- Error handling for invalid credentials
- Navigation from landing page to login

**2. Dataset Lifecycle** (`specs/dataset-lifecycle.spec.ts`)
- Create new dataset
- Upload PDF file
- Monitor processing status
- View processing results and readiness score
- Automatic cleanup after test

**3. Chat with Citations** (`specs/chat.spec.ts`)
- Select processed dataset
- Send chat message
- Receive AI response with citations
- Open source document from citation
- Automatic cleanup after test

## Prerequisites

### Required Software
- Node.js 18+
- npm or yarn
- AWS CLI configured
- TypeScript

### Required AWS Resources
- Deployed RagReady infrastructure (all CDK stacks)
- Test user created in Cognito User Pool

### Environment Variables

Create a `.env.test` file in `tests/e2e/` (copy from `.env.test.example`):

```bash
# Frontend and API URLs
FRONTEND_URL=https://your-cloudfront-url.cloudfront.net
API_BASE_URL=https://your-api-gateway-url.execute-api.region.amazonaws.com/prod

# AWS Configuration
AWS_REGION=ap-southeast-2

# Cognito Configuration
USER_POOL_ID=ap-southeast-2_XXXXXXXXX
USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

# Test User Credentials
E2E_TEST_EMAIL=e2e-test@example.com
E2E_TEST_PASSWORD=YourSecurePassword123!

# AWS Resources (for cleanup)
RAW_BUCKET=your-raw-bucket-name
PROCESSED_BUCKET=your-processed-bucket-name
DATASETS_TABLE=your-datasets-table-name
FILES_TABLE=your-files-table-name
JOBS_TABLE=your-jobs-table-name
AUDIT_TABLE=your-audit-table-name
CONVERSATIONS_TABLE=your-conversations-table-name
MESSAGES_TABLE=your-messages-table-name
```

## Setup

### 1. Create Test User in Cognito

```bash
# Get your User Pool ID
aws cloudformation describe-stacks \
  --stack-name RagReadinessAuthStack \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text

# Create test user
aws cognito-idp admin-create-user \
  --user-pool-id <your-pool-id> \
  --username e2e-test@example.com \
  --message-action SUPPRESS \
  --temporary-password TempPassword123!

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id <your-pool-id> \
  --username e2e-test@example.com \
  --password <your-secure-password> \
  --permanent
```

### 2. Install Dependencies

```bash
cd tests/e2e
npm install
npx playwright install chromium
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.test.example .env.test

# Edit .env.test with your actual values
vim .env.test
```

### 4. Get Stack Outputs

Use this script to populate your `.env.test` file:

```bash
#!/bin/bash

export AWS_REGION="ap-southeast-2"

# Get stack outputs
API_URL=$(aws cloudformation describe-stacks --stack-name RagReadinessApiStack --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
USER_POOL_ID=$(aws cloudformation describe-stacks --stack-name RagReadinessAuthStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name RagReadinessAuthStack --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name RagReadinessFrontendStack --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" --output text)

echo "FRONTEND_URL=${FRONTEND_URL}"
echo "API_BASE_URL=${API_URL}"
echo "USER_POOL_ID=${USER_POOL_ID}"
echo "USER_POOL_CLIENT_ID=${USER_POOL_CLIENT_ID}"
```

## Running Tests

### Run All Tests

```bash
cd tests/e2e
npm test
```

### Run Specific Test Suite

```bash
npm test -- auth.spec.ts                    # Auth tests only
npm test -- dataset-lifecycle.spec.ts       # Dataset lifecycle only
npm test -- chat.spec.ts                    # Chat tests only
```

### Run Tests in Headed Mode (See Browser)

```bash
npm run test:headed
```

### Debug Tests

```bash
npm run test:debug
```

### Run Tests with UI Mode

```bash
npm run test:ui
```

## CI/CD Integration

### GitHub Actions Workflow

The E2E tests run automatically via GitHub Actions (`.github/workflows/e2e-tests.yml`):

**Triggers:**
- Pull requests to `main` branch
- Daily at 2 AM UTC (scheduled)
- Manual trigger via workflow_dispatch

**Jobs:**
1. **setup** - Gets CloudFormation stack outputs
2. **playwright-e2e** - Runs Playwright tests
3. **cleanup** - Removes orphaned test resources

### Required GitHub Secrets

Add these secrets in your repository settings:

```
AWS_ACCESS_KEY_ID           # AWS credentials
AWS_SECRET_ACCESS_KEY       # AWS credentials
AWS_REGION                  # e.g., ap-southeast-2
E2E_TEST_EMAIL              # Test user email
E2E_TEST_PASSWORD           # Test user password
```

## Test Data Management

### Naming Convention

All test resources use the prefix `e2e-test-`:
- Datasets: `e2e-test-{test-name}-{timestamp}`
- Files: `e2e-test-{test-name}-{timestamp}.pdf`

### Cleanup Strategy

**1. Immediate Cleanup (Per Test)**
Each test cleans up its own resources in `afterEach` or `afterAll` hooks:

```typescript
test.afterEach(async () => {
  if (datasetId && tenantId) {
    await cleanupDataset(datasetId, tenantId);
  }
});
```

**2. Workflow-Level Cleanup**
The CI/CD workflow includes a cleanup job that:
- Scans for orphaned resources with `e2e-test-` prefix
- Removes resources older than 2 hours
- Runs even if tests fail

**3. Manual Cleanup**

If needed, you can manually clean up orphaned resources:

```bash
cd tests/shared
npm install

# Create cleanup script
cat > run-cleanup.ts <<'EOF'
import { E2ECleanupManager, getCleanupOptionsFromStackOutputs } from './cleanup-manager';

async function main() {
  const options = await getCleanupOptionsFromStackOutputs(process.env.AWS_REGION!);
  const manager = new E2ECleanupManager(options);
  await manager.cleanupOrphanedResources('e2e-test-', 2);
  console.log('Cleanup completed');
}

main().catch(console.error);
EOF

npx ts-node run-cleanup.ts
```

## Troubleshooting

### Common Issues

**1. Test User Authentication Fails**

```
Error: Failed to authenticate user
```

**Solution:**
- Verify test user exists in Cognito
- Verify password is correct and not expired
- Check User Pool ID and Client ID are correct

**2. File Processing Times Out**

```
Error: File processing did not complete within 3 minutes
```

**Solution:**
- Check Step Functions execution in AWS Console
- Check Lambda logs for pipeline errors
- Increase timeout in test (currently 180 seconds)

**3. Cleanup Fails**

```
Error cleaning up dataset
```

**Solution:**
- Check AWS credentials have necessary permissions
- Verify DynamoDB table names are correct
- Check S3 bucket permissions

**4. Frontend Not Loading**

```
Error: Timeout waiting for page navigation
```

**Solution:**
- Verify CloudFront distribution is deployed
- Check FRONTEND_URL is correct
- Try accessing URL directly in browser

### Debug Mode

Run tests in debug mode to step through execution:

```bash
npm run test:debug
```

This opens Playwright Inspector where you can:
- Step through test actions
- Inspect page state
- View console logs
- Take screenshots

### Verbose Logging

Enable verbose logging in tests:

```typescript
test.beforeEach(async ({ page }) => {
  page.on('console', msg => console.log('Browser:', msg.text()));
  page.on('request', req => console.log('Request:', req.url()));
  page.on('response', res => console.log('Response:', res.url(), res.status()));
});
```

## Test Reports

### HTML Report

After running tests, view the HTML report:

```bash
npm run test:report
```

This opens an interactive report showing:
- Test results
- Screenshots on failure
- Videos of failed tests
- Trace files for debugging

### CI/CD Artifacts

GitHub Actions uploads test artifacts:
- **playwright-report** - HTML test report
- **playwright-artifacts** - Screenshots, videos, traces

Access via: Actions → Workflow Run → Artifacts

## Cost Considerations

### Per Test Run

- Bedrock embedding calls: ~$0.0001 (1-3 chunks per test doc)
- Bedrock chat calls: ~$0.0005 (1-2 queries per test)
- S3 storage: negligible (< 1 MB, auto-cleanup)
- OpenSearch compute: included in collection
- DynamoDB: negligible (on-demand pricing)

**Total per run: ~$0.002**

### Monthly Cost (Daily Runs)

- 30 runs/month × $0.002/run = **$0.06/month**
- CloudWatch logs: ~$1/month
- **Total: < $2/month**

## Best Practices

### Writing New Tests

1. **Use descriptive test names**
```typescript
test('should complete full dataset lifecycle: create → upload → process → results', ...)
```

2. **Always clean up resources**
```typescript
test.afterEach(async () => {
  await cleanupDataset(datasetId, tenantId);
});
```

3. **Use meaningful waits**
```typescript
// Bad
await page.waitForTimeout(5000);

// Good
await page.waitForSelector('.status.complete');
```

4. **Add helpful console logs**
```typescript
console.log(`Created dataset: ${datasetId}`);
console.log('Waiting for file processing...');
```

5. **Use unique identifiers**
```typescript
const datasetName = generateTestDatasetName('my-test');
```

### Test Isolation

- Each test should be independent
- Don't rely on state from previous tests
- Use beforeEach/afterEach for setup/teardown
- Tests should pass in any order

### Timeouts

Use appropriate timeouts for different operations:
- Authentication: 15 seconds
- Page navigation: 10 seconds
- File upload: 30 seconds
- File processing: 180 seconds (3 minutes)
- Chat response: 30 seconds

## Maintenance

### Updating Tests for UI Changes

When frontend UI changes:

1. Update selectors in test specs
2. Update expected text content
3. Run tests locally to verify
4. Update this documentation

### Adding New Test Suites

To add new test coverage:

1. Create new spec file in `tests/e2e/specs/`
2. Import auth fixtures
3. Implement test cases
4. Add cleanup in afterEach/afterAll
5. Update this README

### Upgrading Playwright

```bash
cd tests/e2e
npm update @playwright/test
npx playwright install
```

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review test logs and screenshots
3. Check CloudWatch logs for backend errors
4. Review GitHub Actions workflow logs

## Additional Resources

- [Playwright Documentation](https://playwright.dev)
- [AWS Cognito Authentication](https://docs.aws.amazon.com/cognito/)
- [GitHub Actions](https://docs.github.com/en/actions)
