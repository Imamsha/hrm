import type { DayTypeValue, WorkWeekRuleItem } from '@hrm/shared-types';

export const SHORT_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th'];

/** Readable one-line summary, e.g. "Mon–Fri full · Sat half · 2nd, 4th Sat off". */
export function summarizeWorkWeek(rules: WorkWeekRuleItem[]): string {
  const base = (d: number) =>
    rules.find((r) => r.weekday === d && r.occurrence === 0)?.dayType ?? 'OFF';
  const groups: { type: DayTypeValue; from: number; to: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    const type = base(d);
    const last = groups.at(-1);
    if (last && last.type === type && last.to === d - 1) last.to = d;
    else groups.push({ type, from: d, to: d });
  }
  const label = { FULL: 'full', HALF: 'half', OFF: 'off' } as const;
  const parts = groups
    .filter((g) => g.type !== 'OFF')
    .map((g) => {
      const days =
        g.from === g.to
          ? SHORT_WEEKDAYS[g.from - 1]
          : `${SHORT_WEEKDAYS[g.from - 1] ?? ''}–${SHORT_WEEKDAYS[g.to - 1] ?? ''}`;
      return `${days ?? ''} ${label[g.type]}`;
    });
  const exceptions = new Map<string, number[]>();
  for (const r of rules.filter((x) => x.occurrence > 0)) {
    const key = `${String(r.weekday)}:${r.dayType}`;
    exceptions.set(key, [...(exceptions.get(key) ?? []), r.occurrence]);
  }
  for (const [key, occ] of exceptions) {
    const [weekday, type] = key.split(':') as [string, DayTypeValue];
    parts.push(
      `${occ
        .sort()
        .map((o) => ORDINALS[o])
        .join(', ')} ${SHORT_WEEKDAYS[Number(weekday) - 1] ?? ''} ${label[type]}`,
    );
  }
  return parts.join(' · ') || 'No working days';
}
