import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';

export class StorageStack extends cdk.Stack {
  public readonly rawBucket: s3.Bucket;
  public readonly processedBucket: s3.Bucket;
  public readonly datasetsTable: dynamodb.Table;
  public readonly filesTable: dynamodb.Table;
  public readonly jobsTable: dynamodb.Table;
  public readonly auditTable: dynamodb.Table;
  public readonly ingestionQueue: sqs.Queue;
  public readonly ingestionDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.rawBucket = new s3.Bucket(this, 'RawBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag']
        }
      ]
    });

    this.processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true
    });

    this.ingestionDlq = new sqs.Queue(this, 'IngestionDLQ', {
      retentionPeriod: cdk.Duration.days(14)
    });

    this.ingestionQueue = new sqs.Queue(this, 'IngestionQueue', {
      visibilityTimeout: cdk.Duration.minutes(5),
      deadLetterQueue: {
        queue: this.ingestionDlq,
        maxReceiveCount: 3
      }
    });

    this.rawBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.SqsDestination(this.ingestionQueue)
    );

    this.datasetsTable = new dynamodb.Table(this, 'DatasetsTable', {
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'datasetId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    this.filesTable = new dynamodb.Table(this, 'FilesTable', {
      partitionKey: { name: 'tenantDatasetId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'fileId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    this.filesTable.addGlobalSecondaryIndex({
      indexName: 'rawSha256-index',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'rawSha256', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.filesTable.addGlobalSecondaryIndex({
      indexName: 'tenantCreatedAt-index',
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL
    });

    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      partitionKey: { name: 'tenantFileId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    this.auditTable = new dynamodb.Table(this, 'AuditTable', {
      partitionKey: { name: 'tenantId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAtEventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST
    });

    new cdk.CfnOutput(this, 'RawBucketName', { value: this.rawBucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessedBucketName', { value: this.processedBucket.bucketName });
    new cdk.CfnOutput(this, 'IngestionQueueUrl', { value: this.ingestionQueue.queueUrl });
    new cdk.CfnOutput(this, 'DatasetsTableName', { value: this.datasetsTable.tableName });
    new cdk.CfnOutput(this, 'FilesTableName', { value: this.filesTable.tableName });
    new cdk.CfnOutput(this, 'JobsTableName', { value: this.jobsTable.tableName });
    new cdk.CfnOutput(this, 'AuditTableName', { value: this.auditTable.tableName });
  }
}
