import * as cdk from '@aws-cdk/core';
import * as iam from '@aws-cdk/aws-iam';
import { Stack, Stage, Construct, StageProps} from '@aws-cdk/core';
import { CfnModel, CfnEndpointConfig, CfnEndpoint } from  '@aws-cdk/aws-sagemaker';
import * as ssm from '@aws-cdk/aws-ssm';
import { v4 as uuid } from 'uuid';


const id: string = uuid();

export interface SagemakerEndpointProps extends cdk.StackProps {
  releaseVersion: string;
  environmentName: string;
  endpointName: string;
  modelName: string;
  projectName: string;
  env: cdk.Environment;
};

export class SagemakerEndpointStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: SagemakerEndpointProps) {
    super(scope, id, props);
    
    // Document Policy
    const policyJson = {
      ​"Version": "2012-10-17", 
      "Statement": [ 
        {
          ​"Effect": "Allow", 
          "Action": [ 
            "cloudwatch:PutMetricData", 
            "logs:CreateLogStream", 
            "logs:PutLogEvents", 
            "logs:CreateLogGroup", 
            "logs:DescribeLogStreams", 
            "s3:GetObject", 
            "s3:PutObject", 
            "s3:ListBucket", 
            "ecr:GetAuthorizationToken", 
            "ecr:BatchCheckLayerAvailability", 
            "ecr:GetDownloadUrlForLayer", 
            "ecr:BatchGetImage",
            'ssm:GetParameter',
          ], 
          "Resource": "*" 
        }​ 
      ] 
    }​;
    const policyDocument = iam.PolicyDocument.fromJson(policyJson);
    
    // Create Role
    const role = new iam.Role(this, 'IAMRolePolicy', {
      assumedBy: new iam.ServicePrincipal('sagemaker.amazonaws.com'),
      inlinePolicies: {
        'root': policyDocument,
      },
    });
    
  
    // Create Model 
    
    var RepoVersion = ssm.StringParameter.valueForStringParameter(this, `/${props.environmentName}/${props.projectName}/sagemakerImage/repo-version`);
    var modelURI = `${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com/${props.environmentName}-${props.modelName}:${RepoVersion}`;
    
    if (props.environmentName == 'prod') {
       RepoVersion = ssm.StringParameter.valueForStringParameter(this, `/staging/${props.projectName}/sagemakerImage/repo-version`);
       modelURI = `${props.env.account}.dkr.ecr.${props.env.region}.amazonaws.com/staging-${props.modelName}:${RepoVersion}`;
    }
    
    const endpoint_model = new CfnModel(this, `CreateSagemakerModel`, {
      executionRoleArn: role.roleArn,
      primaryContainer: {
        image: modelURI,
      },
      modelName: `${props.environmentName}-DuplicationDetection-${RepoVersion}`, 
    });
    
      
    
    
    // Create Endpoint Config
    const endpoint_config = new CfnEndpointConfig(this, `${props.environmentName}-CreateSagemakerEndpointConfig`, {
      endpointConfigName: `${props.environmentName}-${props.endpointName}Conifg-${RepoVersion}`, 
      productionVariants: [{
          initialInstanceCount: 1,
          initialVariantWeight: 1.0,
          instanceType: 'ml.t2.large',
          modelName: endpoint_model.modelName!, 
          variantName: endpoint_model.modelName!
        }],
      });
      
   

    // Create Endpoint
    const endpoint = new CfnEndpoint(this, `CreateSagemakerEndpoint${id}`, {
      endpointConfigName: endpoint_config.attrEndpointConfigName,
      endpointName: `${props.environmentName}-${props.endpointName}`,
    });
    
    endpoint_config.node.addDependency(endpoint_model);
    endpoint.node.addDependency(endpoint_config);
    
    
  };
  
};

export class SagemakerEndpointStage extends Stage {

  constructor(scope: Construct, id: string, props: SagemakerEndpointProps) {
    super(scope, id, props);

    new SagemakerEndpointStack(this, `${props.environmentName}-DuplicateDetectionCreateEndpoint`, 
    {
      projectName: props.projectName,
      endpointName: props.endpointName,
      environmentName: props.environmentName,
      modelName: props.modelName,
      releaseVersion: props.releaseVersion,
      env: props.env
    });
    
    // if (props.environmentName == 'staging') {
    //   new SagemakerEndpointStack(this, `prod-DuplicateDetectionCreateEndpoint`, 
    // {
    //   projectName: props.projectName,
    //   endpointName: props.endpointName,
    //   environmentName: 'prod',
    //   modelName: props.modelName,
    //   releaseVersion: props.releaseVersion,
    //   env: props.env
    // });
    // }
  }
};