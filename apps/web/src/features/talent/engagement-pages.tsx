import type { SurveyItem, SurveyQuestionItem } from '@hrm/shared-types';
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
  FormField,
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
  announcementSchema,
  badgeSchema,
  eventSchema,
  recognitionSchema,
  redemptionDecisionSchema,
  rewardSchema,
  suggestionSchema,
  suggestionStatusSchema,
  surveySchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ThumbsUp, X } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { localToIso } from '@/features/time/time-api';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  TALENT,
  TALENT_VARIANT,
  uid,
  useAnnouncements,
  useBadges,
  useEvents,
  useFeed,
  useMyRecognition,
  useRedemptions,
  useRewards,
  useSuggestions,
  useSurveyResults,
  useSurveys,
} from './talent-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={TALENT_VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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

/** Audience pickers shared by announcements, events and surveys; datetimes become ISO with offset. */
const audienceFields: FieldDef[] = [
  { name: 'companyId', label: 'Only company', kind: 'ref', ref: { path: '/companies' } },
  { name: 'departmentId', label: 'Only department', kind: 'ref', ref: { path: '/departments' } },
];
const shape =
  (datetimes: string[]) =>
  (body: Record<string, unknown>): Record<string, unknown> => {
    const { companyId, departmentId, ...rest } = body;
    for (const k of datetimes) {
      const v = rest[k];
      rest[k] = typeof v === 'string' && v ? localToIso(v) : null;
    }
    return {
      ...rest,
      audience: { companyId: companyId ?? null, departmentId: departmentId ?? null },
    };
  };

// ------------------------------------------------------------------------------ home

