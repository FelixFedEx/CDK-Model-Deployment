import * as cdk from '@aws-cdk/core';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as ec2 from  '@aws-cdk/aws-ec2';

export interface SagemakerEndpointProps extends cdk.StackProps {
};

export class SagemakerEndpointStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: SagemakerEndpointProps) {
    super(scope, id, props);

    const modelURI = 'MODELURI';

    // Create Model
    new tasks.SageMakerCreateModel(this, 'Sagemaker', {
        modelName: 'MyModel',
        primaryContainer: new tasks.ContainerDefinition({
          image: tasks.DockerImage.fromRegistry(modelURI),
        }),
      });

      // Create Endpoint Config
      new tasks.SageMakerCreateEndpointConfig(this, 'SagemakerEndpointConfig', {
        endpointConfigName: 'DDEndpointConfig',
        productionVariants: [{
            initialInstanceCount: 1,
            initialVariantWeight: 1.0,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.M4, ec2.InstanceSize.LARGE),
              modelName: 'MyModel',
              variantName: 'awesome-variant',
         }],
      });

      // Create Endpoint
      new tasks.SageMakerCreateEndpoint(this, 'SagemakerEndpoint', {
        endpointName: 'DDEndpoint',
        endpointConfigName: 'DDEndpointConfig',
      });

  };
};
