import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';

export class VectorStack extends cdk.Stack {
  public readonly collectionName: string;
  public readonly collectionEndpoint: string;
  public readonly collectionArn: string;
  public readonly indexName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') || process.env.STAGE || 'dev';
    this.collectionName =
      this.node.tryGetContext('vectorCollectionName') ||
      process.env.VECTOR_COLLECTION_NAME ||
      `ragready-${stage}`;

    this.indexName =
      this.node.tryGetContext('vectorIndexName') ||
      process.env.OPENSEARCH_INDEX_NAME ||
      'ragready_chunks_v1';

    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorEncryptionPolicy', {
      name: `${this.collectionName}-encryption`,
      type: 'encryption',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/${this.collectionName}`]
          }
        ],
        AWSOwnedKey: true
      })
    });

    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'VectorNetworkPolicy', {
      name: `${this.collectionName}-network`,
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/${this.collectionName}`]
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/${this.collectionName}`]
            }
          ],
          AllowFromPublic: true
        }
      ])
    });

    const collection = new opensearchserverless.CfnCollection(this, 'VectorCollection', {
      name: this.collectionName,
      type: 'VECTORSEARCH'
    });

    collection.addDependency(encryptionPolicy);
    collection.addDependency(networkPolicy);

    this.collectionEndpoint = collection.attrCollectionEndpoint;
    this.collectionArn = collection.attrArn;

    new cdk.CfnOutput(this, 'VectorCollectionName', { value: this.collectionName });
    new cdk.CfnOutput(this, 'VectorCollectionEndpoint', { value: this.collectionEndpoint });
    new cdk.CfnOutput(this, 'VectorCollectionArn', { value: this.collectionArn });
    new cdk.CfnOutput(this, 'VectorIndexName', { value: this.indexName });
  }
}
