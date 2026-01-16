import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { AuthStack } from './auth-stack';
import { PostgresVectorStack } from './postgres-vector-stack';

interface ApiStackProps extends cdk.StackProps {
  storage: StorageStack;
  auth: AuthStack;
  postgresVector: PostgresVectorStack;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiRoleArn: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const contactRecipientEmail =
      this.node.tryGetContext('contactRecipientEmail') ||
      process.env.CONTACT_RECIPIENT_EMAIL ||
      'mattmilzewski@gmail.com';
    const contactFromEmail =
      this.node.tryGetContext('contactFromEmail') || process.env.CONTACT_FROM_EMAIL || contactRecipientEmail;

    const embedModelId =
      this.node.tryGetContext('bedrockEmbedModelId') ||
      process.env.BEDROCK_EMBED_MODEL_ID ||
      'amazon.titan-embed-text-v2:0';
    const chatModelId =
      this.node.tryGetContext('bedrockChatModelId') ||
      process.env.BEDROCK_CHAT_MODEL_ID ||
      'anthropic.claude-3-haiku-20240307-v1:0';
    const embeddingDimension =
      this.node.tryGetContext('embeddingDimension') ||
      process.env.EMBEDDING_DIMENSION ||
      '1024';
    const chatTopKDefault =
      this.node.tryGetContext('chatTopKDefault') ||
      process.env.CHAT_TOP_K_DEFAULT ||
      '8';

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
        CONVERSATIONS_TABLE: props.storage.conversationsTable.tableName,
        MESSAGES_TABLE: props.storage.messagesTable.tableName,
        RAW_BUCKET: props.storage.rawBucket.bucketName,
        PROCESSED_BUCKET: props.storage.processedBucket.bucketName,
        CONTACT_RECIPIENT_EMAIL: contactRecipientEmail,
        CONTACT_FROM_EMAIL: contactFromEmail,
        // PostgreSQL configuration (replaces OpenSearch)
        DB_HOST: props.postgresVector.dbEndpoint,
        DB_PORT: props.postgresVector.dbPort.toString(),
        DB_NAME: props.postgresVector.databaseName,
        DB_SECRET_ARN: props.postgresVector.dbSecret.secretArn,
        BEDROCK_EMBED_MODEL_ID: embedModelId,
        BEDROCK_CHAT_MODEL_ID: chatModelId,
        EMBEDDING_DIMENSION: embeddingDimension,
        CHAT_TOP_K_DEFAULT: chatTopKDefault
      }
    });

    props.storage.datasetsTable.grantReadWriteData(apiFn);
    props.storage.filesTable.grantReadWriteData(apiFn);
    props.storage.jobsTable.grantReadWriteData(apiFn);
    props.storage.auditTable.grantReadWriteData(apiFn);
    props.storage.conversationsTable.grantReadWriteData(apiFn);
    props.storage.messagesTable.grantReadWriteData(apiFn);
    props.storage.rawBucket.grantPut(apiFn);
    props.storage.rawBucket.grantRead(apiFn);
    props.storage.processedBucket.grantRead(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${this.region}:${this.account}:identity/${contactFromEmail}`,
          `arn:aws:ses:${this.region}:${this.account}:configuration-set/*`
        ]
      })
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${embedModelId}`]
      })
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${chatModelId}`]
      })
    );

    // Grant access to PostgreSQL credentials in Secrets Manager
    props.postgresVector.dbSecret.grantRead(apiFn);

    const api = new apigateway.RestApi(this, 'RagReadinessApi', {
      restApiName: 'RagReady API',
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

    const publicResource = api.root.addResource('public');
    const contactResource = publicResource.addResource('contact');
    contactResource.addMethod('POST', new apigateway.LambdaIntegration(apiFn), {
      authorizationType: apigateway.AuthorizationType.NONE
    });

    this.api = api;
    this.apiRoleArn = apiFn.role?.roleArn || '';

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
  }
}
