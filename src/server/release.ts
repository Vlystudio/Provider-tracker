const safeReleasePattern = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const commitPattern = /^[a-fA-F0-9]{7,40}$/;

function safeValue(value: string | undefined, pattern: RegExp): string | undefined {
  const trimmed = value?.trim();
  return trimmed && pattern.test(trimmed) ? trimmed : undefined;
}

export type BuildMetadata = {
  release: string;
  version: string;
  commit?: string;
  builtAt?: string;
};

export function getBuildMetadata(): BuildMetadata {
  const version = safeValue(process.env.APP_VERSION, safeReleasePattern) ?? '0.1.0';
  const commit = safeValue(process.env.BUILD_COMMIT, commitPattern);
  const configuredRelease = safeValue(process.env.APP_RELEASE, safeReleasePattern);
  const builtAt = (() => {
    const value = process.env.BUILD_TIMESTAMP?.trim();
    return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
  })();

  return {
    release: configuredRelease ?? (commit ? `${version}-${commit.slice(0, 12)}` : version),
    version,
    ...(commit ? { commit } : {}),
    ...(builtAt ? { builtAt } : {}),
  };
}

export function getReleaseIdentifier(): string {
  return getBuildMetadata().release;
}
