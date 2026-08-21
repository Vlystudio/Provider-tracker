import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = path.join(root, 'src');
const findings = [];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

const sourceFiles = filesUnder(sourceRoot).filter((file) => /\.(?:ts|tsx|js|jsx)$/.test(file) && !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
const forbiddenRuntimePatterns = [
  { name: 'dynamic code execution', expression: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { name: 'raw HTML injection', expression: /dangerouslySetInnerHTML|\.innerHTML\s*=/ },
  { name: 'runtime process execution', expression: /(?:node:)?child_process|\bexecFile?Sync?\s*\(|\bspawnSync?\s*\(/ },
  { name: 'server-side VM execution', expression: /from\s+['"](?:node:)?vm(?:\/[^'"]*)?['"]|require\(\s*['"](?:node:)?vm/ },
];

for (const file of sourceFiles) {
  const content = readFileSync(file, 'utf8');
  for (const pattern of forbiddenRuntimePatterns) {
    if (pattern.expression.test(content)) findings.push(`${path.relative(root, file)}: ${pattern.name}`);
  }
  if (/process\.env\.NEXT_PUBLIC_(?:.*SECRET|.*TOKEN|.*PASSWORD|DATABASE_URL)/i.test(content)) {
    findings.push(`${path.relative(root, file)}: sensitive value uses a browser-exposed environment prefix`);
  }
}

const routeFiles = sourceFiles.filter((file) => file.endsWith(`${path.sep}route.ts`) && file.includes(`${path.sep}app${path.sep}api${path.sep}`));
for (const file of routeFiles) {
  const content = readFileSync(file, 'utf8');
  const mutates = /export\s+async\s+function\s+(?:POST|PUT|PATCH|DELETE)\b/.test(content);
  const authHandler = file.endsWith(path.join('api', 'auth', '[...all]', 'route.ts'));
  if (mutates && !authHandler && !content.includes('enforceSameOrigin(')) {
    findings.push(`${path.relative(root, file)}: mutation route does not call enforceSameOrigin`);
  }
}

if (!statSync(path.join(root, 'package-lock.json')).isFile()) findings.push('package-lock.json is missing');

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Static security audit passed for ${sourceFiles.length} runtime source files and ${routeFiles.length} API route files.\n`);
}
