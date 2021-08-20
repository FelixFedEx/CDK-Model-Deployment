import { Stack, Construct } from '@aws-cdk/core';
import * as cdk from '@aws-cdk/core';
import { Repository } from '@aws-cdk/aws-ecr';
import * as s3 from '@aws-cdk/aws-s3';
import * as codebuild from '@aws-cdk/aws-codebuild';


export interface BuildModelProps extends cdk.StackProps {
  projectName: string;
  httpsGitUrl: string;
  artifactName: string;
  appPath: string;
  //releaseVersion: string;
  env: cdk.Environment;
};

export class BuildModelStack extends Stack {
  constructor(scope: Construct, id: string, props: BuildModelProps) {
    super(scope, id, props);

    const branch = 'master'
    // Bucket for codebuild
    const preBucketName = 'dd-test-bucket-us-east-1'.toLocaleLowerCase();
    const preBucket = s3.Bucket.fromBucketName(this, 'CICDArtifactBucket', preBucketName);

    const gitHubEnterpriseSource = codebuild.Source.gitHubEnterprise({
      httpsCloneUrl: props.httpsGitUrl, 
      branchOrRef: branch,
    });

    const codebuildArtifact = codebuild.Artifacts.s3({
      bucket: preBucket,
      includeBuildId: false,
      packageZip: false,
      name: props.artifactName,
    });

    const codebuildPoject = new codebuild.Project(this, 'createModelProject', {
      source: gitHubEnterpriseSource,
      projectName: this.stackName,
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
              `cd ${props.appPath}`,
              // run unit tests
              //'tox',
              // generate the distribution package
              'tox -e install_locally'
            ],
          },
          post_build: {
            commands: [
            ]
          },
        },
        artifacts: {
          files: [
            `${props.appPath}dist/*.tar.gz`
          ],
          'discard-paths': 'yes',
        },
      }),
    });
  };
};


export class BuildImageStack extends Stack {
  constructor(scope: Construct, id: string, props: BuildModelProps) {
    super(scope, id, props);

    const branch = 'master'
    // Bucket for codebuild
    const preBucketName = 'dd-test-bucket-us-east-1'.toLocaleLowerCase();
    const preBucket = s3.Bucket.fromBucketName(this, 'CICDArtifactBucket', preBucketName);
    
    const gitHubEnterpriseSource = codebuild.Source.gitHubEnterprise({
      httpsCloneUrl: props.httpsGitUrl, 
      branchOrRef: branch,
    });

    const codebuildArtifact = codebuild.Artifacts.s3({
      bucket: preBucket,
      includeBuildId: false,
      packageZip: false,
      name: props.artifactName,
    });

    const repo = new Repository(this, props.appPath, {
      repositoryName: props.appPath,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const codebuildPoject = new codebuild.Project(this, 'triggerCDKPipelineProject', {
      source: gitHubEnterpriseSource,
      projectName: this.stackName,
      badge: true,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_4_0,
        privileged: true,
      },
      artifacts: codebuildArtifact,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              `aws s3 cp s3://dd-test-bucket-us-east-1/ModelArtifact/dd-model-0.1.0.tar.gz ${props.appPath}`,
              'echo Logging in to Amazon ECR...',
              '$(aws ecr get-login --no-include-email --region $AWS_DEFAULT_REGION)',
            ],
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'echo Building the Docker image...',
              `cd ${props.appPath}`,
              `docker build -t ${repo.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION --build-arg PACKAGE_FILE="duplicate-detection-model-0.1.0.tar.gz" .`,
              `docker tag ${repo.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION ${repo.repositoryUri}:$(date +%Y%m%d)`,
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
              'echo Pushing the Docker image...',
              `docker push ${repo.repositoryUri}:$CODEBUILD_RESOLVED_SOURCE_VERSION`,
              `docker push ${repo.repositoryUri}:$(date +%Y%m%d)`,
            ],
          },
        },
      }),
    });
    
    // Grant Codebuild Role to access S3 bucket and ECR
    preBucket.grantReadWrite(codebuildPoject.role!);
    repo.grantPullPush(codebuildPoject.role!);
  };
};
