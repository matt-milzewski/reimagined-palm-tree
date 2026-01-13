import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';

interface VectorAccessStackProps extends cdk.StackProps {
  collectionName: string;
  ingestionRoleArn: string;
  queryRoleArn: string;
}

export class VectorAccessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: VectorAccessStackProps) {
    super(scope, id, props);

    const ingestionPolicy = {
      Rules: [
        {
          ResourceType: 'collection',
          Resource: [`collection/${props.collectionName}`],
          Permission: ['aoss:DescribeCollectionItems']
        },
        {
          ResourceType: 'index',
          Resource: [`index/${props.collectionName}/*`],
          Permission: [
            'aoss:CreateIndex',
            'aoss:UpdateIndex',
            'aoss:DescribeIndex',
            'aoss:ReadDocument',
            'aoss:WriteDocument'
          ]
        }
      ],
      Principal: [props.ingestionRoleArn]
    };

    const queryPolicy = {
      Rules: [
        {
          ResourceType: 'collection',
          Resource: [`collection/${props.collectionName}`],
          Permission: ['aoss:DescribeCollectionItems']
        },
        {
          ResourceType: 'index',
          Resource: [`index/${props.collectionName}/*`],
          Permission: ['aoss:DescribeIndex', 'aoss:ReadDocument']
        }
      ],
      Principal: [props.queryRoleArn]
    };

    new opensearchserverless.CfnAccessPolicy(this, 'VectorAccessPolicy', {
      name: `${props.collectionName}-access`,
      type: 'data',
      policy: JSON.stringify([ingestionPolicy, queryPolicy])
    });
  }
}
