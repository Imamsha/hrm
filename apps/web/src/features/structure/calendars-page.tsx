import {
  type DayTypeValue,
  type HolidayCalendarItem,
  type HolidayItem,
  type HolidayKindValue,
  PERMISSIONS,
  type ResolvedCalendar,
  type ResolvedDayKindValue,
  type WorkWeekItem,
  type WorkWeekRuleItem,
} from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import {
  bulkHolidaysSchema,
  createHolidayCalendarSchema,
  createWorkWeekSchema,
  updateHolidayCalendarSchema,
  updateWorkWeekSchema,
} from '@hrm/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { ConfirmDialog } from '@/features/members/member-dialogs';
import { api, errorMessage } from '@/lib/api';
import { useRefOptions } from './api';
import { ORDINALS, SHORT_WEEKDAYS, summarizeWorkWeek } from './work-week-summary';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_TYPE_OPTIONS = [
  { value: 'FULL', label: 'Full day' },
  { value: 'HALF', label: 'Half day' },
  { value: 'OFF', label: 'Weekly off' },
];
const KIND_OPTIONS = [
  { value: 'PUBLIC', label: 'Public holiday' },
  { value: 'OPTIONAL', label: 'Optional (restricted)' },
];

const workWeeksKey = ['structure', '/work-weeks', 'list'];
const calendarsKey = ['structure', '/holiday-calendars', 'list'];

function useWorkWeeks() {
  return useQuery({
    queryKey: workWeeksKey,
    queryFn: () => api.get<WorkWeekItem[]>('/work-weeks'),
  });
}
function useHolidayCalendars() {
  return useQuery({
    queryKey: calendarsKey,
    queryFn: () => api.get<HolidayCalendarItem[]>('/holiday-calendars'),
  });
}

// ------------------------------------------------------------------------- work weeks

interface WeekDraft {
  name: string;
  description: string;
  isDefault: boolean;
  base: DayTypeValue[];
  exceptions: WorkWeekRuleItem[];
}

function draftFrom(week: WorkWeekItem | null): WeekDraft {
  if (!week) {
    return {
      name: '',
      description: '',
      isDefault: false,
      base: ['FULL', 'FULL', 'FULL', 'FULL', 'FULL', 'OFF', 'OFF'],
      exceptions: [],
    };
  }
  return {
    name: week.name,
    description: week.description ?? '',
    isDefault: week.isDefault,
    base: [1, 2, 3, 4, 5, 6, 7].map(
      (d) => week.rules.find((r) => r.weekday === d && r.occurrence === 0)?.dayType ?? 'OFF',
    ),
    exceptions: week.rules.filter((r) => r.occurrence > 0),
  };
}

