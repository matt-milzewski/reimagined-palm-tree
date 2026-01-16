import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { PostgresVectorStack } from './postgres-vector-stack';

interface PipelineStackProps extends cdk.StackProps {
  storage: StorageStack;
  postgresVector: PostgresVectorStack;
}

export class PipelineStack extends cdk.Stack {
  public readonly stateMachine: sfn.StateMachine;
  public readonly ingestionRoleArn: string;

  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const embedModelId =
      this.node.tryGetContext('bedrockEmbedModelId') ||
      process.env.BEDROCK_EMBED_MODEL_ID ||
      'amazon.titan-embed-text-v2:0';
    const embeddingDimension =
      this.node.tryGetContext('embeddingDimension') ||
      process.env.EMBEDDING_DIMENSION ||
      '1024';
    const ingestBatchSize =
      this.node.tryGetContext('ingestBatchSize') ||
      process.env.INGEST_BATCH_SIZE ||
      '50';
    const ingestConcurrency =
      this.node.tryGetContext('ingestConcurrency') ||
      process.env.INGEST_CONCURRENCY ||
      '4';

    const envVars = {
      RAW_BUCKET: props.storage.rawBucket.bucketName,
      PROCESSED_BUCKET: props.storage.processedBucket.bucketName,
      FILES_TABLE: props.storage.filesTable.tableName,
      JOBS_TABLE: props.storage.jobsTable.tableName,
      DATASETS_TABLE: props.storage.datasetsTable.tableName,
      AUDIT_TABLE: props.storage.auditTable.tableName,
      FILES_GSI_HASH: 'rawSha256-index',
      FILES_GSI_RECENT: 'tenantCreatedAt-index',
      // PostgreSQL configuration (replaces OpenSearch)
      DB_HOST: props.postgresVector.dbEndpoint,
      DB_PORT: props.postgresVector.dbPort.toString(),
      DB_NAME: props.postgresVector.databaseName,
      DB_SECRET_ARN: props.postgresVector.dbSecret.secretArn,
      BEDROCK_EMBED_MODEL_ID: embedModelId,
      EMBEDDING_DIMENSION: embeddingDimension,
      INGEST_BATCH_SIZE: ingestBatchSize,
      INGEST_CONCURRENCY: ingestConcurrency
    };

    const entryPath = path.join(__dirname, '../../backend/pipeline');

    const createPipelineFn = (id: string, index: string, timeoutSeconds = 60) =>
      new PythonFunction(this, id, {
        entry: entryPath,
        index,
        handler: 'handler',
        runtime: lambda.Runtime.PYTHON_3_11,
        timeout: cdk.Duration.seconds(timeoutSeconds),
        memorySize: 512,
        environment: envVars
      });

    const markRunningFn = createPipelineFn('MarkRunningFn', 'mark_running.py', 30);
    const extractTextFn = createPipelineFn('ExtractTextFn', 'extract_text.py', 120);
    const normalizeFn = createPipelineFn('NormalizeFn', 'normalize.py', 60);
    const qualityFn = createPipelineFn('QualityChecksFn', 'quality_checks.py', 60);
    const chunkFn = createPipelineFn('ChunkFn', 'chunk.py', 60);
    const vectorIngestFn = createPipelineFn('VectorIngestFn', 'vector_ingest.py', 300);
    const persistFn = createPipelineFn('PersistResultsFn', 'persist_results.py', 60);
    const failFn = createPipelineFn('FailHandlerFn', 'fail_handler.py', 30);

    props.storage.rawBucket.grantRead(extractTextFn);
    props.storage.processedBucket.grantReadWrite(extractTextFn);
    props.storage.processedBucket.grantReadWrite(normalizeFn);
    props.storage.processedBucket.grantReadWrite(qualityFn);
    props.storage.processedBucket.grantReadWrite(chunkFn);
    props.storage.processedBucket.grantRead(vectorIngestFn);
    props.storage.processedBucket.grantReadWrite(persistFn);

