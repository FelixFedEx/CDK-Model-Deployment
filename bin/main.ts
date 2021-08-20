#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { BuildModelStack, BuildImageStack } from '../lib/dd-cicd-stack'

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
// for development, use account/region from cdk cli
const env = {
  account,
  region: process.env.CDK_DEFAULT_REGION,
};

const envConfig = app.node.tryGetContext(account!);
//const environmentName = envConfig.envName;
// const instanceName = envConfig.instanceName;

const build_model_statck = new BuildModelStack(app, `BuildModel`, 
{
  projectName: 'BuildModel',
  httpsGitUrl: 'https://github.com/FelixFedEx/ML-Pipeline-Template.git',
  artifactName: 'ModelArtifact',
  appPath: 'packages/dd_model/',
  env: env,
});


const build_image_statck = new BuildImageStack(app, `BuildImage`, 
{
  projectName: 'BuildImage',
  httpsGitUrl: 'https://github.com/FelixFedEx/ML-Model-Containerizaton.git',
  artifactName: 'ImageArtifact',
  appPath: 'dd_deployment/ml_api/',
  env: env,
});


build_image_statck.node.addDependency(build_model_statck);
app.synth();