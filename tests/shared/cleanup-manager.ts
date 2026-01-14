import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
  ScanCommand
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand
} from '@aws-sdk/client-s3';
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand
} from '@aws-sdk/client-cognito-identity-provider';

interface CleanupOptions {
  region: string;
  datasetsTable: string;
  filesTable: string;
  jobsTable: string;
  auditTable: string;
  conversationsTable: string;
  messagesTable: string;
  rawBucket: string;
  processedBucket: string;
  userPoolId: string;
}

export class E2ECleanupManager {
  private dynamoClient: DynamoDBDocumentClient;
  private s3Client: S3Client;
  private cognitoClient: CognitoIdentityProviderClient;
  private options: CleanupOptions;

  constructor(options: CleanupOptions) {
    this.options = options;
    const ddbClient = new DynamoDBClient({ region: options.region });
    this.dynamoClient = DynamoDBDocumentClient.from(ddbClient);
    this.s3Client = new S3Client({ region: options.region });
    this.cognitoClient = new CognitoIdentityProviderClient({ region: options.region });
  }

  /**
   * Clean up a specific dataset and all associated resources
   */
  async cleanupDataset(datasetId: string, tenantId: string): Promise<void> {
    console.log(`Cleaning up dataset ${datasetId} for tenant ${tenantId}`);

    try {
      // 1. Delete all files in FILES_TABLE
      await this.deleteFilesForDataset(datasetId, tenantId);

      // 2. Delete S3 objects in raw and processed buckets
      await this.deleteS3Objects(tenantId, datasetId);

      // 3. Delete dataset record
      await this.dynamoClient.send(
        new DeleteCommand({
          TableName: this.options.datasetsTable,
          Key: { tenantId, datasetId }
        })
      );

      // 4. Delete conversations and messages
      await this.deleteConversationsForDataset(datasetId, tenantId);

      console.log(`Successfully cleaned up dataset ${datasetId}`);
    } catch (error) {
      console.error(`Error cleaning up dataset ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Delete all files associated with a dataset
   */
  private async deleteFilesForDataset(datasetId: string, tenantId: string): Promise<void> {
    const tenantDatasetId = `${tenantId}#${datasetId}`;

    const client = new DynamoDBClient({ region: this.options.region });
    const response = await client.send(
      new QueryCommand({
        TableName: this.options.filesTable,
        KeyConditionExpression: 'tenantDatasetId = :td',
        ExpressionAttributeValues: {
          ':td': { S: tenantDatasetId }
        }
      })
    );

    if (response.Items && response.Items.length > 0) {
      for (const item of response.Items) {
        const fileId = item.fileId?.S;
        if (fileId) {
          // Delete associated jobs
          await this.deleteJobsForFile(fileId, tenantId);

          // Delete file record
          await client.send(
            new DeleteItemCommand({
              TableName: this.options.filesTable,
              Key: {
                tenantDatasetId: { S: tenantDatasetId },
                fileId: { S: fileId }
              }
            })
          );
        }
      }
    }
  }

  /**
   * Delete all jobs associated with a file
   */
  private async deleteJobsForFile(fileId: string, tenantId: string): Promise<void> {
    const tenantFileId = `${tenantId}#${fileId}`;

    const client = new DynamoDBClient({ region: this.options.region });
    const response = await client.send(
      new QueryCommand({
        TableName: this.options.jobsTable,
        KeyConditionExpression: 'tenantFileId = :tf',
        ExpressionAttributeValues: {
          ':tf': { S: tenantFileId }
        }
      })
    );

    if (response.Items && response.Items.length > 0) {
      for (const item of response.Items) {
        const jobId = item.jobId?.S;
        if (jobId) {
          await client.send(
            new DeleteItemCommand({
              TableName: this.options.jobsTable,
              Key: {
                tenantFileId: { S: tenantFileId },
                jobId: { S: jobId }
              }
            })
          );
        }
      }
    }
  }

  /**
   * Delete S3 objects for a dataset
   */
  private async deleteS3Objects(tenantId: string, datasetId: string): Promise<void> {
    // Delete from raw bucket
    await this.deleteS3Prefix(this.options.rawBucket, `raw/${tenantId}/${datasetId}/`);

    // Delete from processed bucket
    await this.deleteS3Prefix(this.options.processedBucket, `processed/${tenantId}/${datasetId}/`);
  }

  /**
   * Delete all objects under a prefix in S3
   */
  private async deleteS3Prefix(bucket: string, prefix: string): Promise<void> {
    let continuationToken: string | undefined;

    do {
      const listResponse = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );

      if (listResponse.Contents && listResponse.Contents.length > 0) {
        const objects = listResponse.Contents.map(obj => ({ Key: obj.Key! }));

        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects }
          })
        );

