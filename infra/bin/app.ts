#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { StorageStack } from '../lib/storage-stack';
import { PipelineStack } from '../lib/pipeline-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION
};

const authStack = new AuthStack(app, 'RagReadinessAuthStack', { env });
const storageStack = new StorageStack(app, 'RagReadinessStorageStack', { env });
const pipelineStack = new PipelineStack(app, 'RagReadinessPipelineStack', {
  env,
  storage: storageStack
});
const apiStack = new ApiStack(app, 'RagReadinessApiStack', {
  env,
  auth: authStack,
  storage: storageStack
});
new FrontendStack(app, 'RagReadinessFrontendStack', { env });

apiStack.addDependency(authStack);
apiStack.addDependency(storageStack);

pipelineStack.addDependency(storageStack);
pipelineStack.addDependency(authStack);
