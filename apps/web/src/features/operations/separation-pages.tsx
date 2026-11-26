import type { ExitQuestionItem } from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
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
import { resignationSchema, separationCaseSchema } from '@hrm/validation';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { useRoles } from '@/features/members/api';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  useAct,
  useCase,
  useCases,
  useExitAnalytics,
  useInterview,
  useResignations,
  useSeparationSettings,
  VARIANT,
} from './operations-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const REASONS = [
  'CAREER',
  'COMPENSATION',
  'RELOCATION',
  'PERSONAL',
  'HEALTH',
  'STUDIES',
  'MANAGER',
  'WORK_CULTURE',
  'OTHER',
];
const today = () => new Date().toISOString().slice(0, 10);

// ------------------------------------------------------------------------------ employee

export function MyResignationPage() {
  const mine = useResignations('mine');
  const { error, setError, run } = useAct();
  const [v, setV] = useState({ reasonCategory: 'CAREER', note: '', requestedLastDay: '' });
  const pending = mine.data?.find((r) => r.status === 'PENDING');
  return (
    <Page>
      <PageHeader
        title="Resignation"
        description="Tell your organization you are leaving. Your manager (or the approval workflow) decides the last working day."
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {!pending ? (
          <Card>
            <CardHeader>
              <CardTitle>Submit a resignation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <FormGrid columns={2}>
                <FormField label="Main reason" required>
                  <Select
                    value={v.reasonCategory}
                    options={REASONS.map((r) => ({ value: r, label: label(r) }))}
                    onChange={(e) => {
                      setV({ ...v, reasonCategory: e.target.value });
                    }}
                  />
                </FormField>
                <FormField label="Requested last working day" required>
                  <Input
                    type="date"
                    value={v.requestedLastDay}
                    onChange={(e) => {
                      setV({ ...v, requestedLastDay: e.target.value });
                    }}
                  />
                </FormField>
              </FormGrid>
              <FormField label="Note">
                <Textarea
                  value={v.note}
                  onChange={(e) => {
                    setV({ ...v, note: e.target.value });
                  }}
                />
              </FormField>
              <div>
                <Button
                  onClick={() => {
                    const body = { ...v, note: v.note || null };
                    const parsed = resignationSchema.safeParse(body);
                    if (!parsed.success) {
                      setError(parsed.error.issues[0]?.message ?? 'Check the resignation');
                      return;
                    }
                    run.mutate(() => api.post('/me/resignation', body));
                  }}
                >
                  Submit resignation
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm" aria-label="My resignations">
            {(mine.data ?? []).map((r) => (
              <div key={r.id} className="rounded border border-border p-3">
                <p className="flex items-center gap-2">
                  <Status s={r.status} /> submitted {r.submittedOn} · {label(r.reasonCategory)}
                </p>
                <p>
                  Requested last day {r.requestedLastDay}
                  {r.noticeLastDay ? ` · notice period ends ${r.noticeLastDay}` : ''}
                  {r.waivedNoticeDays
                    ? ` · ${String(r.waivedNoticeDays)} notice day(s) to waive`
                    : ''}
                </p>
                {r.agreedLastDay ? (
                  <p className="font-medium">Agreed last working day: {r.agreedLastDay}</p>
                ) : null}
                {r.decisionNote ? <p className="text-muted-foreground">{r.decisionNote}</p> : null}
                {r.caseId ? (
                  <Link
                    className="text-primary hover:underline"
                    to={`/separation/cases/${r.caseId}`}
                  >
                    Exit checklist
                  </Link>
                ) : null}
                {r.can.withdraw ? (
                  <div className="mt-1">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        run.mutate(() => api.post(`/separation/resignations/${r.id}/withdraw`, {}));
                      }}
                    >
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {!mine.data?.length ? (
              <p className="text-muted-foreground">No resignation submitted.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------------------ hub

function Approvals({ all }: { all: boolean }) {
  const list = useResignations(all ? 'all' : 'approvals');
  const { error, run } = useAct();
  const [deciding, setDeciding] = useState<{
    id: string;
    agreed: string;
    note: string;
    reject: boolean;
  } | null>(null);
  if (!list.data?.length)
    return <EmptyState title={all ? 'No resignations' : 'No resignations waiting for you'} />;
  return (
    <>
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border text-sm" aria-label="Resignations">
            {list.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <strong>{r.employee.displayName}</strong> · {label(r.reasonCategory)} · requested{' '}
                  {r.requestedLastDay}
                  {r.noticeLastDay ? (
                    <span className="text-muted-foreground"> · notice ends {r.noticeLastDay}</span>
                  ) : null}
                  {r.note ? <span className="block text-muted-foreground">{r.note}</span> : null}
                </span>
                <Status s={r.status} />
                {r.can.decide ? (
                  <>
                    <Button
                      size="xs"
                      onClick={() => {
                        setDeciding({
                          id: r.id,
                          agreed: r.requestedLastDay,
                          note: '',
                          reject: false,
                        });
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setDeciding({
                          id: r.id,
                          agreed: r.requestedLastDay,
                          note: '',
                          reject: true,
                        });
                      }}
                    >
                      Reject
                    </Button>
                  </>
                ) : null}
                {r.caseId ? (
                  <Link
                    className="text-primary hover:underline"
                    to={`/separation/cases/${r.caseId}`}
                  >
                    Case
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Dialog
        open={deciding !== null}
        onOpenChange={(o) => {
          if (!o) setDeciding(null);
        }}
      >
        <DialogContent>
          <DialogHeader title={deciding?.reject ? 'Reject resignation' : 'Approve resignation'} />
          {deciding ? (
            <>
              <DialogBody className="flex flex-col gap-3">
                {!deciding.reject ? (
                  <FormField label="Agreed last working day" required>
                    <Input
                      type="date"
                      value={deciding.agreed}
                      onChange={(e) => {
                        setDeciding({ ...deciding, agreed: e.target.value });
                      }}
                    />
                  </FormField>
                ) : null}
                <FormField label={deciding.reject ? 'Reason' : 'Note'} required={deciding.reject}>
                  <Textarea
                    value={deciding.note}
                    onChange={(e) => {
                      setDeciding({ ...deciding, note: e.target.value });
                    }}
                  />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button
                  disabled={deciding.reject && !deciding.note.trim()}
                  onClick={() => {
                    run.mutate(
                      () =>
                        api.post(`/separation/resignations/${deciding.id}/decision`, {
                          decision: deciding.reject ? 'REJECTED' : 'APPROVED',
                          ...(deciding.reject ? {} : { agreedLastDay: deciding.agreed }),
                          note: deciding.note || null,
                        }),
                      {
                        onSuccess: () => {
                          setDeciding(null);
                        },
                      },
                    );
                  }}
                >
                  {deciding.reject ? 'Reject' : 'Approve'}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Cases({ manage }: { manage: boolean }) {
  const cases = useCases();
  const [creating, setCreating] = useState(false);
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    employeeId: '',
    separationType: 'TERMINATION',
    reasonCategory: 'OTHER',
    lastWorkingDay: '',
    note: '',
  });
  return (
    <>
      {manage ? (
        <div className="mb-3">
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> Start a separation
          </Button>
        </div>
      ) : null}
      {!cases.data?.length ? (
        <EmptyState title="No separations" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Separation cases">
              {cases.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Link
                    className="min-w-0 flex-1 text-primary hover:underline"
                    to={`/separation/cases/${c.id}`}
                  >
                    {c.employee.displayName}
                  </Link>
                  <span className="text-muted-foreground">
                    {label(c.separationType)} · last day {c.lastWorkingDay} · clearance{' '}
                    {c.clearance.total - c.clearance.pending}/{c.clearance.total}
                    {c.interviewDone ? ' · interview done' : ''}
                  </span>
                  <Status s={c.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader
            title="Start a separation"
            description="For terminations, retirements and contract ends. Resignations start from the employee."
          />
          <DialogBody className="flex flex-col gap-3">
            {error ? <Alert tone="destructive">{error}</Alert> : null}
            <FormField label="Employee" required>
              <Select
                value={v.employeeId}
                placeholder="Select…"
                options={employees.data ?? []}
                onChange={(e) => {
                  setV({ ...v, employeeId: e.target.value });
                }}
              />
            </FormField>
            <FormGrid columns={2}>
              <FormField label="Type" required>
                <Select
                  value={v.separationType}
                  options={['TERMINATION', 'RETIREMENT', 'CONTRACT_END', 'OTHER'].map((t) => ({
                    value: t,
                    label: label(t),
                  }))}
                  onChange={(e) => {
                    setV({ ...v, separationType: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="Last working day" required>
                <Input
                  type="date"
                  value={v.lastWorkingDay}
                  onChange={(e) => {
                    setV({ ...v, lastWorkingDay: e.target.value });
                  }}
                />
              </FormField>
            </FormGrid>
            <FormField label="Note">
              <Textarea
                value={v.note}
                onChange={(e) => {
                  setV({ ...v, note: e.target.value });
                }}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button
              onClick={() => {
                const body = { ...v, note: v.note || null };
                const parsed = separationCaseSchema.safeParse(body);
                if (!parsed.success) {
                  setError(parsed.error.issues[0]?.message ?? 'Check the separation');
                  return;
                }
                run.mutate(() => api.post('/separation/cases', body), {
                  onSuccess: () => {
                    setCreating(false);
                  },
                });
              }}
            >
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Analytics() {
  const [range, setRange] = useState({ from: `${today().slice(0, 4)}-01-01`, to: today() });
  const a = useExitAnalytics(range.from, range.to, true);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <FormField label="From">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => {
              setRange({ ...range, from: e.target.value });
            }}
          />
        </FormField>
        <FormField label="To">
          <Input
            type="date"
            value={range.to}
            onChange={(e) => {
              setRange({ ...range, to: e.target.value });
            }}
          />
        </FormField>
      </div>
      {a.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Exit analytics">
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted-foreground">Separations</p>
              <p className="text-2xl font-semibold">{a.data.separations}</p>
              <p className="text-sm">attrition {a.data.attritionPercent ?? '—'}%</p>
            </CardContent>
          </Card>
          {(
            [
              ['By type', a.data.byType.map((x) => [label(x.type), x.count])],
              ['By reason', a.data.byReason.map((x) => [label(x.reason), x.count])],
              ['By department', a.data.byDepartment.map((x) => [x.department, x.count])],
              ['By month', a.data.byMonth.map((x) => [x.month, x.count])],
            ] as [string, [string, number][]][]
          ).map(([title, rows]) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {rows.map(([k, n]) => (
                  <p key={k}>
                    {k}: {n}
                  </p>
                ))}
                {!rows.length ? <p className="text-muted-foreground">—</p> : null}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader>
              <CardTitle>Exit interview ratings</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {a.data.ratings.map((r) => (
                <p key={r.questionId}>
                  {r.text}: {r.average ?? `hidden (${String(r.count)} of 5 answers needed)`}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Skeleton className="h-32" />
      )}
    </div>
  );
}

function Settings() {
  const settings = useSeparationSettings(true);
  const roles = useRoles();
  const { error, run } = useAct();
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState<{ title: string; ownerRoleKey: string }[] | null>(null);
  const [questions, setQuestions] = useState<ExitQuestionItem[] | null>(null);
  if (!settings.data) return <Skeleton className="h-32" />;
  const n = notice ?? (settings.data.noticeDays === null ? '' : String(settings.data.noticeDays));
  const its =
    items ??
    settings.data.clearanceTemplate.map((i) => ({
      title: i.title,
      ownerRoleKey: i.ownerRoleKey ?? '',
    }));
  const qs = questions ?? settings.data.exitQuestions;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Notice period and clearance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <FormField
            label="Notice period (days)"
            description="Blank: none configured; the requested last day is used."
          >
            <Input
              className="w-32"
              value={n}
              onChange={(e) => {
                setNotice(e.target.value);
              }}
            />
          </FormField>
          <p className="font-medium">Clearance items for every separation</p>
          {its.map((i, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                aria-label={`Clearance item ${String(idx + 1)}`}
                value={i.title}
                onChange={(e) => {
                  setItems(its.map((x, j) => (j === idx ? { ...x, title: e.target.value } : x)));
                }}
              />
              <Select
                aria-label={`Owner of item ${String(idx + 1)}`}
                className="w-44"
                value={i.ownerRoleKey}
                placeholder="Owner role…"
                options={(roles.data ?? [])
                  .filter((r) => r.key !== 'client')
                  .map((r) => ({ value: r.key, label: r.name }))}
                onChange={(e) => {
                  setItems(
                    its.map((x, j) => (j === idx ? { ...x, ownerRoleKey: e.target.value } : x)),
                  );
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove item ${String(idx + 1)}`}
                onClick={() => {
                  setItems(its.filter((_, j) => j !== idx));
                }}
              >
                <X />
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Assets, licence seats and the manager's knowledge transfer are added automatically.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setItems([...its, { title: '', ownerRoleKey: '' }]);
              }}
            >
              <Plus /> Item
            </Button>
            <Button
              size="sm"
              onClick={() => {
                run.mutate(() =>
                  api.put('/separation/settings', {
                    noticeDays: n === '' ? null : Number(n),
                    items: its.map((i) => ({
                      title: i.title,
                      ownerRoleKey: i.ownerRoleKey || null,
                      ownerEmployeeId: null,
                    })),
                  }),
                );
              }}
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Exit interview questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {qs.map((q, idx) => (
            <div key={q.id} className="flex gap-2">
              <Input
                aria-label={`Question ${String(idx + 1)}`}
                value={q.text}
                onChange={(e) => {
                  setQuestions(qs.map((x, j) => (j === idx ? { ...x, text: e.target.value } : x)));
                }}
              />
              <Select
                aria-label={`Question ${String(idx + 1)} type`}
                className="w-32"
                value={q.type}
                options={[
                  { value: 'RATING', label: 'Rating 1–5' },
                  { value: 'TEXT', label: 'Text' },
                ]}
                onChange={(e) => {
                  setQuestions(
                    qs.map((x, j) =>
                      j === idx ? { ...x, type: e.target.value as ExitQuestionItem['type'] } : x,
                    ),
                  );
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove question ${String(idx + 1)}`}
                onClick={() => {
                  setQuestions(qs.filter((_, j) => j !== idx));
                }}
              >
                <X />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setQuestions([...qs, { id: `q${String(Date.now())}`, type: 'RATING', text: '' }]);
              }}
            >
              <Plus /> Question
            </Button>
            <Button
              size="sm"
              onClick={() => {
                run.mutate(() => api.put('/separation/settings', { questions: qs }));
              }}
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function SeparationPage() {
  const manage = usePermission(P.SEPARATION_CASE_MANAGE);
  const analytics = usePermission(P.SEPARATION_INTERVIEW_READ);
  const [tab, setTab] = useState('approvals');
  return (
    <Page>
      <PageHeader
        title="Separations"
        description="Resignation approvals, exit checklists, interviews and attrition."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Separation views">
          <TabsTrigger value="approvals">To approve</TabsTrigger>
          <TabsTrigger value="cases">Exit checklists</TabsTrigger>
          {manage ? <TabsTrigger value="all">All resignations</TabsTrigger> : null}
          {analytics ? <TabsTrigger value="analytics">Analytics</TabsTrigger> : null}
          {manage ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="approvals">
          <Approvals all={false} />
        </TabsContent>
        <TabsContent value="cases">
          <Cases manage={manage} />
        </TabsContent>
        <TabsContent value="all">
          <Approvals all />
        </TabsContent>
        <TabsContent value="analytics">
          <Analytics />
        </TabsContent>
        <TabsContent value="settings">
          <Settings />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

// ------------------------------------------------------------------------------ case

const answerText = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : '—';

function Interview({
  caseId,
  canAnswer,
  canRead,
}: {
  caseId: string;
  canAnswer: boolean;
  canRead: boolean;
}) {
  const interview = useInterview(caseId, canAnswer || canRead);
  const { error, run } = useAct();
  const [answers, setAnswers] = useState<Record<string, number | string | null>>({});
  if (!interview.data) return null;
  const { questions, answers: recorded } = interview.data;
  if (!questions.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exit interview</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {recorded ? (
          questions.map((q) => (
            <p key={q.id}>
              <span className="text-muted-foreground">{q.text}</span>
              <br />
              {answerText(recorded[q.id])}
            </p>
          ))
        ) : canAnswer ? (
          <>
            <p className="text-xs text-muted-foreground">
              Your answers are seen only by HR, never by your manager.
            </p>
            {questions.map((q) => (
              <FormField key={q.id} label={q.text}>
                {q.type === 'RATING' ? (
                  <div className="flex gap-1" role="group" aria-label={q.text}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Button
                        key={n}
                        size="xs"
                        variant={answers[q.id] === n ? 'default' : 'outline'}
                        aria-pressed={answers[q.id] === n}
                        onClick={() => {
                          setAnswers({ ...answers, [q.id]: n });
                        }}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                ) : q.type === 'CHOICE' ? (
                  <Select
                    value={typeof answers[q.id] === 'string' ? String(answers[q.id]) : ''}
                    placeholder="Choose…"
                    options={(q.options ?? []).map((o) => ({ value: o, label: o }))}
                    onChange={(e) => {
                      setAnswers({ ...answers, [q.id]: e.target.value });
                    }}
                  />
                ) : (
                  <Textarea
                    value={typeof answers[q.id] === 'string' ? String(answers[q.id]) : ''}
                    onChange={(e) => {
                      setAnswers({ ...answers, [q.id]: e.target.value });
                    }}
                  />
                )}
              </FormField>
            ))}
            <div>
              <Button
                size="sm"
                onClick={() => {
                  run.mutate(() => api.post(`/separation/cases/${caseId}/interview`, { answers }));
                }}
              >
                Submit interview
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Recorded; visible to HR only.</p>
        )}
      </CardContent>
    </Card>
  );
}

export function SeparationCasePage() {
  const { id = '' } = useParams<{ id: string }>();
  const c = useCase(id);
  const { error, run } = useAct();
  const [waiving, setWaiving] = useState<{ itemId: string; note: string } | null>(null);
  if (c.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (c.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(c.error)} />
      </Page>
    );
  const s = c.data;
  return (
    <Page>
      <PageHeader
        title={`Exit checklist · ${s.employee.displayName}`}
        description={`${label(s.separationType)} · last working day ${s.lastWorkingDay}`}
        actions={
          <>
            <Status s={s.status} />
            {s.can.complete ? (
              <Button
                onClick={() => {
                  run.mutate(() => api.post(`/separation/cases/${id}/complete`, {}));
                }}
              >
                Complete separation
              </Button>
            ) : null}
            {s.can.cancel ? (
              <Button
                variant="outline"
                onClick={() => {
                  run.mutate(() => api.post(`/separation/cases/${id}/cancel`, {}));
                }}
              >
                Cancel separation
              </Button>
            ) : null}
          </>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {s.status === 'IN_PROGRESS' && s.clearance.pending ? (
        <Alert tone="info" className="mb-3">
          {s.clearance.pending} clearance item(s) left before the separation can be completed.
          Completing closes employment and suspends the login.
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Clearance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border text-sm" aria-label="Clearance items">
                {s.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      {i.title}
                      <span className="block text-xs text-muted-foreground">
                        {i.owner}
                        {i.decidedBy ? ` · ${i.decidedBy}` : ''}
                        {i.note ? ` · ${i.note}` : ''}
                      </span>
                    </span>
                    <Status s={i.status} />
                    {i.canDecide && i.kind !== 'ASSET' && i.kind !== 'LICENSE' ? (
                      <Button
                        size="xs"
                        onClick={() => {
                          run.mutate(() =>
                            api.post(`/separation/cases/${id}/items/${i.id}`, {
                              status: 'CLEARED',
                              note: null,
                            }),
                          );
                        }}
                      >
                        Clear
                      </Button>
                    ) : null}
                    {i.canDecide ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setWaiving({ itemId: i.id, note: '' });
                        }}
                      >
                        Waive
                      </Button>
                    ) : null}
                  </li>
                ))}
                {!s.items.length ? (
                  <li className="p-4 text-muted-foreground">No clearance items.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
          <Interview caseId={id} canAnswer={s.can.interview} canRead={s.can.readInterview} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-1 py-4 text-sm">
              <p>Reason: {label(s.reasonCategory)}</p>
              {s.note ? <p className="text-muted-foreground">{s.note}</p> : null}
              {s.settlement ? (
                <p>
                  Full & final:{' '}
                  <Link className="text-primary hover:underline" to="/payroll/settlements">
                    {label(s.settlement.status)} · net {s.settlement.netPayable}
                  </Link>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No full & final settlement yet (Payroll → Settlements).
                </p>
              )}
              {s.letters.map((l) => (
                <p key={l.id}>
                  Letter:{' '}
                  <Link className="text-primary hover:underline" to="/documents">
                    {l.title}
                  </Link>{' '}
                  ({label(l.status)})
                </p>
              ))}
              {!s.letters.length ? (
                <p className="text-muted-foreground">
                  Generate experience or relieving letters under Documents.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={waiving !== null}
        onOpenChange={(o) => {
          if (!o) setWaiving(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Waive clearance item" />
          {waiving ? (
            <>
              <DialogBody>
                <FormField label="Reason" required>
                  <Textarea
                    value={waiving.note}
                    onChange={(e) => {
                      setWaiving({ ...waiving, note: e.target.value });
                    }}
                  />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button
                  disabled={!waiving.note.trim()}
                  onClick={() => {
                    run.mutate(
                      () =>
                        api.post(`/separation/cases/${id}/items/${waiving.itemId}`, {
                          status: 'WAIVED',
                          note: waiving.note,
                        }),
                      {
                        onSuccess: () => {
                          setWaiving(null);
                        },
                      },
                    );
                  }}
                >
                  Waive
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
