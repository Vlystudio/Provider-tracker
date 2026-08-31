import { formatDateTime } from '@/lib/format';
import type { CallLogGroup } from '@/lib/call-log';
import type { CallLogRow } from '@/server/call-service';
import { StatusBadge, type StatusTone } from './ui';

function statusTone(status: string): StatusTone {
  const value = status.toLowerCase();
  if (value.includes('closed') || value.includes('complete')) return 'positive';
  if (value.includes('retry') || value.includes('review') || value.includes('follow-up')) return 'warning';
  return 'neutral';
}

function callCountLabel(count: number) {
  return `${count} ${count === 1 ? 'call' : 'calls'} completed`;
}

export function CallLogGroups({ groups }: { groups: CallLogGroup<CallLogRow>[] }) {
  return (
    <div className="divide-y divide-slate-300">
      {groups.map((group) => {
        const latestCall = group.calls.reduce<CallLogRow | undefined>((latest, call) => (
          !latest || call.calledAt > latest.calledAt ? call : latest
        ), undefined);

        return (
          <details className="group" key={group.trackingId}>
            <summary className="cursor-pointer px-4 py-4 text-sm hover:bg-slate-50">
              <span className="ml-2 inline-flex flex-wrap items-center gap-3">
                <span className="font-semibold text-slate-950">
                  {group.trackingId === 'Not recorded' ? 'No Tracking ID recorded' : group.trackingId}
                </span>
                <span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                  {callCountLabel(group.calls.length)}
                </span>
              </span>
              {latestCall ? (
                <span className="float-right ml-4 text-xs text-slate-500">
                  Latest: {formatDateTime(latestCall.calledAt)}
                </span>
              ) : null}
            </summary>
            <div className="table-scroll border-t border-slate-300 bg-slate-50">
              <table className="data-table min-w-[46rem]">
                <thead>
                  <tr>
                    <th scope="col">Provider</th>
                    <th scope="col">Outcome</th>
                    <th scope="col">Status</th>
                    <th scope="col">Entered by</th>
                    <th scope="col">Call date</th>
                  </tr>
                </thead>
                <tbody>
                  {group.calls.map((call) => (
                    <tr key={call.id}>
                      <td className="font-semibold text-slate-950">{call.provider}</td>
                      <td>{call.outcome}</td>
                      <td><StatusBadge tone={statusTone(call.status)}>{call.status}</StatusBadge></td>
                      <td>{call.caller}</td>
                      <td className="whitespace-nowrap">{formatDateTime(call.calledAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </div>
  );
}
