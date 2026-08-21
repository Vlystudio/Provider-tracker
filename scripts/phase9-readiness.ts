import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createPhase9EvidenceTemplate,
  evaluatePhase9Readiness,
  parsePhase9Manifest,
} from '../src/lib/phase9-readiness';

if (process.argv.includes('--template')) {
  process.stdout.write(`${JSON.stringify(createPhase9EvidenceTemplate(), null, 2)}\n`);
  process.exit(0);
}

const fileIndex = process.argv.indexOf('--file');
const fileValue = fileIndex === -1 ? process.env.PHASE9_EVIDENCE_FILE : process.argv[fileIndex + 1];
if (!fileValue) {
  throw new Error('Use --file <evidence.json> or set PHASE9_EVIDENCE_FILE. Use --template to create a blank record.');
}

const manifest = parsePhase9Manifest(JSON.parse(readFileSync(resolve(fileValue), 'utf8')));
const evaluation = evaluatePhase9Readiness(manifest);
process.stdout.write(`${JSON.stringify({
  ...evaluation,
  release: {
    commitRecorded: Boolean(manifest.release.commit),
    imageDigestRecorded: /^sha256:[0-9a-f]{64}$/i.test(manifest.release.imageDigest),
  },
}, null, 2)}\n`);

if (!evaluation.status.startsWith('PRODUCTION PILOT APPROVED')) process.exitCode = 1;
