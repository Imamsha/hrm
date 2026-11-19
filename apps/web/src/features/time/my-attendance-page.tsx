import type { AttendanceDayItem, RegularizationItem } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { regularizationSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, LogIn, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { api, errorMessage } from '@/lib/api';
import { AttendanceCalendar, DayDetails } from './attendance-calendar';
import {
  clock,
  currentMonth,
  hm,
  localToIso,
  monthRange,
  REQUEST_VARIANT,
  STATUS_STYLE,
  TIME,
  useAttendanceRange,
  useMyRegularizations,
  useToday,
} from './time-api';

/** Browser location for policies that require it (resolves to null when unavailable/denied). */
function currentPosition(): Promise<{ latitude: string; longitude: string } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator))
    return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        resolve({
          latitude: p.coords.latitude.toFixed(6),
          longitude: p.coords.longitude.toFixed(6),
        });
      },
      () => {
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });
}

export function ClockCard() {
  const queryClient = useQueryClient();
  const today = useToday();
  const [error, setError] = useState<string | null>(null);
  const punch = useMutation({
    mutationFn: async () => {
      const position = today.data?.allowed.geolocationRequired ? await currentPosition() : null;
      return api.post('/me/attendance/punches', { source: 'WEB', ...(position ?? {}) });
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: TIME });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (today.isPending) return <Skeleton className="h-36" />;
  if (today.isError)
    return <ErrorState title="Could not load today" description={errorMessage(today.error)} />;
  const t = today.data;
  const s = STATUS_STYLE[t.day.status];
  const clockIn = t.nextDirection === 'IN';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
        <Badge variant="outline">{s.label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <div className="flex flex-wrap items-center gap-4">
          <Button
            size="lg"
            onClick={() => {
              punch.mutate();
            }}
            disabled={punch.isPending || !t.allowed.web}
            aria-busy={punch.isPending}
          >
            {clockIn ? <LogIn /> : <LogOut />} {clockIn ? 'Clock in' : 'Clock out'}
          </Button>
          <div className="text-sm">
            <p>
              {t.day.shift
                ? `${t.day.shift.name}: ${clock(t.day.scheduledStart, t.timeZone)}–${clock(t.day.scheduledEnd, t.timeZone)}`
                : 'No shift scheduled'}
            </p>
            <p className="text-muted-foreground">
              In {clock(t.day.firstIn, t.timeZone)} · out {clock(t.day.lastOut, t.timeZone)} ·
              worked {hm(t.day.workedMinutes)}
              {t.day.lateMinutes ? ` · ${hm(t.day.lateMinutes)} late` : ''}
            </p>
          </div>
        </div>
        {!t.allowed.web ? (
          <p className="text-sm text-muted-foreground">
            Web clock-in is disabled; scan the QR code at your office kiosk.
          </p>
        ) : null}
        {t.allowed.geolocationRequired ? (
          <p className="text-sm text-muted-foreground">
            Your location is recorded with each punch.
          </p>
        ) : null}
        {t.punches.length ? (
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Today's punches">
            {t.punches.map((p) => (
              <li key={p.id}>
                <Badge variant={p.direction === 'IN' ? 'success' : 'neutral'}>
                  {p.direction} {clock(p.punchedAt, t.timeZone)} · {p.source.toLowerCase()}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RegularizeForm({ day, onDone }: { day: AttendanceDayItem; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [inAt, setIn] = useState(`${day.date}T09:30`);
  const [outAt, setOut] = useState(`${day.date}T18:30`);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.post('/me/attendance/regularizations', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TIME });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="In" required>
            <Input
              type="datetime-local"
              value={inAt}
              onChange={(e) => {
                setIn(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Out" required>
            <Input
              type="datetime-local"
              value={outAt}
              onChange={(e) => {
                setOut(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Reason" required className="sm:col-span-2">
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </FormField>
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const body = {
              date: day.date,
              requestedIn: localToIso(inAt),
              requestedOut: localToIso(outAt),
              reason,
            };
            const parsed = regularizationSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join('. '));
              return;
            }
            save.mutate(body);
          }}
        >
          Send request
        </Button>
      </DialogFooter>
    </>
  );
}

function MyRegularizations() {
  const queryClient = useQueryClient();
  const list = useMyRegularizations();
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/me/attendance/regularizations/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TIME }),
  });
  if (!list.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>My regularization requests</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border" aria-label="My regularization requests">
          {list.data.map((r: RegularizationItem) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-28 font-medium tabular-nums">{r.date}</span>
              <span className="text-muted-foreground">
                {clock(r.requestedIn)}–{clock(r.requestedOut)}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.reason}</span>
              <Badge variant={REQUEST_VARIANT[r.status]}>{r.status.toLowerCase()}</Badge>
              {r.status === 'PENDING' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    cancel.mutate(r.id);
                  }}
                >
                  Cancel
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Month view with day details; used for self-service and (read-only) for HR. */
export function AttendanceMonth({ base, self }: { base: string; self: boolean }) {
  const [month, setMonth] = useState(currentMonth);
  const { from, to } = monthRange(month);
  const range = useAttendanceRange(base, from, to);
  const [selected, setSelected] = useState<AttendanceDayItem | null>(null);
  const [regularizing, setRegularizing] = useState<AttendanceDayItem | null>(null);
  const day = selected
    ? (range.data?.days.find((d) => d.date === selected.date) ?? selected)
    : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous month"
          onClick={() => {
            setMonth((m) => shiftMonth(m, -1));
          }}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next month"
          onClick={() => {
            setMonth((m) => shiftMonth(m, 1));
          }}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setMonth(currentMonth());
          }}
        >
          This month
        </Button>
      </div>
      {range.isPending ? (
        <Skeleton className="h-80" />
      ) : range.isError ? (
        <ErrorState title="Could not load attendance" description={errorMessage(range.error)} />
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_22rem]">
          <AttendanceCalendar
            range={range.data}
            selected={day?.date ?? null}
            onSelect={setSelected}
          />
          <Card>
            <CardHeader>
              <CardTitle>{day ? day.date : 'Select a day'}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {day ? (
                <>
                  <DayDetails day={day} timeZone={range.data.timeZone} />
                  {self &&
                  !day.pendingRegularization &&
                  day.date <= new Date().toISOString().slice(0, 10) &&
                  (day.status === 'ABSENT' ||
                    day.status === 'HALF_DAY' ||
                    day.missingPunch ||
                    day.lateMinutes > 0) ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRegularizing(day);
                      }}
                    >
                      Request regularization
                    </Button>
                  ) : null}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Days show their status, worked time and flags.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <Dialog
        open={regularizing !== null}
        onOpenChange={(o) => {
          if (!o) setRegularizing(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Request regularization" description={regularizing?.date} />
          {regularizing ? (
            <RegularizeForm
              day={regularizing}
              onDone={() => {
                setRegularizing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MyAttendancePage() {
  return (
    <Page>
      <PageHeader
        title="My attendance"
        description="Clock in and out, review your days and correct missed punches."
      />
      <div className="flex flex-col gap-4">
        <ClockCard />
        <AttendanceMonth base="/me/attendance" self />
        <MyRegularizations />
      </div>
    </Page>
  );
}
