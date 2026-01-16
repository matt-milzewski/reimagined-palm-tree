#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { PostgresVectorStack } from '../lib/postgres-vector-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

const authStack = new AuthStack(app, 'RagReadinessAuthStack', { env });
const storageStack = new StorageStack(app, 'RagReadinessStorageStack', { env });
const postgresVectorStack = new PostgresVectorStack(app, 'RagReadyPostgresVectorStack', { env });
const pipelineStack = new PipelineStack(app, 'RagReadinessPipelineStack', {
  env,
  storage: storageStack,
  postgresVector: postgresVectorStack
});
const apiStack = new ApiStack(app, 'RagReadinessApiStack', {
  env,
  auth: authStack,
  storage: storageStack,
  postgresVector: postgresVectorStack
});
new FrontendStack(app, 'RagReadinessFrontendStack', { env });

apiStack.addDependency(authStack);
apiStack.addDependency(storageStack);

pipelineStack.addDependency(storageStack);
pipelineStack.addDependency(authStack);
pipelineStack.addDependency(postgresVectorStack);

apiStack.addDependency(postgresVectorStack);
