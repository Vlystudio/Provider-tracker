import 'server-only';

import { z } from 'zod';
import { csvCell, safeFilterKeys } from '@/lib/governance';
import { assertPermission, type Principal } from './authorization';
import { recordAuditEvent } from './audit';
import { getServerConfig } from './config';
import { providerSearchInputSchema, searchProviders, type ProviderSearchResult } from './provider-search-service';

export const providerDirectoryExportInputSchema = z.record(z.string(), z.unknown());

const exportColumns: Array<{ header: string; value: (row: ProviderSearchResult) => unknown }> = [
  { header: 'Facility', value: (row) => row.facilityName },
  { header: 'City', value: (row) => row.city },
  { header: 'State', value: (row) => row.stateCode },
  { header: 'ZIP', value: (row) => row.postalCode },
  { header: 'Distance miles', value: (row) => row.distanceMiles.toFixed(1) },
  { header: 'Phone', value: (row) => row.phone },
  { header: 'Specialties', value: (row) => row.specialties },
  { header: 'Accepting', value: (row) => row.acceptingStatus },
  { header: 'Scheduling', value: (row) => row.schedulingStatus },
  { header: 'Urgent referral', value: (row) => row.urgentReferralStatus },
  { header: 'Next available date', value: (row) => row.nextAvailableDate },
  { header: 'Estimated wait days', value: (row) => row.estimatedWaitDays },
  { header: 'Last verified', value: (row) => row.lastVerifiedAt },
  { header: 'Freshness', value: (row) => row.freshness },
];

export async function exportProviderDirectory(
  principal: Principal,
  rawInput: unknown,
  request: Request,
) {
  assertPermission(principal, 'operations:export');
  const inputRecord = providerDirectoryExportInputSchema.parse(rawInput);
  const parsed = providerSearchInputSchema.parse({ ...inputRecord, page: 1, pageSize: 100 });
  const maximum = getServerConfig().EXPORT_MAX_ROWS;
  const first = await searchProviders(principal, parsed, { audit: false });
  const rows = [...first.rows];
  const wanted = Math.min(first.total, maximum);
  for (let page = 2; rows.length < wanted; page += 1) {
    const next = await searchProviders(principal, { ...parsed, page, pageSize: 100 }, { audit: false });
    rows.push(...next.rows.slice(0, wanted - rows.length));
    if (next.rows.length === 0) break;
  }
  const lines = [exportColumns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(exportColumns.map((column) => csvCell(column.value(row))).join(','));
  }
  await recordAuditEvent({
    actorId: principal.id,
    action: 'export.provider-directory',
    result: 'success',
    entityType: 'provider_directory',
    request,
    metadata: {
      recordCount: rows.length,
      totalMatches: first.total,
      truncated: first.total > rows.length,
      filterKeys: safeFilterKeys(inputRecord).join(','),
    },
  });
  return {
    csv: `\uFEFF${lines.join('\r\n')}\r\n`,
    recordCount: rows.length,
    totalMatches: first.total,
    truncated: first.total > rows.length,
  };
}