function WorkWeekForm({ week, onDone }: { week: WorkWeekItem | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<WeekDraft>(() => draftFrom(week));
  const [error, setError] = useState<string | null>(null);
  const rules: WorkWeekRuleItem[] = [
    ...draft.base.map((dayType, i) => ({ weekday: i + 1, occurrence: 0, dayType })),
    ...draft.exceptions,
  ];
  const body = {
    name: draft.name,
    description: draft.description.trim() || null,
    isDefault: draft.isDefault,
    rules,
  };
  const save = useMutation({
    mutationFn: () =>
      week ? api.patch(`/work-weeks/${week.id}`, body) : api.post('/work-weeks', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      onDone();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  const submit = () => {
    const parsed = (week ? updateWorkWeekSchema : createWorkWeekSchema).safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('. '));
      return;
    }
    setError(null);
    save.mutate();
  };
  const update = (patch: Partial<WeekDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Name" required>
            <Input
              autoFocus
              value={draft.name}
              onChange={(e) => {
                update({ name: e.target.value });
              }}
            />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2 text-base">
            <Checkbox
              checked={draft.isDefault}
              onCheckedChange={(v) => {
                update({ isDefault: v === true });
              }}
            />
            Organization default
          </label>
          <FormField label="Description" className="sm:col-span-2">
            <Textarea
              value={draft.description}
              onChange={(e) => {
                update({ description: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 font-medium">Weekly pattern</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {WEEKDAYS.map((day, i) => (
              <div
                key={day}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <span>{day}</span>
                <Select
                  aria-label={`${day} day type`}
                  className="h-7 w-36"
                  value={draft.base[i]}
                  onChange={(e) => {
                    const base = [...draft.base];
                    base[i] = e.target.value as DayTypeValue;
                    update({ base });
                  }}
                  options={DAY_TYPE_OPTIONS}
                />
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 font-medium">Exceptions by occurrence</legend>
          <p className="text-sm text-muted-foreground">
            Override specific weeks of the month, e.g. 2nd and 4th Saturday off.
          </p>
          {draft.exceptions.map((ex, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Occurrence"
                className="h-7 w-24"
                value={String(ex.occurrence)}
                onChange={(e) => {
                  const exceptions = [...draft.exceptions];
                  exceptions[idx] = { ...ex, occurrence: Number(e.target.value) };
                  update({ exceptions });
                }}
                options={[1, 2, 3, 4, 5].map((o) => ({
                  value: String(o),
                  label: ORDINALS[o] ?? '',
                }))}
              />
              <Select
                aria-label="Weekday"
                className="h-7 w-36"
                value={String(ex.weekday)}
                onChange={(e) => {
                  const exceptions = [...draft.exceptions];
                  exceptions[idx] = { ...ex, weekday: Number(e.target.value) };
                  update({ exceptions });
                }}
                options={WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d }))}
              />
              <Select
                aria-label="Day type"
                className="h-7 w-36"
                value={ex.dayType}
                onChange={(e) => {
                  const exceptions = [...draft.exceptions];
                  exceptions[idx] = { ...ex, dayType: e.target.value as DayTypeValue };
                  update({ exceptions });
                }}
                options={DAY_TYPE_OPTIONS}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove exception"
                onClick={() => {
                  update({ exceptions: draft.exceptions.filter((_, i) => i !== idx) });
                }}
              >
                <X />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                update({
                  exceptions: [...draft.exceptions, { weekday: 6, occurrence: 2, dayType: 'OFF' }],
                });
              }}
            >
              <Plus /> Add exception
            </Button>
          </div>
        </fieldset>
        <p className="text-sm text-muted-foreground">Preview: {summarizeWorkWeek(rules)}</p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={save.isPending} aria-busy={save.isPending}>
          {week ? 'Save changes' : 'Create work week'}
        </Button>
      </DialogFooter>
    </>
  );
}

function WorkWeeksSection() {
  const queryClient = useQueryClient();
  const canManage = usePermission(PERMISSIONS.ORGANIZATION_CALENDAR_MANAGE);
  const weeks = useWorkWeeks();
  const [editing, setEditing] = useState<WorkWeekItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<WorkWeekItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (w: WorkWeekItem) => api.delete(`/work-weeks/${w.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err));
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">
          Weekly working patterns. Branches use the organization default unless they set their own.
        </p>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> New work week
          </Button>
        ) : null}
      </div>
      {weeks.isPending ? (
        <Skeleton className="h-24" />
      ) : weeks.isError ? (
        <ErrorState
          title="Could not load work weeks"
          description={errorMessage(weeks.error)}
          onRetry={() => void weeks.refetch()}
        />
      ) : weeks.data.length === 0 ? (
        <EmptyState
          title="No work weeks yet"
          description="Define the weekly working pattern used for attendance, leave and payroll day counts."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {weeks.data.map((w) => (
            <li key={w.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{w.name}</CardTitle>
                  {w.isDefault ? <Badge variant="primary">Default</Badge> : null}
                  {canManage ? (
                    <div className="ml-auto flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${w.name}`}
                        onClick={() => {
                          setEditing(w);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${w.name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(w);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-1">
                  <p>{summarizeWorkWeek(w.rules)}</p>
                  {w.description ? (
                    <p className="text-sm text-muted-foreground">{w.description}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    Used by {w.branchCount} {w.branchCount === 1 ? 'branch' : 'branches'}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader title={editing === 'new' ? 'New work week' : 'Edit work week'} />
          {editing ? (
            <WorkWeekForm
              week={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {deleting ? (
        <ConfirmDialog
          open
          title="Delete work week?"
          description={`${deleting.name} will be deleted. Work weeks used by branches cannot be deleted.`}
          confirmLabel="Delete"
          destructive
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => {
            remove.mutate(deleting);
          }}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------- holidays

function CalendarForm({
  calendar,
  onDone,
}: {
  calendar: HolidayCalendarItem | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(calendar?.name ?? '');
  const [description, setDescription] = useState(calendar?.description ?? '');
  const [isDefault, setIsDefault] = useState(calendar?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);
  const body = { name, description: description.trim() || null, isDefault };
  const save = useMutation({
    mutationFn: () =>
      calendar
        ? api.patch(`/holiday-calendars/${calendar.id}`, body)
        : api.post('/holiday-calendars', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      onDone();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormField label="Name" required>
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormField>
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </FormField>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={isDefault}
            onCheckedChange={(v) => {
              setIsDefault(v === true);
            }}
          />
          Organization default
        </label>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const parsed = (
              calendar ? updateHolidayCalendarSchema : createHolidayCalendarSchema
            ).safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues.map((i) => i.message).join('. '));
              return;
            }
            save.mutate();
          }}
        >
          {calendar ? 'Save changes' : 'Create calendar'}
        </Button>
      </DialogFooter>
    </>
  );
}

interface HolidayRow {
  date: string;
  name: string;
  kind: HolidayKindValue;
}

function AddHolidaysForm({ calendarId, onDone }: { calendarId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<HolidayRow[]>([{ date: '', name: '', kind: 'PUBLIC' }]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post(`/holiday-calendars/${calendarId}/holidays`, { holidays: rows }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      onDone();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  const setRow = (i: number, patch: Partial<HolidayRow>) => {
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <p className="text-sm text-muted-foreground">
          Enter the holidays your organization has declared. Dates already in this calendar are
          rejected.
        </p>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[9.5rem_1fr_11rem_auto] items-center gap-2">
            <Input
              type="date"
              aria-label={`Holiday ${String(i + 1)} date`}
              value={row.date}
              onChange={(e) => {
                setRow(i, { date: e.target.value });
              }}
            />
            <Input
              aria-label={`Holiday ${String(i + 1)} name`}
              placeholder="Name"
              value={row.name}
              onChange={(e) => {
                setRow(i, { name: e.target.value });
              }}
            />
            <Select
              aria-label={`Holiday ${String(i + 1)} kind`}
              value={row.kind}
              onChange={(e) => {
                setRow(i, { kind: e.target.value as HolidayKindValue });
              }}
              options={KIND_OPTIONS}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove holiday ${String(i + 1)}`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((r) => r.filter((_, idx) => idx !== i));
              }}
            >
              <X />
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRows((r) => [...r, { date: '', name: '', kind: 'PUBLIC' }]);
            }}
          >
            <Plus /> Add row
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const parsed = bulkHolidaysSchema.safeParse({ holidays: rows });
            if (!parsed.success) {
              setError(
                parsed.error.issues
                  .map((iss) => {
                    const row =
                      typeof iss.path[1] === 'number' ? `Row ${String(iss.path[1] + 1)}: ` : '';
                    return `${row}${iss.message}`;
                  })
                  .join('. '),
              );
              return;
            }
            setError(null);
            save.mutate();
          }}
        >
          Save holidays
        </Button>
      </DialogFooter>
    </>
  );
}

function HolidayList({
  calendar,
  canManage,
}: {
  calendar: HolidayCalendarItem;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [adding, setAdding] = useState(false);
  const holidays = useQuery({
    queryKey: ['structure', '/holiday-calendars', calendar.id, 'holidays', year],
    queryFn: () =>
      api.get<HolidayItem[]>(`/holiday-calendars/${calendar.id}/holidays`, { query: { year } }),
  });
  const remove = useMutation({
    mutationFn: (h: HolidayItem) =>
      api.delete(`/holiday-calendars/${calendar.id}/holidays/${h.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['structure'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{calendar.name}</CardTitle>
        <div className="ml-auto flex items-center gap-2">
          <Select
            aria-label="Year"
            className="h-7 w-24"
            value={String(year)}
            onChange={(e) => {
              setYear(Number(e.target.value));
            }}
            options={[-1, 0, 1, 2].map((o) => {
              const y = new Date().getFullYear() + o;
              return { value: String(y), label: String(y) };
            })}
          />
          {canManage ? (
            <Button
              size="sm"
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus /> Add holidays
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {holidays.isPending ? (
          <Skeleton className="m-4 h-16" />
        ) : holidays.isError ? (
          <ErrorState title="Could not load holidays" description={errorMessage(holidays.error)} />
        ) : holidays.data.length === 0 ? (
          <EmptyState title={`No holidays in ${String(year)}`} icon={<CalendarDays />} />
        ) : (
          <ul className="divide-y divide-border" aria-label={`Holidays in ${String(year)}`}>
            {holidays.data.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-28 font-mono text-sm tabular-nums">{h.date}</span>
                <span className="w-10 text-sm text-muted-foreground">
                  {SHORT_WEEKDAYS[(new Date(`${h.date}T00:00:00Z`).getUTCDay() + 6) % 7]}
                </span>
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                {h.kind === 'OPTIONAL' ? (
                  <Badge variant="outline">Optional</Badge>
                ) : (
                  <Badge>Public</Badge>
                )}
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${h.name}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate(h);
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {remove.isError ? <Alert tone="destructive">{errorMessage(remove.error)}</Alert> : null}
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent size="lg">
          <DialogHeader title="Add holidays" description={calendar.name} />
          {adding ? (
            <AddHolidaysForm
              calendarId={calendar.id}
              onDone={() => {
                setAdding(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function HolidayCalendarsSection() {
  const queryClient = useQueryClient();
  const canManage = usePermission(PERMISSIONS.ORGANIZATION_CALENDAR_MANAGE);
  const calendars = useHolidayCalendars();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<HolidayCalendarItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<HolidayCalendarItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (c: HolidayCalendarItem) => api.delete(`/holiday-calendars/${c.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['structure'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err));
    },
  });
  const list = calendars.data ?? [];
  const selected =
    list.find((c) => c.id === selectedId) ?? list.find((c) => c.isDefault) ?? list[0] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">
          Holiday lists are entered by your organization; no statutory list is assumed.
        </p>
        {canManage ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> New calendar
          </Button>
        ) : null}
      </div>
      {calendars.isPending ? (
        <Skeleton className="h-24" />
      ) : calendars.isError ? (
        <ErrorState
          title="Could not load holiday calendars"
          description={errorMessage(calendars.error)}
          onRetry={() => void calendars.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          title="No holiday calendars yet"
          description="Create a calendar and add your declared holidays."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[18rem_1fr]">
          <ul className="flex flex-col gap-1" aria-label="Holiday calendars">
            {list.map((c) => (
              <li key={c.id}>
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-3 py-2',
                    selected?.id === c.id ? 'border-primary bg-accent' : 'border-border',
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-pressed={selected?.id === c.id}
                    onClick={() => {
                      setSelectedId(c.id);
                    }}
                  >
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {c.holidayCount} holidays · {c.branchCount} branches
                    </span>
                  </button>
                  {c.isDefault ? <Badge variant="primary">Default</Badge> : null}
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${c.name}`}
                        onClick={() => {
                          setEditing(c);
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${c.name}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(c);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          {selected ? (
            <HolidayList key={selected.id} calendar={selected} canManage={canManage} />
          ) : null}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title={editing === 'new' ? 'New holiday calendar' : 'Edit holiday calendar'}
          />
          {editing ? (
            <CalendarForm
              calendar={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {deleting ? (
        <ConfirmDialog
          open
          title="Delete holiday calendar?"
          description={`${deleting.name} and its holidays will be deleted. Calendars used by branches cannot be deleted.`}
          confirmLabel="Delete"
          destructive
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => {
            remove.mutate(deleting);
          }}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------- preview

const KIND_STYLE: Record<ResolvedDayKindValue, { label: string; cls: string }> = {
  WORKING: { label: 'Working', cls: 'bg-background' },
  HALF_DAY: { label: 'Half day', cls: 'bg-info/10' },
  WEEKLY_OFF: { label: 'Weekly off', cls: 'bg-muted text-muted-foreground' },
  HOLIDAY: { label: 'Holiday', cls: 'bg-warning/15' },
  OPTIONAL_HOLIDAY: { label: 'Optional holiday', cls: 'bg-success/10' },
};

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function PreviewSection() {
  const now = new Date();
  const [month, setMonth] = useState(
    `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [branchId, setBranchId] = useState('');
  const branches = useRefOptions({ path: '/branches' });
  const range = monthRange(month);
  const resolved = useQuery({
    queryKey: ['structure', '/calendar/resolve', branchId, month],
    queryFn: () =>
      api.get<ResolvedCalendar>('/calendar/resolve', {
        query: { ...range, ...(branchId ? { branchId } : {}) },
      }),
    enabled: /^\d{4}-\d{2}$/.test(month),
  });
  const days = resolved.data?.days ?? [];
  const leading = days[0] ? days[0].weekday - 1 : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Month">
          <Input
            type="month"
            className="w-44"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
            }}
          />
        </FormField>
        <FormField label="Branch">
          <Select
            className="w-64"
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
            }}
            placeholder="Organization defaults"
            options={[{ value: '', label: 'Organization defaults' }, ...(branches.data ?? [])]}
          />
        </FormField>
      </div>
      {resolved.isPending ? (
        <Skeleton className="h-64" />
      ) : resolved.isError ? (
        <ErrorState
          title="Could not resolve the calendar"
          description={errorMessage(resolved.error)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{resolved.data.workingDays} working days</CardTitle>
            <span className="text-sm text-muted-foreground">
              Work week: {resolved.data.workWeek?.name ?? 'none (no default set)'} · Holidays:{' '}
              {resolved.data.holidayCalendar?.name ?? 'none (no default set)'}
            </span>
          </CardHeader>
          <CardContent>
            <div role="grid" aria-label="Resolved month" className="grid grid-cols-7 gap-1">
              {SHORT_WEEKDAYS.map((d) => (
                <div
                  key={d}
                  role="columnheader"
                  className="pb-1 text-center text-sm font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              {Array.from({ length: leading }, (_, i) => (
                <div key={`pad-${String(i)}`} />
              ))}
              {days.map((d) => {
                const style = KIND_STYLE[d.kind];
                return (
                  <div
                    key={d.date}
                    role="gridcell"
                    aria-label={`${d.date}: ${d.holidayName ?? style.label}`}
                    className={cn(
                      'min-h-16 rounded-md border border-border p-1.5 text-sm',
                      style.cls,
                    )}
                  >
                    <span className="font-medium tabular-nums">{Number(d.date.slice(8))}</span>
                    {d.kind !== 'WORKING' ? (
                      <span className="block truncate text-xs">{d.holidayName ?? style.label}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {Object.entries(KIND_STYLE).map(([k, s]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={cn('size-3 rounded-sm border border-border', s.cls)} />
                  {s.label}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function CalendarsPage() {
  const [params, setParams] = useSearchParams();
  const tab = ['work-weeks', 'holidays', 'preview'].includes(params.get('tab') ?? '')
    ? (params.get('tab') ?? 'work-weeks')
    : 'work-weeks';
  return (
    <Page>
      <PageHeader
        title="Working days & holidays"
        description="Work-week patterns, holiday calendars and the resolved working-day calendar."
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setParams({ tab: v }, { replace: true });
        }}
      >
        <TabsList aria-label="Calendar sections">
          <TabsTrigger value="work-weeks">Work weeks</TabsTrigger>
          <TabsTrigger value="holidays">Holiday calendars</TabsTrigger>
          <TabsTrigger value="preview">Month preview</TabsTrigger>
        </TabsList>
        <TabsContent value="work-weeks">
          {tab === 'work-weeks' ? <WorkWeeksSection /> : null}
        </TabsContent>
        <TabsContent value="holidays">
          {tab === 'holidays' ? <HolidayCalendarsSection /> : null}
        </TabsContent>
        <TabsContent value="preview">{tab === 'preview' ? <PreviewSection /> : null}</TabsContent>
      </Tabs>
    </Page>
  );
}
