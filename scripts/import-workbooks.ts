import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildImportPlan, safeImportSummary } from '../src/lib/import/reconcile';
import { parseWorkbook } from '../src/lib/import/workbook-parser';
import type { WorkbookKind } from '../src/lib/import/types';
import { applyImportPlan } from '../src/lib/import/apply';

type CliOptions = {
  sources: Array<{ kind: WorkbookKind; filePath: string }>;
  outputPath: string | null;
  apply: boolean;
};

function usage() {
  return [
    'URA workbook importer',
    '',
    'Dry run (default):',
    '  npm run import:workbooks -- --admin <ADMIN.xlsx> --user <USER.xlsx>',
    '',
    'Options:',
    '  --admin <path>   Admin master workbook',
    '  --user <path>    User active workbook',
    '  --output <path>  Write a redacted JSON reconciliation summary',
    '  --apply          Apply the idempotent plan to DATABASE_URL',
    '  --help           Show this help',
  ].join('\n');
}

function parseArgs(args: string[]): CliOptions {
  const referenceDir = process.env.WORKBOOK_REFERENCE_DIR ?? 'reference';
  const sources: Array<{ kind: WorkbookKind; filePath: string }> = [];
  let outputPath: string | null = null;
  let apply = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    if (argument === '--admin' || argument === '--user' || argument === '--output') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a path.`);
      index += 1;
      if (argument === '--output') outputPath = path.resolve(value);
      else sources.push({ kind: argument === '--admin' ? 'admin' : 'user', filePath: path.resolve(value) });
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!sources.length) {
    sources.push(
      {
        kind: 'admin',
        filePath: path.resolve(referenceDir, 'URA_Provider_Availability_Tracker_ADMIN_MASTER.xlsx'),
      },
      {
        kind: 'user',
        filePath: path.resolve(referenceDir, 'URA_Provider_Availability_Tracker_USER_ACTIVE.xlsx'),
      },
    );
  }

  const duplicateKinds = sources.filter(
    (source, index) => sources.findIndex((candidate) => candidate.kind === source.kind) !== index,
  );
  if (duplicateKinds.length) throw new Error('Provide at most one admin and one user workbook.');
  if (outputPath && path.extname(outputPath).toLowerCase() !== '.json') {
    throw new Error('--output must use a .json extension.');
  }
  return { sources, outputPath, apply };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const parsed = await Promise.all(
    options.sources.map((source) => parseWorkbook(source.filePath, source.kind)),
  );
  const plan = buildImportPlan(parsed);
  const summary = safeImportSummary(plan);

  if (options.outputPath) {
    await mkdir(path.dirname(options.outputPath), { recursive: true });
    await writeFile(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  }

  console.log(JSON.stringify(summary, null, 2));
  if (options.apply) {
    const applied = await applyImportPlan(plan);
    console.log('\nDatabase apply result:');
    console.log(JSON.stringify(applied, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('\n' + usage());
  process.exitCode = 1;
});
