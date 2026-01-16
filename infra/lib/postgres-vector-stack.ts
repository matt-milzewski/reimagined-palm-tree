import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class PostgresVectorStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly dbEndpoint: string;
  public readonly dbPort: number;
  public readonly databaseName: string;
  public readonly vpc: ec2.IVpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const stage = this.node.tryGetContext('stage') || process.env.STAGE || 'dev';
    this.databaseName = 'ragready';

    // Use default VPC
    this.vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // Security group for RDS
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RagReady PostgreSQL vector database',
      allowAllOutbound: true
    });

    // Allow connections from within VPC
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from VPC'
    );

    // Database credentials stored in Secrets Manager
    this.dbSecret = new secretsmanager.Secret(this, 'RdsCredentials', {
      secretName: `ragready-${stage}-db-credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'ragready_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32
      }
    });

    // Parameter group to enable pgvector extension
    const parameterGroup = new rds.ParameterGroup(this, 'PgVectorParamGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15
      }),
      parameters: {
        'shared_preload_libraries': 'pg_stat_statements'
      }
    });

    // RDS PostgreSQL instance
    this.dbInstance = new rds.DatabaseInstance(this, 'PostgresInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [this.dbSecurityGroup],
      credentials: rds.Credentials.fromSecret(this.dbSecret),
      databaseName: this.databaseName,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: stage === 'prod',
      deletionProtection: stage === 'prod',
      backupRetention: cdk.Duration.days(stage === 'prod' ? 30 : 7),
      publiclyAccessible: true,
      instanceIdentifier: `ragready-${stage}-vector-db`,
      parameterGroup
    });

    this.dbEndpoint = this.dbInstance.instanceEndpoint.hostname;
    this.dbPort = this.dbInstance.instanceEndpoint.port;

    // Outputs
    new cdk.CfnOutput(this, 'DbEndpoint', { value: this.dbEndpoint });
    new cdk.CfnOutput(this, 'DbPort', { value: this.dbPort.toString() });
    new cdk.CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
    new cdk.CfnOutput(this, 'DatabaseName', { value: this.databaseName });
    new cdk.CfnOutput(this, 'DbSecurityGroupId', { value: this.dbSecurityGroup.securityGroupId });
  }
}
