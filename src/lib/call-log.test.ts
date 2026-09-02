import { describe, expect, it } from 'vitest';
import { groupCallsByTrackingId } from './call-log';

describe('call log grouping', () => {
  it('puts calls with the same Tracking ID into one group', () => {
    const groups = groupCallsByTrackingId([
      { id: 'call-1', trackingId: 'PT-42' },
      { id: 'call-2', trackingId: 'PT-42' },
      { id: 'call-3', trackingId: 'PT-99' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({
      trackingId: 'PT-42',
      calls: [
        { id: 'call-1', trackingId: 'PT-42' },
        { id: 'call-2', trackingId: 'PT-42' },
      ],
    });
    expect(groups[1]?.calls).toHaveLength(1);
  });

  it('keeps tracking groups in the order they first appear', () => {
    const groups = groupCallsByTrackingId([
      { id: 'newest', trackingId: 'PT-NEW' },
      { id: 'older', trackingId: 'PT-OLD' },
      { id: 'oldest', trackingId: 'PT-NEW' },
    ]);

    expect(groups.map((group) => group.trackingId)).toEqual(['PT-NEW', 'PT-OLD']);
    expect(groups[0]?.calls.map((call) => call.id)).toEqual(['newest', 'oldest']);
  });

  it('groups calls without a Tracking ID under one clear label', () => {
    const groups = groupCallsByTrackingId([
      { id: 'call-1', trackingId: '' },
      { id: 'call-2', trackingId: 'Not recorded' },
    ]);

    expect(groups).toEqual([{
      trackingId: 'Not recorded',
      calls: [
        { id: 'call-1', trackingId: '' },
        { id: 'call-2', trackingId: 'Not recorded' },
      ],
    }]);
  });

  it('keeps unrelated legacy calls without Tracking IDs in separate groups when a stable group key is supplied', () => {
    const groups = groupCallsByTrackingId([
      { id: 'call-1', trackingId: 'Not recorded', trackingGroupKey: 'call:call-1' },
      { id: 'call-2', trackingId: 'Not recorded', trackingGroupKey: 'call:call-2' },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.calls[0]?.id)).toEqual(['call-1', 'call-2']);
  });
});
