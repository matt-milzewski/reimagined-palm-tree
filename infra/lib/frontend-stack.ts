import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

export class FrontendStack extends cdk.Stack {
  public readonly hostingBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName =
      this.node.tryGetContext('domainName') ||
      process.env.DOMAIN_NAME ||
      '';
    const includeWww =
      this.node.tryGetContext('includeWww') !== false &&
      process.env.INCLUDE_WWW !== 'false';

    this.hostingBucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'FrontendOAI');
    this.hostingBucket.grantRead(originAccessIdentity);

    const hasDomain = Boolean(domainName);
    const hostedZone = hasDomain ? route53.HostedZone.fromLookup(this, 'FrontendZone', { domainName }) : undefined;
    const domainNames = hasDomain ? [domainName, ...(includeWww ? [`www.${domainName}`] : [])] : undefined;

    const certificate = hasDomain
      ? new acm.DnsValidatedCertificate(this, 'FrontendCertificate', {
          domainName,
          hostedZone: hostedZone!,
          subjectAlternativeNames: includeWww ? [`www.${domainName}`] : undefined,
          region: 'us-east-1'
        })
      : undefined;

    this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(this.hostingBucket, { originAccessIdentity }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS
      },
      defaultRootObject: 'index.html',
      domainNames,
      certificate
    });

    if (hasDomain && hostedZone) {
      new route53.ARecord(this, 'FrontendAliasApexA', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
      });
      new route53.AaaaRecord(this, 'FrontendAliasApexAAAA', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
      });
      if (includeWww) {
        new route53.ARecord(this, 'FrontendAliasWwwA', {
          zone: hostedZone,
          recordName: `www.${domainName}`,
          target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
        });
        new route53.AaaaRecord(this, 'FrontendAliasWwwAAAA', {
          zone: hostedZone,
          recordName: `www.${domainName}`,
          target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution))
        });
      }
    }

    new cdk.CfnOutput(this, 'FrontendBucketName', { value: this.hostingBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendDistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'FrontendUrl', { value: `https://${this.distribution.domainName}` });
    if (hasDomain) {
      new cdk.CfnOutput(this, 'FrontendCustomDomain', {
        value: `https://${domainName}`
      });
    }
  }
}
