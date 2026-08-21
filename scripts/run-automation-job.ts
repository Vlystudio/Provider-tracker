import 'dotenv/config';

import { parseArgs } from 'node:util';
import { automationJobTypes } from '../src/lib/automation';
import { runAutomationJob } from '../src/server/automation-runner';
import { closeDatabasePool } from '../src/server/database';

const { values } = parseArgs({
  options: {
    job: { type: 'string' },
    'execution-key': { type: 'string' },
    'scheduled-for': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

async function main() {
  if (!values.job || !automationJobTypes.includes(values.job as (typeof automationJobTypes)[number])) {
    throw new Error(`--job must be one of: ${automationJobTypes.join(', ')}`);
  }
  const scheduledFor = values['scheduled-for'] ? new Date(values['scheduled-for']) : new Date();
  if (Number.isNaN(scheduledFor.valueOf())) throw new Error('--scheduled-for must be a valid ISO timestamp.');
  const result = await runAutomationJob(values.job, {
    executionKey: values['execution-key'],
    scheduledFor,
    trigger: 'manual',
    dryRun: values['dry-run'],
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Automation failed.'}\n`);
  process.exitCode = 1;
}).finally(closeDatabasePool);