function Announcements({ manage }: { manage: boolean }) {
  const items = useAnnouncements(false);
  const { error, run } = useAct();
  if (!items.data?.length)
    return <p className="text-sm text-muted-foreground">No announcements.</p>;
  return (
    <div className="flex flex-col gap-3" aria-label="Announcements">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      {items.data.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle>{a.title}</CardTitle>
            {a.pinned ? <Badge variant="primary">pinned</Badge> : null}
            {!a.readAt ? <Badge variant="info">new</Badge> : null}
            <span className="ml-auto text-xs text-muted-foreground">
              {when(a.publishAt)}
              {a.author ? ` · ${a.author}` : ''}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="whitespace-pre-wrap">{a.body}</p>
            <div className="flex flex-wrap items-center gap-2">
              {!a.readAt ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    run.mutate(() => api.post(`/engagement/announcements/${a.id}/read`, {}));
                  }}
                >
                  Mark as read
                </Button>
              ) : null}
              {a.requiresAcknowledgement ? (
                a.acknowledgedAt ? (
                  <Badge variant="success">
                    acknowledged {new Date(a.acknowledgedAt).toLocaleDateString()}
                  </Badge>
                ) : (
                  <Button
                    size="xs"
                    onClick={() => {
                      run.mutate(() =>
                        api.post(`/engagement/announcements/${a.id}/acknowledge`, {}),
                      );
                    }}
                  >
                    Acknowledge
                  </Button>
                )
              ) : null}
              {manage && a.stats ? (
                <span className="text-xs text-muted-foreground">
                  read {a.stats.read}/{a.stats.audience}
                  {a.requiresAcknowledgement
                    ? ` · acknowledged ${String(a.stats.acknowledged)}/${String(a.stats.audience)}`
                    : ''}
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Events({ manage }: { manage: boolean }) {
  const events = useEvents();
  const { error, run } = useAct();
  if (!events.data?.length)
    return <p className="text-sm text-muted-foreground">No upcoming events.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm" aria-label="Events">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      {events.data.map((e) => (
        <li key={e.id} className="rounded border border-border p-3">
          <p className="font-medium">
            {e.title} {e.cancelledAt ? <Badge variant="destructive">cancelled</Badge> : null}
          </p>
          <p className="text-muted-foreground">
            {when(e.startsAt)} – {when(e.endsAt)}
            {e.location ? ` · ${e.location}` : ''} · {e.going} going
            {e.capacity ? ` of ${String(e.capacity)}` : ''} · {e.maybe} maybe
          </p>
          {e.description ? <p>{e.description}</p> : null}
          {!e.cancelledAt ? (
            <div className="mt-1 flex gap-1">
              {(['GOING', 'MAYBE', 'NOT_GOING'] as const).map((r) => (
                <Button
                  key={r}
                  size="xs"
                  variant={e.myResponse === r ? 'default' : 'outline'}
                  aria-pressed={e.myResponse === r}
                  onClick={() => {
                    run.mutate(() => api.post(`/engagement/events/${e.id}/rsvp`, { response: r }));
                  }}
                >
                  {label(r)}
                </Button>
              ))}
              {manage ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    run.mutate(() => api.post(`/engagement/events/${e.id}/cancel`, {}));
                  }}
                >
                  Cancel event
                </Button>
              ) : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Recognition() {
  const feed = useFeed();
  const badges = useBadges();
  const mine = useMyRecognition();
  const rewards = useRewards();
  const { error, run } = useAct();
  const [giving, setGiving] = useState(false);
  const balance = mine.data?.balance ?? 0;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle>Recognition</CardTitle>
          <Button
            size="xs"
            className="ml-auto"
            disabled={!badges.data?.some((b) => b.status === 'ACTIVE')}
            onClick={() => {
              setGiving(true);
            }}
          >
            <Plus /> Recognise someone
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border text-sm" aria-label="Recognition feed">
            {(feed.data ?? []).map((r) => (
              <li key={r.id} className="px-4 py-2">
                <p>
                  <strong>{r.from.displayName}</strong> → <strong>{r.to.displayName}</strong> ·{' '}
                  <Badge variant="primary">{r.badge.name}</Badge>
                  {r.points ? ` +${String(r.points)} pts` : ''}
                </p>
                <p className="text-muted-foreground">{r.message}</p>
              </li>
            ))}
            {feed.data?.length === 0 ? (
              <li className="p-4 text-muted-foreground">No recognition yet.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>My points: {balance}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {error ? <Alert tone="destructive">{error}</Alert> : null}
          <ul className="flex flex-col gap-1" aria-label="Rewards">
            {(rewards.data ?? [])
              .filter((w) => w.status === 'ACTIVE')
              .map((w) => (
                <li key={w.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    {w.name} · {w.pointsCost} pts
                    {w.stock !== null ? ` · ${String(w.stock)} left` : ''}
                  </span>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={balance < w.pointsCost || w.stock === 0 || run.isPending}
                    onClick={() => {
                      run.mutate(() => api.post(`/engagement/rewards/${w.id}/redeem`, {}));
                    }}
                  >
                    Redeem
                  </Button>
                </li>
              ))}
          </ul>
          {mine.data?.redemptions.length ? (
            <>
              <p className="font-medium">My redemptions</p>
              {mine.data.redemptions.map((x) => (
                <p key={x.id}>
                  {x.reward.name} · {x.pointsCost} pts <Status s={x.status} />
                  {x.note ? ` · ${x.note}` : ''}
                </p>
              ))}
            </>
          ) : null}
        </CardContent>
      </Card>
      <Dialog open={giving} onOpenChange={setGiving}>
        <DialogContent>
          <DialogHeader title="Recognise a colleague" />
          <ResourceForm
            fields={[
              {
                name: 'toEmployeeId',
                label: 'Colleague',
                kind: 'ref',
                required: true,
                ref: employeeRef,
                refParams: { status: 'ACTIVE' },
              },
              {
                name: 'badgeId',
                label: 'Badge',
                kind: 'select',
                required: true,
                placeholder: 'Select…',
                options: (badges.data ?? [])
                  .filter((b) => b.status === 'ACTIVE')
                  .map((b) => ({
                    value: b.id,
                    label: `${b.name}${b.points ? ` (+${String(b.points)} pts)` : ''}`,
                  })),
              },
              { name: 'message', label: 'Message', kind: 'textarea', required: true },
              { name: 'public', label: 'Show in the company feed', kind: 'checkbox' },
            ]}
            defaultValues={{ toEmployeeId: '', badgeId: '', message: '', public: 'true' }}
            schema={recognitionSchema}
            submit={(body) => api.post('/engagement/recognitions', body)}
            invalidate={[TALENT]}
            submitLabel="Send"
            onDone={() => {
              setGiving(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function EngagementHomePage() {
  const manage = usePermission(P.ENGAGEMENT_CONTENT_MANAGE);
  return (
    <Page>
      <PageHeader title="Company" description="Announcements, events and recognition." />
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <Announcements manage={manage} />
        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
          </CardHeader>
          <CardContent>
            <Events manage={manage} />
          </CardContent>
        </Card>
      </div>
      <div className="mt-4">
        <Recognition />
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------------------ surveys

function RespondDialog({ survey, onDone }: { survey: SurveyItem; onDone: () => void }) {
  const { error, run } = useAct();
  const [answers, setAnswers] = useState<Record<string, number | string | null>>({});
  const input = (q: SurveyQuestionItem) => {
    const set = (v: number | string | null) => {
      setAnswers({ ...answers, [q.id]: v });
    };
    const v = answers[q.id];
    if (q.type === 'TEXT')
      return (
        <Textarea
          aria-label={q.text}
          value={typeof v === 'string' ? v : ''}
          onChange={(e) => {
            set(e.target.value || null);
          }}
        />
      );
    if (q.type === 'CHOICE')
      return (
        <Select
          aria-label={q.text}
          value={typeof v === 'string' ? v : ''}
          placeholder="Choose…"
          options={(q.options ?? []).map((o) => ({ value: o, label: o }))}
          onChange={(e) => {
            set(e.target.value || null);
          }}
        />
      );
    const max = q.type === 'ENPS' ? 10 : 5;
    const min = q.type === 'ENPS' ? 0 : 1;
    return (
      <div className="flex flex-wrap gap-1" role="group" aria-label={q.text}>
        {Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => (
          <Button
            key={n}
            size="xs"
            variant={v === n ? 'default' : 'outline'}
            aria-pressed={v === n}
            onClick={() => {
              set(n);
            }}
          >
            {n}
          </Button>
        ))}
      </div>
    );
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {survey.anonymous ? (
          <Alert tone="info">
            This survey is anonymous: your answers are stored without your name.
          </Alert>
        ) : null}
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {survey.questions.map((q) => (
          <FormField
            key={q.id}
            label={q.type === 'ENPS' ? `${q.text} (0 = not at all, 10 = extremely likely)` : q.text}
            required={q.required}
          >
            {input(q)}
          </FormField>
        ))}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={run.isPending}
          onClick={() => {
            run.mutate(() => api.post(`/engagement/surveys/${survey.id}/responses`, { answers }), {
              onSuccess: onDone,
            });
          }}
        >
          Submit
        </Button>
      </DialogFooter>
    </>
  );
}

function Results({ id }: { id: string }) {
  const results = useSurveyResults(id);
  if (results.isPending) return <Skeleton className="h-20" />;
  if (results.isError) return <Alert tone="destructive">{errorMessage(results.error)}</Alert>;
  const r = results.data;
  if (r.hidden)
    return (
      <p className="text-sm text-muted-foreground">
        {r.responses} responses — results are shown from {r.minimumGroupSize} responses, to protect
        anonymity.
      </p>
    );
  return (
    <div className="flex flex-col gap-3 text-sm" aria-label="Survey results">
      <p>{r.responses} responses</p>
      {r.questions.map((q) => (
        <div key={q.id}>
          <p className="font-medium">{q.text}</p>
          {q.enps !== undefined ? <p>eNPS {q.enps}</p> : null}
          {q.average !== undefined ? <p>Average {q.average}</p> : null}
          {q.distribution ? (
            <p className="text-muted-foreground">
              {Object.entries(q.distribution)
                .map(([k, n]) => `${k}: ${String(n)}`)
                .join(' · ')}
            </p>
          ) : null}
          {q.texts ? (
            <ul className="list-disc pl-5 text-muted-foreground">
              {q.texts.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {r.byDepartment.length ? (
        <div>
          <p className="font-medium">By department</p>
          {r.byDepartment.map((d) => (
            <p key={d.department}>
              {d.department}:{' '}
              {d.hidden
                ? `hidden (fewer than ${String(r.minimumGroupSize)})`
                : `${String(d.responses)} responses · ${Object.entries(d.averages)
                    .map(([k, v]) => `${r.questions.find((q) => q.id === k)?.text ?? k} ${v}`)
                    .join(' · ')}`}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SurveyEditor({ onDone }: { onDone: () => void }) {
  const [questions, setQuestions] = useState<
    {
      id: string;
      type: SurveyQuestionItem['type'];
      text: string;
      options: string;
      required: boolean;
    }[]
  >([{ id: `q${uid()}`, type: 'RATING', text: '', options: '', required: true }]);
  const set = (i: number, patch: Partial<(typeof questions)[number]>) => {
    setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  };
  return (
    <>
      <ResourceForm
        fields={[
          { name: 'title', label: 'Title', required: true, wide: true },
          {
            name: 'kind',
            label: 'Type',
            kind: 'select',
            required: true,
            options: [
              { value: 'SURVEY', label: 'Survey' },
              { value: 'PULSE', label: 'Pulse check' },
            ],
          },
          {
            name: 'minimumGroupSize',
            label: 'Minimum group size',
            required: true,
            description: 'Results and breakdowns are hidden below this many responses.',
          },
          { name: 'opensAt', label: 'Opens', kind: 'datetime', required: true },
          { name: 'closesAt', label: 'Closes', kind: 'datetime', required: true },
          ...audienceFields,
          {
            name: 'anonymous',
            label: 'Anonymous (responses never store who answered)',
            kind: 'checkbox',
          },
          { name: 'description', label: 'Description', kind: 'textarea' },
        ]}
        defaultValues={{
          title: '',
          kind: 'SURVEY',
          minimumGroupSize: '',
          opensAt: '',
          closesAt: '',
          companyId: '',
          departmentId: '',
          anonymous: 'true',
          description: '',
        }}
        schema={surveySchema}
        extra={{
          questions: questions.map((q) => ({
            id: q.id,
            type: q.type,
            text: q.text,
            required: q.required,
            ...(q.type === 'CHOICE'
              ? {
                  options: q.options
                    .split('\n')
                    .map((o) => o.trim())
                    .filter(Boolean),
                }
              : {}),
          })),
        }}
        transform={shape(['opensAt', 'closesAt'])}
        submit={(body) => api.post('/engagement/surveys', body)}
        invalidate={[TALENT]}
        submitLabel="Save draft"
        onDone={onDone}
      />
      <fieldset className="flex flex-col gap-2 px-6 pb-4">
        <legend className="text-sm font-medium">Questions</legend>
        {questions.map((q, i) => (
          <div key={q.id} className="flex flex-col gap-1 rounded border border-border p-2">
            <div className="flex gap-2">
              <Input
                aria-label={`Question ${String(i + 1)}`}
                placeholder="Question"
                value={q.text}
                onChange={(e) => {
                  set(i, { text: e.target.value });
                }}
              />
              <Select
                aria-label={`Question ${String(i + 1)} type`}
                className="w-40"
                value={q.type}
                onChange={(e) => {
                  set(i, { type: e.target.value as SurveyQuestionItem['type'] });
                }}
                options={[
                  { value: 'RATING', label: 'Rating 1–5' },
                  { value: 'ENPS', label: 'eNPS 0–10' },
                  { value: 'CHOICE', label: 'Choice' },
                  { value: 'TEXT', label: 'Free text' },
                ]}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove question ${String(i + 1)}`}
                disabled={questions.length <= 1}
                onClick={() => {
                  setQuestions(questions.filter((_, j) => j !== i));
                }}
              >
                <X />
              </Button>
            </div>
            {q.type === 'CHOICE' ? (
              <Textarea
                aria-label={`Options for question ${String(i + 1)}`}
                placeholder="One option per line"
                value={q.options}
                onChange={(e) => {
                  set(i, { options: e.target.value });
                }}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={q.required}
                onCheckedChange={(c) => {
                  set(i, { required: c === true });
                }}
              />{' '}
              required
            </label>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQuestions([
                ...questions,
                { id: `q${uid()}`, type: 'RATING', text: '', options: '', required: false },
              ]);
            }}
          >
            <Plus /> Question
          </Button>
        </div>
      </fieldset>
    </>
  );
}

export function SurveysPage() {
  const manage = usePermission(P.ENGAGEMENT_SURVEY_MANAGE);
  const surveys = useSurveys();
  const { error, run } = useAct();
  const [responding, setResponding] = useState<SurveyItem | null>(null);
  const [results, setResults] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Surveys"
        description="Engagement surveys and pulse checks."
        actions={
          manage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New survey
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!surveys.data?.length ? (
        <EmptyState title="No surveys" />
      ) : (
        <div className="flex flex-col gap-3">
          {surveys.data.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>{s.title}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {label(s.kind)}
                  {s.anonymous ? ' · anonymous' : ''} · closes {when(s.closesAt)}
                  {manage ? ` · ${String(s.responded)}/${String(s.invited)} responded` : ''}
                </span>
                <Status s={s.status} />
                <div className="ml-auto flex gap-1">
                  {s.canRespond ? (
                    <Button
                      size="xs"
                      onClick={() => {
                        setResponding(s);
                      }}
                    >
                      Respond
                    </Button>
                  ) : null}
                  {s.hasResponded ? <Badge variant="success">responded</Badge> : null}
                  {manage && s.status === 'DRAFT' ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        run.mutate(() => api.post(`/engagement/surveys/${s.id}/publish`, {}));
                      }}
                    >
                      Publish
                    </Button>
                  ) : null}
                  {manage && s.status === 'PUBLISHED' ? (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        run.mutate(() => api.post(`/engagement/surveys/${s.id}/close`, {}));
                      }}
                    >
                      Close
                    </Button>
                  ) : null}
                  {manage && s.status !== 'DRAFT' ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setResults(results === s.id ? null : s.id);
                      }}
                    >
                      {results === s.id ? 'Hide results' : 'Results'}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              {results === s.id ? (
                <CardContent>
                  <Results id={s.id} />
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={responding !== null}
        onOpenChange={(o) => {
          if (!o) setResponding(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader
            title={responding?.title ?? ''}
            description={responding?.description ?? undefined}
          />
          {responding ? (
            <RespondDialog
              survey={responding}
              onDone={() => {
                setResponding(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New survey" description="Invitations go out when you publish it." />
          <SurveyEditor
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ suggestions

export function SuggestionsPage() {
  const manage = usePermission(P.ENGAGEMENT_SUGGESTION_MANAGE);
  const items = useSuggestions();
  const { error, run } = useAct();
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  return (
    <Page>
      <PageHeader
        title="Suggestions"
        description="Ideas from anyone; vote for the ones you support."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New suggestion
          </Button>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!items.data?.length ? (
        <EmptyState title="No suggestions yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Suggestions">
              {items.data.map((s) => (
                <li key={s.id} className="flex gap-3 px-4 py-3">
                  <Button
                    size="sm"
                    variant={s.myVote ? 'default' : 'outline'}
                    aria-pressed={s.myVote}
                    aria-label={`Vote for ${s.title}`}
                    onClick={() => {
                      run.mutate(() =>
                        s.myVote
                          ? api.delete(`/engagement/suggestions/${s.id}/vote`)
                          : api.post(`/engagement/suggestions/${s.id}/vote`, {}),
                      );
                    }}
                  >
                    <ThumbsUp /> {s.votes}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {s.title} <Status s={s.status} />
                    </p>
                    <p className="text-muted-foreground">
                      {s.anonymous ? 'Anonymous' : (s.author?.displayName ?? '')}
                      {s.category ? ` · ${s.category}` : ''} ·{' '}
                      {new Date(s.createdAt).toLocaleDateString()}
                    </p>
                    <p className="whitespace-pre-wrap">{s.body}</p>
                    {s.response ? (
                      <p className="mt-1 border-l-2 border-primary pl-2">{s.response}</p>
                    ) : null}
                  </div>
                  {manage ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setDeciding(s.id);
                      }}
                    >
                      Respond
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New suggestion" />
          <ResourceForm
            fields={[
              { name: 'title', label: 'Title', required: true },
              { name: 'category', label: 'Category' },
              { name: 'body', label: 'Details', kind: 'textarea', required: true },
              {
                name: 'anonymous',
                label: 'Post anonymously (your name is not stored)',
                kind: 'checkbox',
              },
            ]}
            defaultValues={{ title: '', category: '', body: '', anonymous: 'false' }}
            schema={suggestionSchema}
            submit={(body) => api.post('/engagement/suggestions', body)}
            invalidate={[TALENT]}
            submitLabel="Post"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={deciding !== null}
        onOpenChange={(o) => {
          if (!o) setDeciding(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Respond to suggestion" />
          <ResourceForm
            fields={[
              {
                name: 'status',
                label: 'Status',
                kind: 'select',
                required: true,
                placeholder: 'Select…',
                options: ['UNDER_REVIEW', 'ACCEPTED', 'IMPLEMENTED', 'DECLINED'].map((v) => ({
                  value: v,
                  label: label(v),
                })),
              },
              { name: 'response', label: 'Response', kind: 'textarea' },
            ]}
            defaultValues={{ status: '', response: '' }}
            schema={suggestionStatusSchema}
            submit={(body) => api.put(`/engagement/suggestions/${deciding ?? ''}/status`, body)}
            invalidate={[TALENT]}
            submitLabel="Save"
            onDone={() => {
              setDeciding(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ admin

export function EngagementAdminPage() {
  const badges = useBadges();
  const rewards = useRewards();
  const redemptions = useRedemptions(true);
  const announcements = useAnnouncements(true);
  const [tab, setTab] = useState('content');
  const [dialog, setDialog] = useState<'badge' | 'reward' | 'announcement' | 'event' | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  return (
    <Page>
      <PageHeader
        title="Engagement admin"
        description="Announcements, events, recognition badges and the rewards catalogue."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setDialog('event');
              }}
            >
              <Plus /> Event
            </Button>
            <Button
              onClick={() => {
                setDialog('announcement');
              }}
            >
              <Plus /> Announcement
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Engagement admin views">
          <TabsTrigger value="content">Announcements</TabsTrigger>
          <TabsTrigger value="rewards">Badges & rewards</TabsTrigger>
          <TabsTrigger value="redemptions">Redemptions</TabsTrigger>
        </TabsList>
        <TabsContent value="content">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border text-sm" aria-label="All announcements">
                {(announcements.data ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">{a.title}</span>
                    <span className="text-muted-foreground">
                      {when(a.publishAt)}
                      {a.expiresAt ? ` → ${when(a.expiresAt)}` : ''}
                      {a.stats ? ` · read ${String(a.stats.read)}/${String(a.stats.audience)}` : ''}
                      {a.stats && a.requiresAcknowledgement
                        ? ` · ack ${String(a.stats.acknowledged)}`
                        : ''}
                    </span>
                  </li>
                ))}
                {announcements.data?.length === 0 ? (
                  <li className="p-4 text-muted-foreground">None yet.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="rewards">
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Badges</CardTitle>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setDialog('badge');
                  }}
                >
                  <Plus /> Badge
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {(badges.data ?? []).map((b) => (
                  <p key={b.id}>
                    {b.name} · {b.points} pts{b.description ? ` · ${b.description}` : ''}
                  </p>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Rewards</CardTitle>
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setDialog('reward');
                  }}
                >
                  <Plus /> Reward
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {(rewards.data ?? []).map((w) => (
                  <p key={w.id}>
                    {w.name} · {w.pointsCost} pts
                    {w.stock !== null ? ` · stock ${String(w.stock)}` : ''}
                  </p>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="redemptions">
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border text-sm" aria-label="Redemptions">
                {(redemptions.data ?? []).map((x) => (
                  <li key={x.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      {x.employee.displayName} · {x.reward.name} · {x.pointsCost} pts
                    </span>
                    <Status s={x.status} />
                    {x.status === 'PENDING' ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setDeciding(x.id);
                        }}
                      >
                        Decide
                      </Button>
                    ) : null}
                  </li>
                ))}
                {redemptions.data?.length === 0 ? (
                  <li className="p-4 text-muted-foreground">No redemptions.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size={dialog === 'announcement' || dialog === 'event' ? 'lg' : undefined}>
          {dialog === 'badge' ? (
            <>
              <DialogHeader title="New badge" />
              <ResourceForm
                fields={[
                  { name: 'name', label: 'Name', required: true },
                  { name: 'points', label: 'Points awarded' },
                  { name: 'description', label: 'Description', kind: 'textarea' },
                ]}
                defaultValues={{ name: '', points: '0', description: '' }}
                schema={badgeSchema}
                submit={(body) => api.post('/engagement/badges', body)}
                invalidate={[TALENT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'reward' ? (
            <>
              <DialogHeader title="New reward" />
              <ResourceForm
                fields={[
                  { name: 'name', label: 'Name', required: true },
                  { name: 'pointsCost', label: 'Cost (points)', required: true },
                  { name: 'stock', label: 'Stock', description: 'Blank: unlimited.' },
                  { name: 'description', label: 'Description', kind: 'textarea' },
                ]}
                defaultValues={{ name: '', pointsCost: '', stock: '', description: '' }}
                schema={rewardSchema}
                submit={(body) => api.post('/engagement/rewards', body)}
                invalidate={[TALENT]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'announcement' ? (
            <>
              <DialogHeader title="New announcement" />
              <ResourceForm
                fields={[
                  { name: 'title', label: 'Title', required: true, wide: true },
                  { name: 'body', label: 'Message', kind: 'textarea', required: true },
                  {
                    name: 'publishAt',
                    label: 'Publish at',
                    kind: 'datetime',
                    description: 'Blank: now.',
                  },
                  { name: 'expiresAt', label: 'Expires at', kind: 'datetime' },
                  ...audienceFields,
                  { name: 'pinned', label: 'Pin to the top', kind: 'checkbox' },
                  {
                    name: 'requiresAcknowledgement',
                    label: 'Employees must acknowledge it',
                    kind: 'checkbox',
                  },
                ]}
                defaultValues={{
                  title: '',
                  body: '',
                  publishAt: '',
                  expiresAt: '',
                  companyId: '',
                  departmentId: '',
                  pinned: 'false',
                  requiresAcknowledgement: 'false',
                }}
                schema={announcementSchema}
                transform={shape(['publishAt', 'expiresAt'])}
                submit={(body) => api.post('/engagement/announcements', body)}
                invalidate={[TALENT]}
                submitLabel="Publish"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'event' ? (
            <>
              <DialogHeader title="New event" />
              <ResourceForm
                fields={[
                  { name: 'title', label: 'Title', required: true, wide: true },
                  { name: 'startsAt', label: 'Starts', kind: 'datetime', required: true },
                  { name: 'endsAt', label: 'Ends', kind: 'datetime', required: true },
                  { name: 'location', label: 'Location' },
                  { name: 'capacity', label: 'Capacity', description: 'Blank: unlimited.' },
                  ...audienceFields,
                  { name: 'description', label: 'Description', kind: 'textarea' },
                ]}
                defaultValues={{
                  title: '',
                  startsAt: '',
                  endsAt: '',
                  location: '',
                  capacity: '',
                  companyId: '',
                  departmentId: '',
                  description: '',
                }}
                schema={eventSchema}
                transform={shape(['startsAt', 'endsAt'])}
                submit={(body) => api.post('/engagement/events', body)}
                invalidate={[TALENT]}
                submitLabel="Create event"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={deciding !== null}
        onOpenChange={(o) => {
          if (!o) setDeciding(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Redemption" description="Rejecting returns the points." />
          <ResourceForm
            fields={[
              {
                name: 'status',
                label: 'Decision',
                kind: 'select',
                required: true,
                placeholder: 'Select…',
                options: [
                  { value: 'FULFILLED', label: 'Fulfilled' },
                  { value: 'REJECTED', label: 'Reject' },
                ],
              },
              { name: 'note', label: 'Note', kind: 'textarea' },
            ]}
            defaultValues={{ status: '', note: '' }}
            schema={redemptionDecisionSchema}
            submit={(body) => api.post(`/engagement/redemptions/${deciding ?? ''}/decision`, body)}
            invalidate={[TALENT]}
            submitLabel="Save"
            onDone={() => {
              setDeciding(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}
