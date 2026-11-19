import type { AttendanceDayItem, AttendanceRangeItem } from '@hrm/shared-types';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@hrm/ui-web';
import { clock, hm, STATUS_STYLE } from './time-api';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function weekdayIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Month grid of evaluated attendance days with totals; clicking a day selects it. */
export function AttendanceCalendar({
  range,
  selected,
  onSelect,
}: {
  range: AttendanceRangeItem;
  selected?: string | null;
  onSelect?: (day: AttendanceDayItem) => void;
}) {
  const first = range.from;
  const lead = weekdayIndex(first);
  const byDate = new Map(range.days.map((d) => [d.date, d]));
  const [y, m] = first.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = range.totals;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </CardTitle>
        <span className="text-sm text-muted-foreground">
          {t.present} present · {t.halfDay} half · {t.absent} absent · {t.onLeave} leave ·{' '}
          {hm(t.workedMinutes)} worked
          {t.lateDays ? ` · ${String(t.lateDays)} late` : ''}
          {t.overtimeMinutes ? ` · ${hm(t.overtimeMinutes)} overtime` : ''}
        </span>
      </CardHeader>
      <CardContent>
        <div role="grid" aria-label="Attendance calendar" className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              role="columnheader"
              className="pb-1 text-center text-sm font-medium text-muted-foreground"
            >
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`pad-${String(i)}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const date = `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
            const d = byDate.get(date);
            const style = d ? STATUS_STYLE[d.status] : null;
            const label = d
              ? `${date}: ${d.holidayName ?? (d.leave ? d.leave.type : (style?.label ?? ''))}`
              : `${date}: not employed`;
            return (
              <button
                type="button"
                key={date}
                role="gridcell"
                aria-label={label}
                aria-selected={selected === date}
                disabled={!d}
                onClick={() => {
                  if (d) onSelect?.(d);
                }}
                className={cn(
                  'flex min-h-16 flex-col items-start rounded-md border border-border p-1.5 text-left text-sm',
                  style?.cls,
                  selected === date && 'ring-2 ring-ring',
                  !d && 'opacity-40',
                )}
              >
                <span className="font-medium tabular-nums">{i + 1}</span>
                {d ? (
                  <span className="truncate text-xs">
                    {d.leave ? d.leave.type : (d.holidayName ?? style?.label)}
                    {d.workedMinutes ? ` · ${hm(d.workedMinutes)}` : ''}
                  </span>
                ) : null}
                <span className="mt-auto flex gap-1">
                  {d?.lateMinutes ? (
                    <span className="size-1.5 rounded-full bg-warning" title="Late" />
                  ) : null}
                  {d?.missingPunch ? (
                    <span className="size-1.5 rounded-full bg-destructive" title="Missing punch" />
                  ) : null}
                  {d?.pendingRegularization ? (
                    <span
                      className="size-1.5 rounded-full bg-info"
                      title="Regularization pending"
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {Object.entries(STATUS_STYLE).map(([k, s]) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', s.dot)} />
              {s.label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Details of one evaluated day. */
export function DayDetails({ day, timeZone }: { day: AttendanceDayItem; timeZone: string }) {
  const s = STATUS_STYLE[day.status];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="flex flex-wrap items-center gap-1">
          {s.label}
          {day.regularized ? <Badge variant="info">Regularized</Badge> : null}
          {day.missingPunch ? <Badge variant="destructive">Missing punch</Badge> : null}
          {day.pendingRegularization ? <Badge variant="warning">Request pending</Badge> : null}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Shift</dt>
        <dd>
          {day.shift
            ? `${day.shift.name} (${clock(day.scheduledStart, timeZone)}–${clock(day.scheduledEnd, timeZone)})`
            : '—'}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">In · out</dt>
        <dd>
          {clock(day.firstIn, timeZone)} · {clock(day.lastOut, timeZone)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Worked</dt>
        <dd>{hm(day.workedMinutes)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Late · early exit</dt>
        <dd>
          {hm(day.lateMinutes)} · {hm(day.earlyExitMinutes)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Overtime</dt>
        <dd>{hm(day.overtimeMinutes)}</dd>
      </div>
      {day.leave ? (
        <div className="col-span-2">
          <dt className="text-muted-foreground">Leave</dt>
          <dd>
            {day.leave.type} (
            {day.leave.session === 'FULL'
              ? 'full day'
              : day.leave.session === 'FIRST_HALF'
                ? 'first half'
                : 'second half'}
            )
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
