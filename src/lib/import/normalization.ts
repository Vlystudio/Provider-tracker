import { createHash } from 'node:crypto';
import { getResultCode, getResultPhrase } from '../domain';
import type {
  AvailabilityStatus,
  ScalarCell,
  ScheduleStatus,
  TreatmentStatus,
} from './types';

const EASTERN_TIME_ZONE = 'America/New_York';

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFKC')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/\u00c2/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeHeader(value: unknown): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function normalizeKeyPart(value: unknown): string {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function normalizeSpecialty(value: unknown): string {
  return normalizeKeyPart(value);
}

export function scalarToText(value: ScalarCell | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return cleanText(value);
}

export function nullableText(value: ScalarCell | undefined): string | null {
  const text = scalarToText(value);
  return text ? text : null;
}

export function stableHash(...parts: unknown[]): string {
  const payload = parts.map((part) => cleanText(part)).join('\u001f');
  return createHash('sha256').update(payload).digest('hex');
}

export function splitFacilityKey(value: unknown): { facilityName: string; city: string } {
  const displayKey = cleanText(value);
  const separator = displayKey.lastIndexOf('|');
  if (separator < 0) return { facilityName: displayKey, city: '' };
  return {
    facilityName: cleanText(displayKey.slice(0, separator)),
    city: cleanText(displayKey.slice(separator + 1)),
  };
}

export function makeFacilityIdentity(facilityName: unknown, city: unknown) {
  const name = cleanText(facilityName);
  const location = cleanText(city);
  const normalizedName = normalizeKeyPart(name);
  const normalizedCity = normalizeKeyPart(location);
  return {
    facilityName: name,
    city: location,
    normalizedName,
    normalizedCity,
    normalizedKey: `${normalizedName}|${normalizedCity}`,
    displayKey: location ? `${name} | ${location}` : name,
  };
}

export function normalizePhone(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const extensionMatch = text.match(/(?:ext\.?|x)\s*(\d+)$/i);
  let digits = text.replace(/\D/g, '');
  if (extensionMatch) digits = digits.slice(0, -extensionMatch[1].length);
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return digits || null;
  return extensionMatch ? `${digits}x${extensionMatch[1]}` : digits;
}

export function normalizePostalCode(value: unknown): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length <= 5) return digits.padStart(5, '0');
  return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
}

export function toFiniteNumber(value: ScalarCell | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(cleanText(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedStatus(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/unkown/g, 'unknown')
    .replace(/w\s*\/\s*in/g, 'within')
    .replace(/w\s*\/\s*out/g, 'without');
}

export function toAvailabilityStatus(value: unknown): AvailabilityStatus {
  const status = normalizedStatus(value);
  if (!status || status === 'unknown') return 'unknown';
  if (status === 'n/a' || status === 'na' || status === 'not applicable') return 'not_applicable';
  if (status === 'yes' || status.startsWith('yes ')) return 'yes';
  if (status === 'no' || status.startsWith('no ')) return 'no';
  return 'unknown';
}

export function toTreatmentStatus(value: unknown): TreatmentStatus {
  const status = normalizedStatus(value);
  if (status.includes('unable to tell') && status.includes('triage')) return 'unable_to_tell_without_triage';
  return toAvailabilityStatus(value);
}

export function toScheduleStatus(value: unknown): ScheduleStatus {
  const status = normalizedStatus(value);
  if (status.includes('urgent') && status.includes('referral')) return 'urgent_referral_required';
  if (status.includes('unable to tell') && status.includes('triage')) return 'unable_to_tell_without_triage';
  return toAvailabilityStatus(value);
}

export function toBoolean(value: unknown): boolean {
  const status = normalizedStatus(value);
  return status === 'yes' || status === 'true' || status === '1' || status === 'y';
}

export function isDidNotLeaveVm(value: unknown): boolean {
  const status = normalizedStatus(value);
  return status === 'yes' || status.includes('did not leave vm') || status.includes('did not leave voicemail');
}

function formatParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function wallTimeToDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let instant = desired;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const observed = formatParts(new Date(instant), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      millisecond,
    );
    const correction = desired - observedAsUtc;
    instant += correction;
    if (correction === 0) break;
  }
  return new Date(instant);
}

export function excelSerialToDate(
  serial: number,
  dateSystem: '1900' | '1904',
  timeZone = EASTERN_TIME_ZONE,
): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epoch = dateSystem === '1904' ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const wallClock = new Date(epoch + Math.round(serial * 86_400_000));
  return wallTimeToDate(
    wallClock.getUTCFullYear(),
    wallClock.getUTCMonth() + 1,
    wallClock.getUTCDate(),
    wallClock.getUTCHours(),
    wallClock.getUTCMinutes(),
    wallClock.getUTCSeconds(),
    wallClock.getUTCMilliseconds(),
    timeZone,
  );
}

export function parseWorkbookDate(
  value: ScalarCell | undefined,
  dateSystem: '1900' | '1904',
  timeZone = EASTERN_TIME_ZONE,
): Date | null {
  if (typeof value === 'number') return excelSerialToDate(value, dateSystem, timeZone);
  const text = cleanText(value);
  if (!text) return null;

  const compact = text.replace(/\D/g, '');
  if (/^\d{8}$/.test(compact)) {
    return wallTimeToDate(
      Number(compact.slice(4, 8)),
      Number(compact.slice(0, 2)),
      Number(compact.slice(2, 4)),
      12,
      0,
      0,
      0,
      timeZone,
    );
  }

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const instant = new Date(text);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }

  const match = text.match(
    /^(\d{1,4})[-\/]([0-9]{1,2})[-\/]([0-9]{1,4})(?:[ T]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (!match) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  const year = match[1].length === 4 ? first : third < 100 ? 2000 + third : third;
  const month = match[1].length === 4 ? second : first;
  const day = match[1].length === 4 ? third : second;
  let hour = Number(match[4] ?? 12);
  const meridiem = match[7]?.toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return wallTimeToDate(year, month, day, hour, Number(match[5] ?? 0), Number(match[6] ?? 0), 0, timeZone);
}

export function weekStartForDate(date: Date, timeZone = EASTERN_TIME_ZONE): string {
  const parts = formatParts(date, timeZone);
  const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daysSinceMonday = (calendarDate.getUTCDay() + 6) % 7;
  calendarDate.setUTCDate(calendarDate.getUTCDate() - daysSinceMonday);
  return calendarDate.toISOString().slice(0, 10);
}

export function dateOnlyInZone(date: Date, timeZone = EASTERN_TIME_ZONE): string {
  const parts = formatParts(date, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function deriveResult(input: {
  didNotLeaveVm: boolean;
  accepting: AvailabilityStatus;
  canTreat: TreatmentStatus;
  schedule: ScheduleStatus;
}) {
  const ruleInput = {
    didNotLeaveVm: input.didNotLeaveVm,
    accepting: input.accepting,
    canTreat: input.canTreat,
    schedule: input.schedule,
  };
  return {
    resultCode: getResultCode(ruleInput),
    resultPhrase: getResultPhrase(ruleInput),
  };
}
