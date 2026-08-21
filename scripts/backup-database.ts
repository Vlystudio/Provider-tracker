import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseDatabaseTarget, resolvePostgresTool, runPostgresTool } from './lib/postgres-tools';

const connectionString = process.env.DATABASE_URL?.trim();
const environment = process.env.BACKUP_ENVIRONMENT?.trim().toLowerCase();
const destinationValue = process.env.BACKUP_DESTINATION?.trim();
if (!connectionString) throw new Error('DATABASE_URL is required.');
if (!environment || !/^[a-z][a-z0-9-]{1,31}$/.test(environment)) {
  throw new Error('BACKUP_ENVIRONMENT must be a short environment name such as staging or production.');
}
if (!destinationValue || !path.isAbsolute(destinationValue)) {
  throw new Error('BACKUP_DESTINATION must be an absolute directory outside the repository.');
}

const destination = path.resolve(destinationValue);
const repository = path.resolve(process.cwd());
if (destination === repository || destination.startsWith(`${repository}${path.sep}`)) {
  throw new Error('BACKUP_DESTINATION must be outside the application repository.');
}

const target = parseDatabaseTarget(connectionString);
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const safeDatabase = target.database.replace(/[^a-zA-Z0-9_-]/g, '_');
const baseName = `${environment}-${safeDatabase}-${timestamp}`;
const backupPath = path.join(destination, `${baseName}.dump`);
const checksumPath = `${backupPath}.sha256`;
const metadataPath = `${backupPath}.json`;

await mkdir(destination, { recursive: true });
const pgDump = await resolvePostgresTool('pg_dump');
await runPostgresTool(pgDump, [
  '--format=custom',
  '--compress=6',
  '--no-owner',
  '--no-acl',
  '--file', backupPath,
], target);

const contents = await readFile(backupPath);
const checksum = createHash('sha256').update(contents).digest('hex');
const details = await stat(backupPath);
await writeFile(checksumPath, `${checksum}  ${path.basename(backupPath)}\n`, { encoding: 'utf8', mode: 0o600 });
await writeFile(metadataPath, `${JSON.stringify({
  createdAt: new Date().toISOString(),
  environment,
  database: target.database,
  host: target.host,
  port: target.port,
  file: path.basename(backupPath),
  bytes: details.size,
  sha256: checksum,
  format: 'PostgreSQL custom',
}, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

process.stdout.write(`${JSON.stringify({ status: 'PASS', backupPath, checksumPath, metadataPath, bytes: details.size })}\n`);
