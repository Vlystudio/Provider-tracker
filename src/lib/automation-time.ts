type DateParts = { year: number; month: number; day: number };
type DateTimeParts = DateParts & { hour: number; minute: number; second: number };

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

export function getZonedParts(value: Date, timeZone: string): DateTimeParts {
  const parts = Object.fromEntries(
    formatter(timeZone).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatLocalDate(value: Date, timeZone: string): string {
  const parts = getZonedParts(value, timeZone);
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addLocalDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function zonedDateTimeToUtc(dateKey: string, hour: number, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) throw new Error('Automation time zone is invalid.');
  const [year, month, day] = dateKey.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, 0, 0);
  let candidate = new Date(desired);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(candidate, timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = desired - represented;
    if (correction === 0) return candidate;
    candidate = new Date(candidate.getTime() + correction);
  }
  const final = getZonedParts(candidate, timeZone);
  if (final.year !== year || final.month !== month || final.day !== day || final.hour !== hour) {
    throw new Error('The requested local scheduling time does not exist.');
  }
  return candidate;
}

export function dailyDigestPeriod(runDateKey: string, timeZone: string): { start: Date; end: Date } {
  const end = zonedDateTimeToUtc(runDateKey, 0, timeZone);
  const start = zonedDateTimeToUtc(addLocalDays(runDateKey, -1), 0, timeZone);
  return { start, end };
}

export function weeklyDigestPeriod(runDateKey: string, timeZone: string): { start: Date; end: Date } {
  const end = zonedDateTimeToUtc(runDateKey, 0, timeZone);
  const start = zonedDateTimeToUtc(addLocalDays(runDateKey, -7), 0, timeZone);
  return { start, end };
}

export function dueDailyRuns(input: {
  now: Date;
  timeZone: string;
  hour: number;
  lastSuccessfulDate?: string | null;
  maximumCatchUpDays?: number;
}): Array<{ dateKey: string; scheduledFor: Date; executionKey: string }> {
  const today = formatLocalDate(input.now, input.timeZone);
  const todayRun = zonedDateTimeToUtc(today, input.hour, input.timeZone);
  const mostRecent = todayRun <= input.now ? today : addLocalDays(today, -1);
  const maximum = input.maximumCatchUpDays ?? 3;
  const runs = [];
  for (let offset = maximum - 1; offset >= 0; offset -= 1) {
    const dateKey = addLocalDays(mostRecent, -offset);
    if (input.lastSuccessfulDate && dateKey <= input.lastSuccessfulDate) continue;
    runs.push({
      dateKey,
      scheduledFor: zonedDateTimeToUtc(dateKey, input.hour, input.timeZone),
      executionKey: `daily:${dateKey}`,
    });
  }
  return runs;
}

export function isoWeekday(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}

export function dueWeeklyRuns(input: {
  now: Date;
  timeZone: string;
  hour: number;
  weekday: number;
  lastSuccessfulDate?: string | null;
}): Array<{ dateKey: string; scheduledFor: Date; executionKey: string }> {
  const today = formatLocalDate(input.now, input.timeZone);
  let dateKey = addLocalDays(today, -(isoWeekday(today) - input.weekday + 7) % 7);
  if (zonedDateTimeToUtc(dateKey, input.hour, input.timeZone) > input.now) dateKey = addLocalDays(dateKey, -7);
  if (input.lastSuccessfulDate && dateKey <= input.lastSuccessfulDate) return [];
  return [{ dateKey, scheduledFor: zonedDateTimeToUtc(dateKey, input.hour, input.timeZone), executionKey: `weekly:${dateKey}` }];
}
