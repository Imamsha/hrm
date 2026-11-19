/**
 * Time-zone conversions with the platform's IANA database (`Intl`), no extra dependency.
 * Attendance uses them to turn a branch's local shift times into instants and to find the
 * local calendar day of a punch.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return parts;
}

/** Offset of the zone from UTC at an instant, in minutes (e.g. +330 for Asia/Kolkata). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** Local calendar date (`YYYY-MM-DD`) of an instant in a time zone. */
export function zonedDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes since local midnight of an instant in a time zone. */
export function zonedMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * The instant at which the local clock in `timeZone` shows `date` + `minutes` after midnight.
 * Minutes may exceed 1440 (next day) for shifts crossing midnight. During a DST gap the
 * result is shifted forward, during an overlap the earlier instant is used.
 */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Two passes converge for every real-world zone (offset depends on the instant itself).
  let offset = zoneOffsetMinutes(new Date(naive), timeZone);
  let instant = naive - offset * 60_000;
  const second = zoneOffsetMinutes(new Date(instant), timeZone);
  if (second !== offset) {
    offset = second;
    instant = naive - offset * 60_000;
  }
  return new Date(instant);
}

/** True when `timeZone` is a valid IANA zone for this runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
