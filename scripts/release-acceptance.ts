import 'dotenv/config';
import { execFileSync, spawn } from 'node:child_process';

function run(command: string, args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...extraEnv }, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with code ${code}.`)));
  });
}

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run release acceptance through npm so the package-manager path is available.');
const repositoryStatus = execFileSync('git', ['status','--porcelain'], { encoding: 'utf8' }).trim();
if (repositoryStatus) throw new Error('Release acceptance requires a clean repository.');
const steps: Array<{ name: string; command: string; args: string[] }> = [
  { name: 'lint', command: process.execPath, args: [npmCli,'run','lint'] },
  { name: 'typecheck', command: process.execPath, args: [npmCli,'run','typecheck'] },
  { name: 'tests', command: process.execPath, args: [npmCli,'test'] },
  { name: 'migration performance', command: process.execPath, args: [npmCli,'run','test:migration-performance'] },
  { name: 'production build', command: process.execPath, args: [npmCli,'run','build'] },
  { name: 'security matrix', command: process.execPath, args: [npmCli,'run','test:security'] },
  { name: 'full-system data simulation', command: process.execPath, args: [npmCli,'run','test:phase11'] },
  { name: 'dependency audit', command: process.execPath, args: [npmCli,'run','audit:production'] },
  { name: 'supply-chain audit', command: process.execPath, args: [npmCli,'run','audit:supply-chain'] },
  { name: 'static security audit', command: process.execPath, args: [npmCli,'run','audit:static-security'] },
  { name: 'privacy audit', command: process.execPath, args: [npmCli,'run','audit:privacy'] },
  { name: 'secret scan', command: process.execPath, args: [npmCli,'run','scan:secrets'] },
];
const completed: string[] = [];
completed.push('clean repository');
for (const step of steps) {
  await run(step.command, step.args);
  completed.push(step.name);
}
if (process.env.RELEASE_RUN_DATABASE_GATES === 'true') {
  await run(process.execPath, [npmCli,'run','db:preflight']);
  await run(process.execPath, [npmCli,'run','test:postgis']);
  await run(process.execPath, [npmCli,'run','test:database-security']);
  await run(process.execPath, [npmCli,'run','test:migration']);
  await run(process.execPath, [npmCli,'run','test:governance-performance']);
  await run(process.execPath, [npmCli,'run','test:automation']);
  await run(process.execPath, [npmCli,'run','db:audit-integrity']);
  await run(process.execPath, [npmCli,'run','test:restore']);
  completed.push(
    'migration preflight',
    'PostGIS staging gate',
    'database privilege acceptance',
    'migration acceptance',
    'governance performance',
    'automation acceptance',
    'audit integrity',
    'backup and restore',
  );
}
if (process.env.SMOKE_BASE_URL) {
  await run(process.execPath, [npmCli,'run','test:smoke']);
  completed.push('deployment smoke');
}
process.stdout.write(`${JSON.stringify({ status: 'PASS', release: process.env.APP_RELEASE ?? process.env.BUILD_COMMIT ?? 'local', completed }, null, 2)}\n`);
