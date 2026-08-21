import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';

function run(command: string, args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...extraEnv }, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}.`)));
  });
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const repositoryStatus = execFileSync('git', ['status','--porcelain'], { encoding: 'utf8' }).trim();
if (repositoryStatus) throw new Error('Release acceptance requires a clean repository.');
const steps: Array<{ name: string; command: string; args: string[] }> = [
  { name: 'lint', command: npm, args: ['run','lint'] },
  { name: 'typecheck', command: npm, args: ['run','typecheck'] },
  { name: 'tests', command: npm, args: ['test'] },
  { name: 'security matrix', command: npm, args: ['run','test:security'] },
  { name: 'production build', command: npm, args: ['run','build'] },
  { name: 'dependency audit', command: npm, args: ['run','audit:production'] },
  { name: 'secret scan', command: npm, args: ['run','scan:secrets'] },
];
const completed: string[] = [];
completed.push('clean repository');
for (const step of steps) {
  await run(step.command, step.args);
  completed.push(step.name);
}
if (process.env.RELEASE_RUN_DATABASE_GATES === 'true') {
  await run(npm, ['run','db:preflight']);
  await run(npm, ['run','test:postgis']);
  completed.push('migration preflight','PostGIS staging gate');
}
if (process.env.SMOKE_BASE_URL) {
  await run(npm, ['run','test:smoke']);
  completed.push('deployment smoke');
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', release: process.env.APP_RELEASE ?? process.env.BUILD_COMMIT ?? 'local', completed }, null, 2)}\n`);
