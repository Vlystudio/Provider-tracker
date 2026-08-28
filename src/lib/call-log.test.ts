import { describe, expect, it } from 'vitest';
import { groupCallsByAuthorization } from './call-log';

describe('call log grouping', () => {
  it('puts calls with the same authorization into one group', () => {
    const groups = groupCallsByAuthorization([
      { id: 'call-1', number: 'AUTH-42' },
      { id: 'call-2', number: 'AUTH-42' },
      { id: 'call-3', number: 'AUTH-99' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      authorizationNumber: 'AUTH-42',
      calls: [
        { id: 'call-1', number: 'AUTH-42' },
        { id: 'call-2', number: 'AUTH-42' },
      ],
    });
    expect(groups[1]?.calls).toHaveLength(1);
  });

  it('keeps authorization groups in the order they first appear', () => {
    const groups = groupCallsByAuthorization([
      { id: 'newest', number: 'AUTH-NEW' },
      { id: 'older', number: 'AUTH-OLD' },
      { id: 'oldest', number: 'AUTH-NEW' },
    ]);

    expect(groups.map((group) => group.authorizationNumber)).toEqual(['AUTH-NEW', 'AUTH-OLD']);
    expect(groups[0]?.calls.map((call) => call.id)).toEqual(['newest', 'oldest']);
  });

  it('groups calls without an authorization under one clear label', () => {
    const groups = groupCallsByAuthorization([
      { id: 'call-1', number: '' },
      { id: 'call-2', number: 'Not recorded' },
    ]);

    expect(groups).toEqual([{
      authorizationNumber: 'Not recorded',
      calls: [
        { id: 'call-1', number: '' },
        { id: 'call-2', number: 'Not recorded' },
      ],
    }]);
  });
});
