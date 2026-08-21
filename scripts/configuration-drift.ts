import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import {
  auditDeploymentConfiguration,
  compareDeploymentConfigurations,
  deploymentConfigurationPassed,
} from '../src/lib/deployment-configuration';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function readEnvironment(pathValue: string): Record<string, string> {
  return parse(readFileSync(resolve(pathValue), 'utf8'));
}

const stagingPath = argument('--staging');
const productionPath = argument('--production');
if (!stagingPath || !productionPath) {
  throw new Error('Use --staging <environment file> and --production <environment file>.');
}

const staging = readEnvironment(stagingPath);
const production = readEnvironment(productionPath);
const stagingChecks = auditDeploymentConfiguration(staging);
const productionChecks = auditDeploymentConfiguration(production);
const differences = compareDeploymentConfigurations(staging, production);
const passed = deploymentConfigurationPassed(stagingChecks)
  && deploymentConfigurationPassed(productionChecks)
  && !differences.some((item) => item.status === 'DANGEROUS_DIFFERENCE');

process.stdout.write(`${JSON.stringify({
  status: passed ? 'PASS' : 'FAIL',
  note: 'Secret values are never printed or compared.',
  staging: stagingChecks,
  production: productionChecks,
  differences,
}, null, 2)}\n`);

if (!passed) process.exitCode = 1;
