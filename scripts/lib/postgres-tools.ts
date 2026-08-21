import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  sslMode?: string;
};

export function parseDatabaseTarget(connectionString: string): DatabaseTarget {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('A PostgreSQL connection string is required.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('The PostgreSQL connection string must name a database.');
  return {
    host: url.hostname,
    port: url.port || '5432',
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: url.searchParams.get('sslmode') ?? undefined,
  };
}

export function postgresEnvironment(target: DatabaseTarget): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    ...(target.sslMode ? { PGSSLMODE: target.sslMode } : {}),
  };
}

export async function resolvePostgresTool(name: 'pg_dump' | 'pg_restore' | 'createdb' | 'dropdb' | 'psql'): Promise<string> {
  const extension = process.platform === 'win32' ? '.exe' : '';
  if (process.env.PG_BIN) {
    const candidate = path.join(path.resolve(process.env.PG_BIN), `${name}${extension}`);
    await access(candidate);
    return candidate;
  }
  return `${name}${extension}`;
}

export async function runPostgresTool(
  executable: string,
  args: string[],
  target: DatabaseTarget,
  options: { captureOutput?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: postgresEnvironment(target),
      stdio: options.captureOutput ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${path.basename(executable)} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
  });
}
