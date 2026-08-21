import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const reviewedInstallScripts = new Map([
  ['node_modules/@esbuild-kit/core-utils/node_modules/esbuild', '0.18.20'],
  ['node_modules/esbuild', '0.25.12'],
  ['node_modules/fsevents', '2.3.3'],
  ['node_modules/tsx/node_modules/esbuild', '0.28.2'],
  ['node_modules/unrs-resolver', '1.12.2'],
]);

const errors = [];
const directDependencies = {
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.optionalDependencies,
};

for (const [name, specifier] of Object.entries(directDependencies)) {
  if (/^(?:git|https?|file|link|github|workspace):/i.test(specifier) || specifier.includes('/')) {
    errors.push(`Direct dependency ${name} uses a non-registry specifier: ${specifier}`);
  }
}

for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
  if (!packagePath || entry.link) continue;
  if (entry.inBundle) {
    const packageMarker = '/node_modules/';
    const parentPath = packagePath.slice(0, packagePath.lastIndexOf(packageMarker));
    const parent = lock.packages?.[parentPath];
    if (!parent?.resolved?.startsWith('https://registry.npmjs.org/') || !parent.integrity?.startsWith('sha512-')) {
      errors.push(`${packagePath} is bundled by a package without verified registry integrity.`);
    }
    continue;
  }
  if (!entry.resolved?.startsWith('https://registry.npmjs.org/')) {
    errors.push(`${packagePath} is not resolved from the npm registry.`);
  }
  if (!entry.integrity?.startsWith('sha512-')) {
    errors.push(`${packagePath} does not use a SHA-512 integrity value.`);
  }
  if (entry.hasInstallScript && reviewedInstallScripts.get(packagePath) !== entry.version) {
    errors.push(`${packagePath}@${entry.version ?? 'unknown'} has an unreviewed install script.`);
  }
}

for (const [packagePath, version] of reviewedInstallScripts) {
  const entry = lock.packages?.[packagePath];
  if (!entry?.hasInstallScript || entry.version !== version) {
    errors.push(`Reviewed install-script entry is stale: ${packagePath}@${version}.`);
  }
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Supply-chain audit passed for ${Object.keys(lock.packages ?? {}).length - 1} locked packages and ${reviewedInstallScripts.size} reviewed install scripts.\n`);
}
