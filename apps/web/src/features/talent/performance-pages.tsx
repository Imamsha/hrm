import type { GoalItem, ImprovementPlanItem, ReviewDetails } from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  competencySchema,
  goalCheckInSchema,
  goalSchema,
  pipCheckInSchema,
  pipOutcomeSchema,
  pipSchema,
  ratingScaleSchema,
  reviewCycleSchema,
  reviewTemplateSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  ROLE_LABEL,
  TALENT,
  TALENT_VARIANT,
  useCompetencies,
  useCycles,
  useDistribution,
  useGoalHistory,
  useGoals,
  useMyReviews,
  useMyTasks,
  useParticipants,
  usePips,
  useReview,
  useScales,
  useTemplates,
} from './talent-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={TALENT_VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);

function useAct() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: TALENT });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return { error, setError, run };
}

function Bar({ value }: { value: string | number }) {
  const n = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="h-1.5 w-full rounded bg-muted" aria-hidden>
      <div className="h-1.5 rounded bg-primary" style={{ width: `${String(n)}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------------------ goals

const goalFields: FieldDef[] = [
  { name: 'title', label: 'Title', required: true, wide: true },
  {
    name: 'kind',
    label: 'Type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'GOAL', label: 'Goal (% progress)' },
      { value: 'KPI', label: 'KPI (measured)' },
      { value: 'OBJECTIVE', label: 'Objective (OKR)' },
      { value: 'KEY_RESULT', label: 'Key result (measured)' },
    ],
  },
  {
    name: 'ownerType',
    label: 'Owner',
    kind: 'select',
    required: true,
    options: [
      { value: 'EMPLOYEE', label: 'An employee' },
      { value: 'DEPARTMENT', label: 'A department' },
      { value: 'ORGANIZATION', label: 'The organization' },
    ],
  },
  {
    name: 'employeeId',
    label: 'Employee',
    kind: 'ref',
    ref: employeeRef,
    refParams: { status: 'ACTIVE' },
    required: true,
    show: (v) => v.ownerType === 'EMPLOYEE',
  },
  {
    name: 'departmentId',
    label: 'Department',
    kind: 'ref',
    ref: { path: '/departments' },
    required: true,
    show: (v) => v.ownerType === 'DEPARTMENT',
  },
  {
    name: 'parentId',
    label: 'Aligned to (parent goal)',
    kind: 'ref',
    ref: { path: '/goals', label: (r: RefRow) => String(r.title) },
    refParams: { pageSize: '200' },
  },
  { name: 'weight', label: 'Weight' },
  { name: 'dueOn', label: 'Due', kind: 'date' },
  {
    name: 'measureStart',
    label: 'Start value',
    show: (v) => v.kind === 'KPI' || v.kind === 'KEY_RESULT',
  },
  {
    name: 'measureTarget',
    label: 'Target value',
    show: (v) => v.kind === 'KPI' || v.kind === 'KEY_RESULT',
  },
  { name: 'measureUnit', label: 'Unit', show: (v) => v.kind === 'KPI' || v.kind === 'KEY_RESULT' },
  { name: 'description', label: 'Description', kind: 'textarea' },
];

function GoalCard({ g, onCheckIn }: { g: GoalItem; onCheckIn: (g: GoalItem) => void }) {
  const [open, setOpen] = useState(false);
  const history = useGoalHistory(open ? g.id : null);
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{g.title}</span>
          <span className="block text-muted-foreground">
            {label(g.kind)}
            {g.employee
              ? ` · ${g.employee.displayName}`
              : g.ownerType === 'ORGANIZATION'
                ? ' · organization'
                : ' · department'}
            {g.parent ? ` · aligned to ${g.parent.title}` : ''}
            {g.measure
              ? ` · ${g.measure.current} of ${g.measure.target}${g.measure.unit ? ` ${g.measure.unit}` : ''} (from ${g.measure.start})`
              : ''}
            {g.dueOn ? ` · due ${g.dueOn}` : ''}
          </span>
        </span>
        <span className="w-28">
          <Bar value={g.progress} />
          <span className="text-xs text-muted-foreground">{g.progress}%</span>
        </span>
        <Status s={g.status} />
        {g.canEdit && g.status === 'ACTIVE' && !(g.kind === 'OBJECTIVE' && g.children > 0) ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              onCheckIn(g);
            }}
          >
            Check in
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          History
        </Button>
      </div>
      {open ? (
        <ol
          className="mt-2 flex flex-col gap-1 border-l border-border pl-3 text-muted-foreground"
          aria-label={`History of ${g.title}`}
        >
          {(history.data ?? []).map((h, i) => (
            <li key={i}>
              {new Date(h.at).toLocaleDateString()} · {h.progress}%
              {h.current ? ` (${h.current})` : ''} · {h.note}
              {h.author ? ` · ${h.author}` : ''}
            </li>
          ))}
          {history.data?.length === 0 ? <li>No check-ins yet.</li> : null}
        </ol>
      ) : null}
    </li>
  );
}

export function GoalsPage() {
  const [tab, setTab] = useState('mine');
  const goals = useGoals({
    pageSize: 200,
    ...(tab === 'org' ? { ownerType: 'ORGANIZATION' } : {}),
  });
  const [creating, setCreating] = useState(false);
  const [checkIn, setCheckIn] = useState<GoalItem | null>(null);
  const items = goals.data?.items ?? [];
  const shown =
    tab === 'org'
      ? items
      : items.filter((g) => g.ownerType === 'EMPLOYEE' || g.ownerType === 'DEPARTMENT');
  return (
    <Page>
      <PageHeader
        title="Goals & OKRs"
        description="Personal goals, KPIs and OKRs aligned to department and organization goals."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New goal
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Goal views">
          <TabsTrigger value="mine">Mine & my team</TabsTrigger>
          <TabsTrigger value="org">Organization</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {goals.isPending ? (
            <Skeleton className="h-32" />
          ) : !shown.length ? (
            <EmptyState title="No goals yet" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border" aria-label="Goals">
                  {shown.map((g) => (
                    <GoalCard key={g.id} g={g} onCheckIn={setCheckIn} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New goal" />
          <ResourceForm
            fields={goalFields}
            defaultValues={{
              title: '',
              kind: '',
              ownerType: 'EMPLOYEE',
              employeeId: '',
              departmentId: '',
              parentId: '',
              weight: '1',
              dueOn: '',
              measureStart: '',
              measureTarget: '',
              measureUnit: '',
              description: '',
            }}
            schema={goalSchema}
            transform={(body) => {
              const { measureStart, measureTarget, measureUnit, ...rest } = body as Record<
                string,
                string | null
              >;
              const measured = rest.kind === 'KPI' || rest.kind === 'KEY_RESULT';
              return {
                ...rest,
                measure:
                  measured && measureTarget
                    ? {
                        start: measureStart ?? '0',
                        target: measureTarget,
                        current: measureStart ?? '0',
                        unit: measureUnit,
                      }
                    : null,
              };
            }}
            submit={(body) => api.post('/goals', body)}
            invalidate={[TALENT]}
            submitLabel="Create goal"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={checkIn !== null}
        onOpenChange={(o) => {
          if (!o) setCheckIn(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Check in" description={checkIn?.title} />
          {checkIn ? (
            <ResourceForm
              fields={[
                checkIn.measure
                  ? {
                      name: 'current',
                      label: `Current value${checkIn.measure.unit ? ` (${checkIn.measure.unit})` : ''}`,
                      required: true,
                    }
                  : { name: 'progress', label: 'Progress (%)', required: true },
                { name: 'note', label: 'What changed?', kind: 'textarea', required: true },
              ]}
              defaultValues={{
                current: checkIn.measure?.current ?? '',
                progress: checkIn.progress,
                note: '',
              }}
              schema={goalCheckInSchema}
              submit={(body) => api.post(`/goals/${checkIn.id}/check-ins`, body)}
              invalidate={[TALENT]}
              submitLabel="Save"
              onDone={() => {
                setCheckIn(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ my reviews

export function MyReviewsPage() {
  const tasks = useMyTasks();
  const mine = useMyReviews();
  const pending = (tasks.data ?? []).filter((t) => t.status === 'PENDING');
  return (
    <Page>
      <PageHeader
        title="Reviews"
        description="Reviews you have been asked to write, and your own results once released."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>To do ({pending.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {tasks.isPending ? (
              <Skeleton className="m-4 h-20" />
            ) : !tasks.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing to review.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Review tasks">
                {tasks.data.map((t) => (
                  <li key={t.responseId} className="flex items-center gap-3 px-4 py-2">
                    <Link
                      to={`/performance/reviews/${t.participantId}`}
                      className="min-w-0 flex-1 text-primary hover:underline"
                    >
                      {ROLE_LABEL[t.role]}
                      {t.role === 'SELF' ? '' : ` · ${t.employee.displayName}`}
                    </Link>
                    <span className="text-muted-foreground">{t.cycle.name}</span>
                    <Status s={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>My results</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!mine.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">No review cycles yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="My review results">
                {mine.data.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                    <Link
                      to={`/performance/reviews/${r.id}`}
                      className="min-w-0 flex-1 text-primary hover:underline"
                    >
                      {r.cycle.name}
                    </Link>
                    {r.finalLabel ? (
                      <Badge variant="success">{r.finalLabel}</Badge>
                    ) : (
                      <Status s={r.cycle.status} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------------------ one review

function ResponseForm({
  review,
  responseId,
  role,
}: {
  review: ReviewDetails;
  responseId: string;
  role: string;
}) {
  const { error, run } = useAct();
  const existing = review.visible.find((v) => v.id === responseId)?.content;
  const scale = review.template.scale;
  const [ratings, setRatings] = useState<Record<string, string>>(
    Object.fromEntries((existing?.competencies ?? []).map((c) => [c.competencyId, c.rating])),
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries((existing?.answers ?? []).map((a) => [a.questionId, a.text])),
  );
  const [goals, setGoals] = useState<Record<string, string>>(
    Object.fromEntries(
      (existing?.goals ?? [])
        .filter((g) => g.achievementPercent !== undefined)
        .map((g) => [g.goalId, g.achievementPercent ?? '']),
    ),
  );
  const [overall, setOverall] = useState(existing?.overallComment ?? '');
  const [promotion, setPromotion] = useState(review.promotion);
  const [justification, setJustification] = useState(review.promotionJustification ?? '');
  const body = (submit: boolean) => ({
    competencies: Object.entries(ratings)
      .filter(([, v]) => v)
      .map(([competencyId, rating]) => ({ competencyId, rating })),
    answers: Object.entries(answers).map(([questionId, text]) => ({ questionId, text })),
    goals: Object.entries(goals)
      .filter(([, v]) => v !== '')
      .map(([goalId, achievementPercent]) => ({ goalId, achievementPercent })),
    overallComment: overall || null,
    ...(role === 'MANAGER' ? { promotion, promotionJustification: justification || null } : {}),
    submit,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your {ROLE_LABEL[role]?.toLowerCase()}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {review.template.competencies.map((c) => (
          <FormField key={c.competencyId} label={c.name} required>
            <Select
              aria-label={`Rating for ${c.name}`}
              value={ratings[c.competencyId] ?? ''}
              placeholder="Rate…"
              options={scale.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}` }))}
              onChange={(e) => {
                setRatings({ ...ratings, [c.competencyId]: e.target.value });
              }}
            />
          </FormField>
        ))}
        {role === 'MANAGER' && review.goals.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">
              Goal achievement (% — blank uses the tracked progress)
            </legend>
            {review.goals.map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  {g.title} · tracked {g.progress}%
                </span>
                <Input
                  aria-label={`Achievement for ${g.title}`}
                  className="w-24"
                  value={goals[g.id] ?? ''}
                  onChange={(e) => {
                    setGoals({ ...goals, [g.id]: e.target.value });
                  }}
                />
              </div>
            ))}
          </fieldset>
        ) : null}
        {review.template.questions.map((q) => (
          <FormField key={q.id} label={q.text} required={q.required}>
            <Textarea
              value={answers[q.id] ?? ''}
              onChange={(e) => {
                setAnswers({ ...answers, [q.id]: e.target.value });
              }}
            />
          </FormField>
        ))}
        <FormField label="Overall comment">
          <Textarea
            value={overall}
            onChange={(e) => {
              setOverall(e.target.value);
            }}
          />
        </FormField>
        {role === 'MANAGER' ? (
          <FormGrid columns={2}>
            <FormField
              label="Promotion"
              description="Recorded for HR; it never changes a job or salary by itself."
            >
              <Select
                value={promotion}
                onChange={(e) => {
                  setPromotion(e.target.value as typeof promotion);
                }}
                options={[
                  { value: 'NONE', label: 'No recommendation' },
                  { value: 'RECOMMEND', label: 'Recommend' },
                  { value: 'STRONGLY_RECOMMEND', label: 'Strongly recommend' },
                ]}
              />
            </FormField>
            {promotion !== 'NONE' ? (
              <FormField label="Justification" required>
                <Input
                  value={justification}
                  onChange={(e) => {
                    setJustification(e.target.value);
                  }}
                />
              </FormField>
            ) : null}
          </FormGrid>
        ) : null}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={run.isPending}
            onClick={() => {
              run.mutate(() => api.put(`/performance/responses/${responseId}`, body(false)));
            }}
          >
            Save draft
          </Button>
          <Button
            size="sm"
            disabled={run.isPending}
            onClick={() => {
              run.mutate(() => api.put(`/performance/responses/${responseId}`, body(true)));
            }}
          >
            Submit
          </Button>
          {role === 'PEER' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                run.mutate(() => api.post(`/performance/responses/${responseId}/decline`, {}));
              }}
            >
              Decline
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReviewPage() {
  const { id = '' } = useParams<{ id: string }>();
  const review = useReview(id);
  const tasks = useMyTasks();
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const { error, run } = useAct();
  const [peers, setPeers] = useState('');
  const [calibration, setCalibration] = useState({ finalRating: '', reason: '' });
  if (review.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (review.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(review.error)} />
      </Page>
    );
  const r = review.data;
  const scale = r.template.scale;
  const myOpen = (tasks.data ?? []).find(
    (t) => t.participantId === id && t.status === 'PENDING' && r.cycle.status === 'OPEN',
  );
  const competencyName = (cid: string) =>
    r.template.competencies.find((c) => c.competencyId === cid)?.name ?? cid;
  return (
    <Page>
      <PageHeader
        title={`${r.employee.displayName} · ${r.cycle.name}`}
        description={r.manager ? `Manager: ${r.manager.displayName}` : 'No manager on record'}
        actions={
          <>
            <Status s={r.cycle.status} />
            {r.finalLabel ? <Badge variant="success">Final: {r.finalLabel}</Badge> : null}
            {r.can.acknowledge ? (
              <Button
                size="sm"
                onClick={() => {
                  run.mutate(() => api.post(`/performance/reviews/${id}/acknowledge`, {}));
                }}
              >
                Acknowledge results
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
      {r.acknowledgedAt ? (
        <Alert tone="success" className="mb-3">
          Acknowledged on {new Date(r.acknowledgedAt).toLocaleDateString()}.
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-4">
          {myOpen ? (
            <ResponseForm review={r} responseId={myOpen.responseId} role={myOpen.role} />
          ) : null}
          {r.visible
            .filter((v) => v.status === 'SUBMITTED' && v.content)
            .map((v) => (
              <Card key={v.id}>
                <CardHeader>
                  <CardTitle>
                    {ROLE_LABEL[v.role]}
                    {v.reviewer && v.role !== 'SELF' ? ` · ${v.reviewer.displayName}` : ''}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-1 text-sm">
                  {(v.content?.competencies ?? []).map((c) => (
                    <p key={c.competencyId}>
                      {competencyName(c.competencyId)}:{' '}
                      <strong>{scale.find((s) => s.value === c.rating)?.label ?? c.rating}</strong>
                      {c.comment ? ` — ${c.comment}` : ''}
                    </p>
                  ))}
                  {(v.content?.answers ?? []).map((a) => (
                    <p key={a.questionId}>
                      <span className="text-muted-foreground">
                        {r.template.questions.find((q) => q.id === a.questionId)?.text}
                      </span>
                      <br />
                      {a.text}
                    </p>
                  ))}
                  {v.content?.overallComment ? (
                    <p className="italic">{v.content.overallComment}</p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          {r.anonymousFeedback.map((f) => (
            <Card key={f.role}>
              <CardHeader>
                <CardTitle>{ROLE_LABEL[f.role]} (anonymous)</CardTitle>
              </CardHeader>
              <CardContent className="text-sm" aria-label={`${ROLE_LABEL[f.role] ?? ''} summary`}>
                {f.hidden ? (
                  <p className="text-muted-foreground">
                    {r.cycle.status === 'CLOSED'
                      ? `Not shown: fewer than ${String(r.template.anonymityMinimum)} responses, to protect anonymity.`
                      : 'Shown after results are released.'}
                  </p>
                ) : (
                  <ul className="flex list-disc flex-col gap-1 pl-5">
                    {f.comments.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {r.responses.map((x) => (
                <p key={x.role}>
                  {ROLE_LABEL[x.role]}: {x.submitted}/{x.total}
                </p>
              ))}
              {r.computedRating ? (
                <p>
                  Computed rating:{' '}
                  {scale.find((s) => s.value === r.computedRating)?.label ?? r.computedRating}{' '}
                  (score {r.computedScore})
                </p>
              ) : null}
              {r.promotion !== 'NONE' ? (
                <p>
                  Promotion: {label(r.promotion)} — {r.promotionJustification}
                </p>
              ) : null}
              {r.calibrationReason ? <p>Calibrated: {r.calibrationReason}</p> : null}
            </CardContent>
          </Card>
          {r.can.nominatePeers ? (
            <Card>
              <CardHeader>
                <CardTitle>Peer reviewers</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Choose {r.template.peerMin}–{r.template.peerMax} colleagues.
                </p>
                <Select
                  aria-label="Peer"
                  value={peers}
                  placeholder="Choose a colleague…"
                  options={(employees.data ?? []).filter((e) => e.value !== r.employee.id)}
                  onChange={(e) => {
                    setPeers(e.target.value);
                  }}
                />
                <Button
                  size="sm"
                  disabled={!peers}
                  onClick={() => {
                    run.mutate(() =>
                      api.post(`/performance/reviews/${id}/peers`, {
                        reviewerEmployeeIds: [peers],
                      }),
                    );
                    setPeers('');
                  }}
                >
                  Request feedback
                </Button>
              </CardContent>
            </Card>
          ) : null}
          {r.can.calibrate ? (
            <Card>
              <CardHeader>
                <CardTitle>Calibrate</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Select
                  aria-label="Final rating"
                  value={calibration.finalRating}
                  placeholder="Final rating…"
                  options={scale.map((s) => ({ value: s.value, label: `${s.value} · ${s.label}` }))}
                  onChange={(e) => {
                    setCalibration({ ...calibration, finalRating: e.target.value });
                  }}
                />
                <Textarea
                  aria-label="Reason"
                  placeholder="Reason (required)"
                  value={calibration.reason}
                  onChange={(e) => {
                    setCalibration({ ...calibration, reason: e.target.value });
                  }}
                />
                <Button
                  size="sm"
                  disabled={!calibration.finalRating || !calibration.reason}
                  onClick={() => {
                    run.mutate(() => api.post(`/performance/reviews/${id}/calibrate`, calibration));
                  }}
                >
                  Save rating
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------------------ cycles (HR)

const cycleFields: FieldDef[] = [
  { name: 'name', label: 'Name', required: true, wide: true },
  {
    name: 'templateId',
    label: 'Template',
    kind: 'ref',
    required: true,
    ref: { path: '/performance/templates', paged: false },
  },
  { name: 'periodStart', label: 'Period from', kind: 'date', required: true },
  { name: 'periodEnd', label: 'Period to', kind: 'date', required: true },
  { name: 'selfDueOn', label: 'Self-reviews due', kind: 'date' },
  { name: 'managerDueOn', label: 'Manager reviews due', kind: 'date' },
  { name: 'companyId', label: 'Only company', kind: 'ref', ref: { path: '/companies' } },
  { name: 'departmentId', label: 'Only department', kind: 'ref', ref: { path: '/departments' } },
];

function CycleDetail({
  cycleId,
  status,
  manage,
}: {
  cycleId: string;
  status: string;
  manage: boolean;
}) {
  const participants = useParticipants(cycleId);
  const distribution = useDistribution(cycleId, manage && status !== 'DRAFT');
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" aria-label="Participants">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-normal">Employee</th>
                <th className="px-4 py-2 font-normal">Reviews</th>
                <th className="px-4 py-2 font-normal">Rating</th>
              </tr>
            </thead>
            <tbody>
              {(participants.data ?? []).map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link
                      to={`/performance/reviews/${p.id}`}
                      className="text-primary hover:underline"
                    >
                      {p.employee.displayName}
                    </Link>
                    {p.promotion !== 'NONE' ? (
                      <Badge variant="primary" className="ml-2">
                        promotion
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.responses
                      .map(
                        (r) => `${r.role.toLowerCase()} ${String(r.submitted)}/${String(r.total)}`,
                      )
                      .join(' · ')}
                  </td>
                  <td className="px-4 py-2">{p.finalLabel ?? p.computedRating ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {distribution.data ? (
        <Card>
          <CardHeader>
            <CardTitle>Distribution</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm" aria-label="Rating distribution">
            {distribution.data.map((d) => (
              <div key={d.value}>
                <span>
                  {d.label}: {d.count} ({d.percent}%)
                </span>
                <Bar value={d.percent} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function ReviewCyclesPage() {
  const manage = usePermission(P.PERFORMANCE_CYCLE_MANAGE);
  const cycles = useCycles();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { error, run } = useAct();
  const next: Record<string, { to: string; label: string }[]> = {
    DRAFT: [{ to: 'OPEN', label: 'Launch' }],
    OPEN: [{ to: 'CALIBRATION', label: 'Start calibration' }],
    CALIBRATION: [
      { to: 'OPEN', label: 'Reopen' },
      { to: 'CLOSED', label: 'Close & release results' },
    ],
    CLOSED: [],
  };
  return (
    <Page>
      <PageHeader
        title="Review cycles"
        description="Launch reviews for an audience, follow progress, calibrate and release results."
        actions={
          manage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New cycle
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!cycles.data?.length ? (
        <EmptyState
          title="No review cycles"
          description="Set up a rating scale and a template first."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {cycles.data.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {c.periodStart} → {c.periodEnd} · {c.template.name} · {c.participants} people ·
                  self {c.progress.selfSubmitted} · manager {c.progress.managerSubmitted}
                </span>
                <Status s={c.status} />
                <div className="ml-auto flex gap-1">
                  {manage
                    ? (next[c.status] ?? []).map((n) => (
                        <Button
                          key={n.to}
                          size="xs"
                          variant={n.to === 'OPEN' && c.status !== 'DRAFT' ? 'ghost' : 'outline'}
                          onClick={() => {
                            run.mutate(() =>
                              api.put(`/performance/cycles/${c.id}/status`, { status: n.to }),
                            );
                          }}
                        >
                          {n.label}
                        </Button>
                      ))
                    : null}
                  {c.status !== 'DRAFT' ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setSelected(selected === c.id ? null : c.id);
                      }}
                    >
                      {selected === c.id ? 'Hide' : 'Participants'}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              {selected === c.id ? (
                <CardContent>
                  <CycleDetail cycleId={c.id} status={c.status} manage={manage} />
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New review cycle" />
          <ResourceForm
            fields={cycleFields}
            defaultValues={{
              name: '',
              templateId: '',
              periodStart: '',
              periodEnd: '',
              selfDueOn: '',
              managerDueOn: '',
              companyId: '',
              departmentId: '',
            }}
            schema={reviewCycleSchema}
            transform={(body) => {
              const { companyId, departmentId, ...rest } = body;
              return { ...rest, audience: { companyId, departmentId } };
            }}
            submit={(body) => api.post('/performance/cycles', body)}
            invalidate={[TALENT]}
            submitLabel="Create cycle"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ setup (HR)

function ScaleForm({ onDone }: { onDone: () => void }) {
  const { error, setError, run } = useAct();
  const [name, setName] = useState('');
  const [points, setPoints] = useState([
    { value: '', label: '' },
    { value: '', label: '' },
  ]);
  return (
    <>
      <DialogBody className="flex flex-col gap-2">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormField label="Name" required>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </FormField>
        {points.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input
              aria-label={`Point ${String(i + 1)} value`}
              placeholder="Value"
              className="w-24"
              value={p.value}
              onChange={(e) => {
                setPoints(points.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)));
              }}
            />
            <Input
              aria-label={`Point ${String(i + 1)} label`}
              placeholder="Label"
              value={p.label}
              onChange={(e) => {
                setPoints(points.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)));
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove point ${String(i + 1)}`}
              disabled={points.length <= 2}
              onClick={() => {
                setPoints(points.filter((_, j) => j !== i));
              }}
            >
              <X />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPoints([...points, { value: '', label: '' }]);
            }}
          >
            <Plus /> Add point
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const body = { name, points };
            const parsed = ratingScaleSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the scale');
              return;
            }
            run.mutate(() => api.post('/performance/scales', body), { onSuccess: onDone });
          }}
        >
          Save scale
        </Button>
      </DialogFooter>
    </>
  );
}

function TemplateForm({ onDone }: { onDone: () => void }) {
  const scales = useScales();
  const competencies = useCompetencies();
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    name: '',
    ratingScaleId: '',
    goalsWeightPercent: '50',
    includeSelf: true,
    includeManager: true,
    peerMin: '0',
    peerMax: '3',
    includeUpward: false,
    anonymityMinimum: '',
  });
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [questions, setQuestions] = useState<{ id: string; text: string; required: boolean }[]>([]);
  const flag = (k: 'includeSelf' | 'includeManager' | 'includeUpward', text: string) => (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={v[k]}
        onCheckedChange={(c) => {
          setV({ ...v, [k]: c === true });
        }}
      />{' '}
      {text}
    </label>
  );
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Name" required>
            <Input
              value={v.name}
              onChange={(e) => {
                setV({ ...v, name: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Rating scale" required>
            <Select
              value={v.ratingScaleId}
              placeholder="Select…"
              options={(scales.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              onChange={(e) => {
                setV({ ...v, ratingScaleId: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Goals weight (%)" description="The rest is competencies.">
            <Input
              value={v.goalsWeightPercent}
              onChange={(e) => {
                setV({ ...v, goalsWeightPercent: e.target.value });
              }}
            />
          </FormField>
          <FormField
            label="Anonymity minimum"
            required
            description="Peer/upward feedback is shown to the employee only from this many responses."
          >
            <Input
              value={v.anonymityMinimum}
              onChange={(e) => {
                setV({ ...v, anonymityMinimum: e.target.value });
              }}
            />
          </FormField>
          {flag('includeSelf', 'Self-review')}
          {flag('includeManager', 'Manager review')}
          <FormField label="Peers (min)">
            <Input
              value={v.peerMin}
              onChange={(e) => {
                setV({ ...v, peerMin: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Peers (max)">
            <Input
              value={v.peerMax}
              onChange={(e) => {
                setV({ ...v, peerMax: e.target.value });
              }}
            />
          </FormField>
          {flag('includeUpward', 'Upward feedback from direct reports')}
        </FormGrid>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Competencies and weights</legend>
          {(competencies.data ?? [])
            .filter((c) => c.status === 'ACTIVE')
            .map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  aria-label={`Include ${c.name}`}
                  checked={c.id in chosen}
                  onCheckedChange={(on) => {
                    setChosen(
                      on === true
                        ? { ...chosen, [c.id]: '1' }
                        : Object.fromEntries(Object.entries(chosen).filter(([k]) => k !== c.id)),
                    );
                  }}
                />
                <span className="min-w-0 flex-1">{c.name}</span>
                {c.id in chosen ? (
                  <Input
                    aria-label={`Weight of ${c.name}`}
                    className="w-20"
                    value={chosen[c.id]}
                    onChange={(e) => {
                      setChosen({ ...chosen, [c.id]: e.target.value });
                    }}
                  />
                ) : null}
              </div>
            ))}
        </fieldset>
        {questions.map((q, i) => (
          <div key={q.id} className="flex items-center gap-2">
            <Input
              aria-label={`Question ${String(i + 1)}`}
              placeholder="Question"
              value={q.text}
              onChange={(e) => {
                setQuestions(
                  questions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)),
                );
              }}
            />
            <label className="flex items-center gap-1 text-sm">
              <Checkbox
                checked={q.required}
                onCheckedChange={(c) => {
                  setQuestions(
                    questions.map((x, j) => (j === i ? { ...x, required: c === true } : x)),
                  );
                }}
              />{' '}
              required
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove question ${String(i + 1)}`}
              onClick={() => {
                setQuestions(questions.filter((_, j) => j !== i));
              }}
            >
              <X />
            </Button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuestions([
                ...questions,
                { id: `q${String(questions.length + 1)}`, text: '', required: false },
              ]);
            }}
          >
            <Plus /> Add question
          </Button>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const body = {
              ...v,
              peerMin: Number(v.peerMin),
              peerMax: Number(v.peerMax),
              anonymityMinimum: Number(v.anonymityMinimum),
              competencies: Object.entries(chosen).map(([competencyId, weight]) => ({
                competencyId,
                weight,
              })),
              questions,
            };
            const parsed = reviewTemplateSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the template');
              return;
            }
            run.mutate(() => api.post('/performance/templates', body), { onSuccess: onDone });
          }}
        >
          Save template
        </Button>
      </DialogFooter>
    </>
  );
}

export function PerformanceSetupPage() {
  const scales = useScales();
  const competencies = useCompetencies();
  const templates = useTemplates();
  const [dialog, setDialog] = useState<'scale' | 'competency' | 'template' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Performance setup"
        description="Your rating scales, competencies and review templates — nothing is pre-filled."
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Rating scales</CardTitle>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                setDialog('scale');
              }}
            >
              <Plus /> Scale
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {(scales.data ?? []).map((s) => (
              <p key={s.id}>
                <strong>{s.name}</strong>:{' '}
                {s.points.map((p) => `${p.value} ${p.label}`).join(' · ')}
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Competencies</CardTitle>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                setDialog('competency');
              }}
            >
              <Plus /> Competency
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {(competencies.data ?? []).map((c) => (
              <p key={c.id}>
                {c.name} <span className="font-mono text-muted-foreground">{c.code}</span>
              </p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              disabled={!scales.data?.length}
              onClick={() => {
                setDialog('template');
              }}
            >
              <Plus /> Template
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {(templates.data ?? []).map((t) => (
              <p key={t.id}>
                <strong>{t.name}</strong> · {t.ratingScale.name} · goals {t.goalsWeightPercent}% ·{' '}
                {t.competencies.length} competencies · peers {t.peerMin}–{t.peerMax} · anonymity ≥{' '}
                {t.anonymityMinimum}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size={dialog === 'template' ? 'lg' : undefined}>
          {dialog === 'scale' ? (
            <>
              <DialogHeader title="New rating scale" />
              <ScaleForm
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'competency' ? (
            <>
              <DialogHeader title="New competency" />
              <ResourceForm
                fields={[
                  { name: 'code', label: 'Code', required: true },
                  { name: 'name', label: 'Name', required: true },
                  { name: 'category', label: 'Category' },
                  { name: 'description', label: 'Description', kind: 'textarea' },
                ]}
                defaultValues={{ code: '', name: '', category: '', description: '' }}
                schema={competencySchema}
                submit={(body) => api.post('/performance/competencies', body)}
                invalidate={[TALENT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'template' ? (
            <>
              <DialogHeader title="New review template" />
              <TemplateForm
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ improvement plans

function PipCard({ p }: { p: ImprovementPlanItem }) {
  const [dialog, setDialog] = useState<'checkin' | 'outcome' | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{p.employee.displayName}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {p.startDate} → {p.endDate}
          {p.manager ? ` · manager ${p.manager.displayName}` : ''}
        </span>
        <Status s={p.status} />
        {p.status === 'ACTIVE' ? (
          <div className="ml-auto flex gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setDialog('checkin');
              }}
            >
              Check in
            </Button>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setDialog('outcome');
              }}
            >
              Record outcome
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <p>{p.reason}</p>
        <ul className="list-disc pl-5">
          {p.objectives.map((o, i) => (
            <li key={i}>
              {o.text}
              {o.measure ? ` — ${o.measure}` : ''}
            </li>
          ))}
        </ul>
        {p.outcomeNote ? <p className="font-medium">Outcome: {p.outcomeNote}</p> : null}
        {p.checkIns.map((c, i) => (
          <p key={i} className="text-muted-foreground">
            {new Date(c.at).toLocaleDateString()} · {c.note}
            {c.author ? ` · ${c.author}` : ''}
          </p>
        ))}
      </CardContent>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === 'checkin' ? (
            <>
              <DialogHeader title="Check-in" />
              <ResourceForm
                fields={[{ name: 'note', label: 'Notes', kind: 'textarea', required: true }]}
                defaultValues={{ note: '' }}
                schema={pipCheckInSchema}
                submit={(body) => api.post(`/performance/pips/${p.id}/check-ins`, body)}
                invalidate={[TALENT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'outcome' ? (
            <>
              <DialogHeader title="Outcome" />
              <ResourceForm
                fields={[
                  {
                    name: 'outcome',
                    label: 'Outcome',
                    kind: 'select',
                    required: true,
                    placeholder: 'Select…',
                    options: [
                      { value: 'PASSED', label: 'Passed' },
                      { value: 'FAILED', label: 'Not met' },
                      { value: 'EXTENDED', label: 'Extend' },
                      { value: 'CANCELLED', label: 'Cancel' },
                    ],
                  },
                  {
                    name: 'newEndDate',
                    label: 'New end date',
                    kind: 'date',
                    show: (v) => v.outcome === 'EXTENDED',
                  },
                  { name: 'note', label: 'Notes', kind: 'textarea', required: true },
                ]}
                defaultValues={{ outcome: '', newEndDate: '', note: '' }}
                schema={pipOutcomeSchema}
                submit={(body) => api.post(`/performance/pips/${p.id}/outcome`, body)}
                invalidate={[TALENT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function PipsPage() {
  const pips = usePips();
  const [creating, setCreating] = useState(false);
  const [objectives, setObjectives] = useState('');
  return (
    <Page>
      <PageHeader
        title="Improvement plans"
        description="Visible only to the employee, their manager and HR."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New plan
          </Button>
        }
      />
      {!pips.data?.length ? (
        <EmptyState title="No improvement plans" />
      ) : (
        <div className="flex flex-col gap-3">
          {pips.data.map((p) => (
            <PipCard key={p.id} p={p} />
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader
            title="New improvement plan"
            description="Started by the employee's manager or HR."
          />
          <ResourceForm
            fields={[
              {
                name: 'employeeId',
                label: 'Employee',
                kind: 'ref',
                required: true,
                ref: employeeRef,
                refParams: { status: 'ACTIVE' },
                wide: true,
              },
              { name: 'startDate', label: 'From', kind: 'date', required: true },
              { name: 'endDate', label: 'To', kind: 'date', required: true },
              { name: 'reason', label: 'Reason', kind: 'textarea', required: true },
            ]}
            defaultValues={{ employeeId: '', startDate: '', endDate: '', reason: '' }}
            schema={pipSchema}
            extra={{
              objectives: objectives
                .split('\n')
                .map((t) => t.trim())
                .filter(Boolean)
                .map((text) => ({ text, measure: null })),
            }}
            submit={(body) => api.post('/performance/pips', body)}
            invalidate={[TALENT]}
            submitLabel="Start plan"
            onDone={() => {
              setCreating(false);
              setObjectives('');
            }}
          />
          <div className="px-6 pb-4">
            <FormField label="Objectives (one per line)" required>
              <Textarea
                value={objectives}
                onChange={(e) => {
                  setObjectives(e.target.value);
                }}
              />
            </FormField>
          </div>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
