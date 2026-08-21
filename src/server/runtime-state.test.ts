import { afterEach, describe, expect, it } from 'vitest';
import { getRuntimeState, resetRuntimeStateForTest, shutdownRuntime } from './runtime-state';

describe('runtime shutdown', () => {
  afterEach(() => resetRuntimeStateForTest());

  it('marks the process unready before closing resources', async () => {
    resetRuntimeStateForTest();
    await shutdownRuntime('TEST');
    expect(getRuntimeState()).toEqual({ initialized: false, shuttingDown: true });
  });
});
