import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tokenPatterns = [
  ['GitHub token', new RegExp(`gh${'[pousr]'}_[A-Za-z0-9]{20,}`, 'g')],
  ['GitHub fine-grained token', new RegExp(`github_${'pat'}_[A-Za-z0-9_]{20,}`, 'g')],
  ['AWS access key', new RegExp(`AK${'IA'}[0-9A-Z]{16}`, 'g')],
  ['Google API key', new RegExp(`AI${'za'}[A-Za-z0-9_-]{30,}`, 'g')],
  ['Slack token', new RegExp(`xo${'x'}[aboprs]-[A-Za-z0-9-]{10,}`, 'g')],
  ['Stripe live secret', new RegExp(`sk_${'live'}_[A-Za-z0-9]{16,}`, 'g')],
  ['Private key', new RegExp(`BEGIN (?:RSA |EC |OPENSSH )?PRIVATE ${'KEY'}`, 'g')],
] as const;

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter(Boolean);
const findings: string[] = [];

for (const file of files) {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (content.includes('\0')) continue;
  for (const [label, pattern] of tokenPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) findings.push(`${file}: possible ${label}`);
  }
}

const revisions = git(['rev-list', '--all']).split(/\r?\n/).filter(Boolean);
if (revisions.length) {
  const history = git(['log', '--all', '-p', '--no-ext-diff', '--no-textconv']);
  for (const [label, pattern] of tokenPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(history)) findings.push(`Git history contains a possible ${label}.`);
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} repository files and ${revisions.length} commit(s).`);
}