        console.log(`Deleted ${objects.length} objects from ${bucket}/${prefix}`);
      }

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);
  }

  /**
   * Delete conversations and messages for a dataset
   */
  private async deleteConversationsForDataset(datasetId: string, tenantId: string): Promise<void> {
    const client = new DynamoDBClient({ region: this.options.region });

    // Query conversations by tenantId and filter by datasetId
    const response = await client.send(
      new QueryCommand({
        TableName: this.options.conversationsTable,
        KeyConditionExpression: 'tenantId = :tid',
        FilterExpression: 'datasetId = :did',
        ExpressionAttributeValues: {
          ':tid': { S: tenantId },
          ':did': { S: datasetId }
        }
      })
    );

    if (response.Items && response.Items.length > 0) {
      for (const item of response.Items) {
        const conversationId = item.conversationId?.S;
        if (conversationId) {
          // Delete messages for this conversation
          await this.deleteMessagesForConversation(conversationId, tenantId);

          // Delete conversation
          await client.send(
            new DeleteItemCommand({
              TableName: this.options.conversationsTable,
              Key: {
                tenantId: { S: tenantId },
                conversationId: { S: conversationId }
              }
            })
          );
        }
      }
    }
  }

  /**
   * Delete messages for a conversation
   */
  private async deleteMessagesForConversation(conversationId: string, tenantId: string): Promise<void> {
    const tenantConversationId = `${tenantId}#${conversationId}`;

    const client = new DynamoDBClient({ region: this.options.region });
    const response = await client.send(
      new QueryCommand({
        TableName: this.options.messagesTable,
        KeyConditionExpression: 'tenantConversationId = :tc',
        ExpressionAttributeValues: {
          ':tc': { S: tenantConversationId }
        }
      })
    );

    if (response.Items && response.Items.length > 0) {
      for (const item of response.Items) {
        const createdAtMessageId = item.createdAtMessageId?.S;
        if (createdAtMessageId) {
          await client.send(
            new DeleteItemCommand({
              TableName: this.options.messagesTable,
              Key: {
                tenantConversationId: { S: tenantConversationId },
                createdAtMessageId: { S: createdAtMessageId }
              }
            })
          );
        }
      }
    }
  }

  /**
   * Clean up orphaned test resources older than specified hours
   */
  async cleanupOrphanedResources(testPrefix: string, maxAgeHours: number = 2): Promise<void> {
    console.log(`Scanning for orphaned resources with prefix: ${testPrefix}, older than ${maxAgeHours} hours`);

    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

    const client = new DynamoDBClient({ region: this.options.region });

    // Scan datasets table for test datasets
    const response = await client.send(
      new ScanCommand({
        TableName: this.options.datasetsTable,
        FilterExpression: 'begins_with(#name, :prefix) AND createdAt < :cutoff',
        ExpressionAttributeNames: {
          '#name': 'name'
        },
        ExpressionAttributeValues: {
          ':prefix': { S: testPrefix },
          ':cutoff': { S: cutoffTime }
        }
      })
    );

    if (response.Items && response.Items.length > 0) {
      console.log(`Found ${response.Items.length} orphaned datasets to clean up`);

      for (const item of response.Items) {
        const tenantId = item.tenantId?.S;
        const datasetId = item.datasetId?.S;

        if (tenantId && datasetId) {
          console.log(`Cleaning up orphaned dataset: ${datasetId}`);
          await this.cleanupDataset(datasetId, tenantId);
        }
      }
    } else {
      console.log('No orphaned resources found');
    }
  }

  /**
   * Delete a test user from Cognito
   */
  async deleteTestUser(email: string): Promise<void> {
    // Only delete users that match test pattern (safety check)
    if (!email.includes('e2e-test-') && !email.includes('github-run')) {
      console.log(`Skipping deletion of non-test user: ${email}`);
      return;
    }

    try {
      await this.cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.options.userPoolId,
          Username: email
        })
      );
      console.log(`Deleted test user: ${email}`);
    } catch (error: any) {
      if (error.name === 'UserNotFoundException') {
        console.log(`User ${email} not found, skipping deletion`);
      } else {
        console.error(`Error deleting user ${email}:`, error);
        throw error;
      }
    }
  }
}

/**
 * Get CloudFormation stack outputs for cleanup configuration
 */
export async function getCleanupOptionsFromStackOutputs(region: string): Promise<CleanupOptions> {
  // This would be called from the cleanup script with AWS SDK
  // For now, return from environment variables
  return {
    region,
    datasetsTable: process.env.DATASETS_TABLE || '',
    filesTable: process.env.FILES_TABLE || '',
    jobsTable: process.env.JOBS_TABLE || '',
    auditTable: process.env.AUDIT_TABLE || '',
    conversationsTable: process.env.CONVERSATIONS_TABLE || '',
    messagesTable: process.env.MESSAGES_TABLE || '',
    rawBucket: process.env.RAW_BUCKET || '',
    processedBucket: process.env.PROCESSED_BUCKET || '',
    userPoolId: process.env.USER_POOL_ID || ''
  };
}