    props.storage.filesTable.grantReadWriteData(markRunningFn);
    props.storage.jobsTable.grantReadWriteData(markRunningFn);
    props.storage.auditTable.grantReadWriteData(markRunningFn);

    props.storage.filesTable.grantReadWriteData(extractTextFn);
    props.storage.jobsTable.grantReadWriteData(extractTextFn);
    props.storage.filesTable.grantReadWriteData(qualityFn);
    props.storage.jobsTable.grantReadWriteData(qualityFn);

    props.storage.datasetsTable.grantReadWriteData(chunkFn);

    props.storage.jobsTable.grantReadWriteData(persistFn);
    props.storage.filesTable.grantReadWriteData(persistFn);
    props.storage.auditTable.grantReadWriteData(persistFn);

    props.storage.datasetsTable.grantReadWriteData(vectorIngestFn);
    props.storage.auditTable.grantReadWriteData(vectorIngestFn);

    props.storage.jobsTable.grantReadWriteData(failFn);
    props.storage.filesTable.grantReadWriteData(failFn);
    props.storage.auditTable.grantReadWriteData(failFn);
    props.storage.datasetsTable.grantReadWriteData(failFn);

    vectorIngestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${this.region}::foundation-model/${embedModelId}`]
      })
    );
    vectorIngestFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*']
      })
    );

    // Grant access to PostgreSQL credentials in Secrets Manager
    props.postgresVector.dbSecret.grantRead(vectorIngestFn);

    const markRunningTask = new tasks.LambdaInvoke(this, 'MarkRunning', {
      lambdaFunction: markRunningFn,
      payloadResponseOnly: true
    });
    const extractTask = new tasks.LambdaInvoke(this, 'ExtractText', {
      lambdaFunction: extractTextFn,
      payloadResponseOnly: true
    });
    const normalizeTask = new tasks.LambdaInvoke(this, 'Normalize', {
      lambdaFunction: normalizeFn,
      payloadResponseOnly: true
    });
    const qualityTask = new tasks.LambdaInvoke(this, 'QualityChecks', {
      lambdaFunction: qualityFn,
      payloadResponseOnly: true
    });
    const chunkTask = new tasks.LambdaInvoke(this, 'Chunk', {
      lambdaFunction: chunkFn,
      payloadResponseOnly: true
    });
    const ingestTask = new tasks.LambdaInvoke(this, 'VectorIngest', {
      lambdaFunction: vectorIngestFn,
      payloadResponseOnly: true
    });
    const persistTask = new tasks.LambdaInvoke(this, 'PersistResults', {
      lambdaFunction: persistFn,
      payloadResponseOnly: true
    });
    const failTask = new tasks.LambdaInvoke(this, 'FailHandler', {
      lambdaFunction: failFn,
      payloadResponseOnly: true
    });

    const chain = markRunningTask
      .next(extractTask)
      .next(normalizeTask)
      .next(qualityTask)
      .next(chunkTask)
      .next(ingestTask)
      .next(persistTask);

    for (const task of [markRunningTask, extractTask, normalizeTask, qualityTask, chunkTask, ingestTask, persistTask]) {
      task.addCatch(failTask, { resultPath: '$.error' });
    }

    this.stateMachine = new sfn.StateMachine(this, 'PipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(chain),
      timeout: cdk.Duration.minutes(10)
    });

    const dispatcherFn = new PythonFunction(this, 'DispatcherFn', {
      entry: entryPath,
      index: 'dispatcher.py',
      handler: 'handler',
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        ...envVars,
        STATE_MACHINE_ARN: this.stateMachine.stateMachineArn
      }
    });

    dispatcherFn.addEventSource(new lambdaEventSources.SqsEventSource(props.storage.ingestionQueue));

    props.storage.filesTable.grantReadWriteData(dispatcherFn);
    props.storage.jobsTable.grantReadWriteData(dispatcherFn);
    props.storage.ingestionQueue.grantConsumeMessages(dispatcherFn);
    this.stateMachine.grantStartExecution(dispatcherFn);

    this.ingestionRoleArn = vectorIngestFn.role?.roleArn || '';

    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachineArn });
  }
}
