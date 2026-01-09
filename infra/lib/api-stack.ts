import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { AuthStack } from './auth-stack';

interface ApiStackProps extends cdk.StackProps {
  storage: StorageStack;
  auth: AuthStack;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const apiFn = new NodejsFunction(this, 'ApiHandler', {
      entry: path.join(__dirname, '../../backend/api/src/handler.ts'),
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DATASETS_TABLE: props.storage.datasetsTable.tableName,
        FILES_TABLE: props.storage.filesTable.tableName,
        JOBS_TABLE: props.storage.jobsTable.tableName,
        AUDIT_TABLE: props.storage.auditTable.tableName,
        RAW_BUCKET: props.storage.rawBucket.bucketName,
        PROCESSED_BUCKET: props.storage.processedBucket.bucketName
      }
    });

    props.storage.datasetsTable.grantReadWriteData(apiFn);
    props.storage.filesTable.grantReadWriteData(apiFn);
    props.storage.jobsTable.grantReadWriteData(apiFn);
    props.storage.auditTable.grantReadWriteData(apiFn);
    props.storage.rawBucket.grantPut(apiFn);
    props.storage.processedBucket.grantRead(apiFn);

    const api = new apigateway.RestApi(this, 'RagReadinessApi', {
      restApiName: 'RAG Readiness API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type']
      }
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'UserPoolAuthorizer', {
      cognitoUserPools: [props.auth.userPool]
    });

    const proxy = api.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(apiFn),
      anyMethod: false
    });

    proxy.addMethod('ANY', new apigateway.LambdaIntegration(apiFn), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer
    });

    this.api = api;

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
