import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function sha256(pathValue: string): string {
  return createHash('sha256').update(readFileSync(pathValue)).digest('hex');
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};
const optionalFiles = [
  process.env.RELEASE_SBOM_FILE,
  process.env.RELEASE_CONTAINER_SCAN_FILE,
  process.env.RELEASE_IMAGE_RECORD_FILE,
].filter((value): value is string => Boolean(value));
const artifacts = [resolve('package-lock.json'), ...optionalFiles.map((pathValue) => resolve(pathValue))]
  .filter((pathValue) => existsSync(pathValue))
  .map((pathValue) => ({ file: basename(pathValue), sha256: sha256(pathValue) }));
const status = git(['status', '--porcelain', '--untracked-files=no']);

process.stdout.write(`${JSON.stringify({
  createdAt: new Date().toISOString(),
  source: {
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    clean: status.length === 0,
  },
  application: {
    version: manifest.version,
    node: process.version,
    next: manifest.dependencies.next,
    authenticationLibrary: manifest.dependencies['better-auth'],
  },
  build: {
    release: process.env.APP_RELEASE ?? null,
    timestamp: process.env.BUILD_TIMESTAMP ?? null,
    imageDigest: process.env.RELEASE_IMAGE_DIGEST ?? null,
  },
  artifacts,
}, null, 2)}\n`);
