import * as s3 from '@aws-cdk/aws-s3';
import * as cd from "@aws-cdk/aws-cloudtrail";
import * as targets from "@aws-cdk/aws-events-targets";
import * as cdk from '@aws-cdk/core';
import * as ssm from '@aws-cdk/aws-ssm';
import * as cp from "@aws-cdk/aws-codepipeline";

export interface DataEventTriggerProps extends cdk.StackProps {
  environmentName: string; 
  projectName: string;
  env: cdk.Environment;
};

export class DataEventTriggerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: DataEventTriggerProps) {
    super(scope, id, props);
  
    
   
   const bucketName = ssm.StringParameter.fromStringParameterAttributes(this, "DataEventTriggerBucketName", {
        parameterName: `/${props.environmentName}/${props.projectName}/S3EventBucket/BucketName`,
      // 'version' can be specified but is optional.
    }).stringValue;
   
   const  bucket = s3.Bucket.fromBucketName(this, "triggerBucket", bucketName)

    const trail = new cd.Trail(this, 'Testing-duplicate-detection-cloudtrail-us-west-2',{
      managementEvents: cd.ReadWriteType.ALL,
      trailName:`${props.environmentName}-${props.projectName}-CloudTrail`,
    });

    trail.addS3EventSelector([{
      bucket: bucket, 
      
    }]);
    
    
    //Import pipelineARN from SSM
    const testingPipelineARN = ssm.StringParameter.fromStringParameterAttributes(this, "testing-pipeline", {
        parameterName: `/testing/Duplicate-Detection-Model/duplicate-detection-cdkpipeline/pipelineArnSsm`,
      }).stringValue;
    const tpa =  cp.Pipeline.fromPipelineArn(this, "importTestingPipeline", testingPipelineARN)
    
    const stagingPipelineARN = ssm.StringParameter.fromStringParameterAttributes(this, "staging-pipeline", {
        parameterName: `/staging/Duplicate-Detection-Model/duplicate-detection-cdkpipeline/pipelineArnSsm`,
      }).stringValue;
    const spa =  cp.Pipeline.fromPipelineArn(this, "importStagingPipeline", stagingPipelineARN)
    
   
    // Defines an AWS CloudWatch event that triggers when an object at the specified paths (keys) in this bucket are written to.
    bucket.onCloudTrailWriteObject('updatedTestingArtifactEvents', {
      paths: ["base/cdk-trigger.txt"],
      target: new targets.CodePipeline(tpa),
     
    });
    bucket.onCloudTrailWriteObject('updatedStagingArtifactEvents', {
      paths: ["base/cdk-trigger.txt"],
      target: new targets.CodePipeline(spa),
     
    });
  }
}
