#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { PipelineStack } from './pipeline-stack';
import { DataEventTriggerStack } from './dataEvevtTrigger-stack';
import { SagemakerEndpointStack } from './endpoint-stack';
const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const env = {
  account,
  region: process.env.CDK_DEFAULT_REGION,
};



const dataEventTriggerStack = new DataEventTriggerStack(app, 'testing-dd-DataEventTrigger', {
  environmentName: 'testing',
  projectName: 'Duplicate-Detection-Model',
  env: env
});

const testingPipeline = new PipelineStack(app, 'testing-dd-PipelineStack', {
  modelName: 'duplicate-detection-model',
  releaseVersion: '0.1.0',
  environmentName: 'testing',
  preBucketName: 'sherlock-duplicate-detection-data-store-us-west-2',
  httpsCloneUrl: 'https://github.azc.ext.hp.com/CMITSW/duplicate-detection.git',
  branch: 'dev',
  modelDir: 'models/packages/duplicate_detection_model/',
  buildDir: 'build/ml_api/', 
  artifactName: 'testing-DuplicateDetectionModelArtifact',
  modelDataDir: 's3://sherlock-duplicate-detection-data-store-us-west-2/base/',
  modelDataName: 'explore_data.csv',
  endpointName: 'DuplicationDetectionEndpoint',
  projectName: 'Duplicate-Detection-Model',
  env: env
});


const stagingAndProdPipeline = new PipelineStack(app, 'staging-dd-PipelineStack', {
  modelName: 'duplicate-detection-model',
  releaseVersion: '0.1.0',
  environmentName: 'staging',
  preBucketName: 'sherlock-duplicate-detection-data-store-us-west-2',
  httpsCloneUrl: 'https://github.azc.ext.hp.com/CMITSW/duplicate-detection.git',
  branch: 'qa',
  modelDir: 'models/packages/duplicate_detection_model/',
  buildDir: 'build/ml_api/', 
  artifactName: 'staging-DuplicateDetectionModelArtifact',
  modelDataDir: 's3://sherlock-duplicate-detection-data-store-us-west-2/base/',
  modelDataName: 'explore_data.csv',
  endpointName: 'DuplicationDetectionEndpoint',
  projectName: 'Duplicate-Detection-Model',
  env: env
});






dataEventTriggerStack.addDependency(testingPipeline)
dataEventTriggerStack.addDependency(stagingAndProdPipeline)


app.synth();