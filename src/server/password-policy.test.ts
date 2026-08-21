import { describe, expect, it } from 'vitest';
import { commonPasswordCorpus, isCommonPassword } from './password-policy';

describe('password policy', () => {
  it('uses the reviewed 3,000-entry corpus', () => {
    expect(commonPasswordCorpus.entries).toBe(3_000);
    expect(commonPasswordCorpus.sourceCommit).toHaveLength(40);
    expect(commonPasswordCorpus.sourceListSelectionSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks common long passwords without changing the submitted password', () => {
    expect(isCommonPassword('123456789987654321')).toBe(true);
    expect(isCommonPassword('MAILCREATED5240')).toBe(true);
    expect(isCommonPassword('correctly-random-unique-password-47f0d8')).toBe(false);
  });
});
