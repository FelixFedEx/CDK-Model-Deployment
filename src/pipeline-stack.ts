import { Construct, SecretValue, Stack, StackProps } from '@aws-cdk/core';
import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as codebuild from '@aws-cdk/aws-codebuild';
import * as cp from '@aws-cdk/aws-codepipeline';
import * as cpa from '@aws-cdk/aws-codepipeline-actions';
import * as pipelines from '@aws-cdk/pipelines';
import * as targets from '@aws-cdk/aws-events-targets';
import { Repository } from '@aws-cdk/aws-ecr';
import * as iam from '@aws-cdk/aws-iam';
import { SagemakerEndpointStage } from './endpoint-stack';
import * as ssm from '@aws-cdk/aws-ssm';

export interface PipelineProps extends cdk.StackProps {
  modelName: string; 
  releaseVersion: string; 
  environmentName: string; 
  preBucketName: string; 
  httpsCloneUrl: string; 
  branch: string; 
  modelDir: string; 
  buildDir: string; 
  artifactName: string; 
  modelDataDir: string; 
  modelDataName: string; 
  endpointName: string; 
  projectName: string;
  env: cdk.Environment;
};


export class PipelineStack extends Stack {
    constructor(scope: Construct, id: string, props: PipelineProps) {
        super(scope, id, props);

        // Create Codepipeline required for gitHubEnterprise CICD
        const preBucket = s3.Bucket.fromBucketName(this, `${props.environmentName}-BuildModelStackPreBucket`, props.preBucketName);
        const pipeBucket = new s3.Bucket(this, `${props.environmentName}-DD-ArtifactBucketPipeline`, {
            bucketName: `${props.environmentName}-duplicate-detection-cdkpipeline`.toLocaleLowerCase(), ////////
            publicReadAccess: false,
            versioned: true,
            autoDeleteObjects: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        
        // Build Model Srouce
        const gitHubEnterpriseSource = codebuild.Source.gitHubEnterprise({
            httpsCloneUrl: props.httpsCloneUrl, 
            branchOrRef: props.branch,
        });
      
        const codebuildArtifact = codebuild.Artifacts.s3({
            bucket: preBucket,
            includeBuildId: false,
            packageZip: true,
            name: props.artifactName,
        });
      
        const codebuildPoject = new codebuild.Project(this, `${props.environmentName}-CreateModelCodebuildProject`, {
            source: gitHubEnterpriseSource,
            projectName: `${props.environmentName}-${props.modelName}-CreateModelCodebuildProject`,
            badge: true,
            environment: {
              buildImage: codebuild.LinuxBuildImage.STANDARD_4_0 ,
              privileged: true,
            },
            artifacts: codebuildArtifact,
            buildSpec: codebuild.BuildSpec.fromObject({
              version: '0.2',
              phases: {
                install: {
                  'runtime-versions': {
                    python: 3.8,
                  },
                  commands: [
                    'python -m pip install --upgrade pip',
                    'pip install tox',
                  ]
                },
                build: {
                  commands: [
                    // change directory
                    `cd ${props.modelDir}`,
                    // run unit tests
                    'tox',
                    // generate distribution package
                    'python setup.py sdist'
                  ],
                },
                post_build: {
                  commands: [
                  ]
                },
              },
              artifacts: {
                files: [
                  '**/*',
                ],
              },
            }),
        });

        preBucket.grantReadWrite(codebuildPoject.role!);

        
        // Create cdk Pipeline
        const sourceArtifact = new cp.Artifact();
        const cloudAssemblyArtifact = new cp.Artifact();

        const sourceAction = new cpa.S3SourceAction({
            actionName: 'S3',
            bucket: preBucket,
            bucketKey: props.artifactName,
            output: sourceArtifact,
            trigger: cpa.S3Trigger.NONE,
          });

        const synthAction = pipelines.SimpleSynthAction.standardNpmSynth({
            sourceArtifact,
            cloudAssemblyArtifact,
            installCommand: 'npm i -g npm && npm install',
        });

        const codePipeline = new cp.Pipeline(this, 'codePipeline', {
            artifactBucket: pipeBucket,
          });

        const pipeline = new pipelines.CdkPipeline(this, 'Pipeline', {
            codePipeline,
            cloudAssemblyArtifact,
            sourceAction,
            synthAction
        });

        // Defines an AWS CloudWatch event that triggers when an object at the specified paths (keys) in this bucket are written to.
        preBucket.onCloudTrailWriteObject('updatedArtifactEvents', {
            paths: [props.artifactName],
            target: new targets.CodePipeline(pipeline.codePipeline),
        });

        // Build Images     
        const buildRole = new iam.Role(this, 'buildRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
        });
        
        buildRole.addToPolicy(new iam.PolicyStatement({
            resources: ['*'],
            actions: [
              'ecr:GetDownloadUrlForLayer',
              'ecr:BatchGetImage',
              'ecr:BatchCheckLayerAvailability',
              's3:GetObject',
              'ssm:PutParameter',
            ],
        }));
      
        // Generate ECR Repos
        // The docker build stage is added if launching on testing env
        // AWS ECR resource name depends on repositoryName.
        const buildStage = pipeline.addStage('AppBuild');
        
        const repo = new Repository(this, props.modelName, {
            repositoryName: `${props.environmentName}-${props.modelName}`,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            lifecycleRules:[{description: 'only keep 10 images',maxImageCount: 10 }] ,
        });
    
            
        repo.grantPullPush(buildRole);

        buildStage.addActions(
            new cpa.CodeBuildAction({
                actionName: `${props.modelName}-deployment`,
                input: sourceArtifact,
                project: new codebuild.Project(this, `CodeBuild-${props.modelName}-deployment`, {
                    role: buildRole,
                    environment: {
                        buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
                        privileged: true,
                    },
                    buildSpec: this.getDockerBuildSpec(repo.repositoryUri, props),
                }),
            }),
        );
    
        const sagemaker_endpoint_stage = new SagemakerEndpointStage(this, `SagemakerEndpointStage`, {
          projectName: props.projectName,
          endpointName: props.endpointName,
          environmentName: props.environmentName,
          modelName: props.modelName,
          releaseVersion: props.releaseVersion,
          env: props.env
        });
        pipeline.addApplicationStage(sagemaker_endpoint_stage);
        
        // test by Hans
        const pipelineArn = new ssm.StringParameter(this, 'DDpipelineArnSSM', {
        description: "duplicate-detection pipeline's ARN",
        parameterName: `/${props.environmentName}/${props.projectName}/duplicate-detection-cdkpipeline/pipelineArnSsm`,
        stringValue: pipeline.codePipeline.pipelineArn,
        });
        
        // Deploy prod env
        if (props.environmentName == 'staging') {

          const prodSagemakerEndpoint = new SagemakerEndpointStage(this, `prod-SagemakerEndpointStage`, {
            projectName: props.projectName,
            endpointName: props.endpointName,
            environmentName: 'prod',
            modelName: props.modelName,
            releaseVersion: props.releaseVersion,
            env: props.env
          });
          pipeline.addApplicationStage(prodSagemakerEndpoint)
        } 


    };
    
    
    getDockerBuildSpec(repositoryUri: string, props: PipelineProps): codebuild.BuildSpec {
        return codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            pre_build: {
              commands: [
                'echo Copy tar.gz to dockerfile directory',
                `mv ${props.modelDir}dist/${props.modelName}-${props.releaseVersion}.tar.gz ${props.buildDir}`,
                'echo Change directory',
                `cd ${props.buildDir}`,
                'echo Copy explore_data file',
                `aws s3 cp ${props.modelDataDir}${props.modelDataName} .`,
              ],
            },
            build: {
              commands: [
                'echo Logging in to Amazon ECR...',
                '$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)',
                'echo Build started on `date`',
                'echo Building the Docker image...', 
                `docker build -t ${repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION \
                --build-arg PACKAGE_FILE="${props.modelName}-${props.releaseVersion}.tar.gz" \
                --build-arg EXPLORE_DATA="${props.modelDataName}" .`,
                'DATE=$(date +%Y%m%d%H%M%S)',
                `docker tag ${repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION ${repositoryUri}:$DATE`,
              ],
            },
            post_build: {
              commands: [
                'echo Build completed on `date`',
                'echo Pushing the Docker image...',
                `docker push ${repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION`,
                `docker push ${repositoryUri}:$DATE`,
                //`aws ssm put-parameter --name "/${props.modelName}/${props.environmentName}/cicd/repo-version" \
                // Follow naming rule of SSM in AWS Prod
                `aws ssm put-parameter --name "/${props.environmentName}/${props.projectName}/sagemakerImage/repo-version" \
                --type "String" --value $DATE --overwrite`, 
                `aws ssm put-parameter --name "/prod/${props.projectName}/sagemakerImage/repo-version" \
                --type "String" --value $DATE --overwrite`
              ],
            },
          },
        });
    }
};