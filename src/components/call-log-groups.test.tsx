// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CallLogGroup } from '@/lib/call-log';
import type { CallLogRow } from '@/server/call-service';
import { CallLogGroups } from './call-log-groups';

const calls: CallLogRow[] = [
  {
    id: 'call-1',
    trackingGroupKey: 'tracking:42',
    trackingId: 'PT-42',
    provider: 'Alpha Clinic',
    outcome: 'Accepting',
    status: 'Complete',
    date: '2026-08-28',
    calledAt: '2026-08-28T14:00:00.000Z',
    caller: 'Benyamin',
  },
  {
    id: 'call-2',
    trackingGroupKey: 'tracking:42',
    trackingId: 'PT-42',
    provider: 'Beta Center',
    outcome: 'No answer',
    status: 'Follow-up',
    date: '2026-08-28',
    calledAt: '2026-08-28T13:00:00.000Z',
    caller: 'Benyamin',
  },
];

describe('call log groups', () => {
  it('shows one collapsed Tracking ID row with its call count and call details', () => {
    const groups: CallLogGroup<CallLogRow>[] = [{ trackingId: 'PT-42', calls }];
    const { container } = render(<CallLogGroups groups={groups} />);

    expect(screen.getByText('PT-42')).toBeInTheDocument();
    expect(screen.getByText('2 calls recorded')).toBeInTheDocument();
    expect(screen.getByText('Alpha Clinic')).toBeInTheDocument();
    expect(screen.getByText('Beta Center')).toBeInTheDocument();
    expect(container.querySelectorAll('details')).toHaveLength(1);
    expect(container.querySelector('details')).not.toHaveAttribute('open');
  });

  it('uses a plain label when the Tracking ID was not recorded', () => {
    const groups: CallLogGroup<CallLogRow>[] = [{
      trackingId: 'Not recorded',
      calls: [{ ...calls[0], id: 'missing-tracking-id', trackingId: 'Not recorded' }],
    }];

    render(<CallLogGroups groups={groups} />);

    expect(screen.getByText('No Tracking ID recorded')).toBeInTheDocument();
    expect(screen.getByText('1 call recorded')).toBeInTheDocument();
  });
});
