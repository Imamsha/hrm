import type { CourseModuleItem, EnrollmentItem, QuizResultItem } from '@hrm/shared-types';
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
  courseFeedbackSchema,
  courseSchema,
  learningAssignmentSchema,
  learningPathSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  TALENT,
  TALENT_VARIANT,
  uid,
  useCourse,
  useCourses,
  useEnrollments,
  useMyLearning,
  usePaths,
  useSkillMatrix,
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

function Bar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded bg-muted" aria-hidden>
      <div
        className="h-1.5 rounded bg-primary"
        style={{ width: `${String(Math.max(0, Math.min(100, value)))}%` }}
      />
    </div>
  );
}

function EnrollmentRow({ e }: { e: EnrollmentItem }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
      <Link
        to={`/learning/courses/${e.course.id}`}
        className="min-w-0 flex-1 text-primary hover:underline"
      >
        {e.course.title} <span className="font-mono text-muted-foreground">{e.course.code}</span>
      </Link>
      <span className="text-muted-foreground">
        {label(e.source)}
        {e.dueOn ? ` · due ${e.dueOn}` : ''}
        {e.certificationExpiresOn ? ` · certified until ${e.certificationExpiresOn}` : ''}
      </span>
      <span className="w-24">
        <Bar value={e.progress} />
        <span className="text-xs text-muted-foreground">{e.progress}%</span>
      </span>
      {e.overdue ? <Badge variant="destructive">overdue</Badge> : null}
      <Status s={e.status} />
    </li>
  );
}

// ------------------------------------------------------------------------------ my learning

export function MyLearningPage() {
  const mine = useMyLearning();
  const courses = useCourses();
  const paths = usePaths();
  const { error, run } = useAct();
  const enrolledIds = new Set(
    (mine.data ?? []).filter((e) => e.status !== 'WITHDRAWN').map((e) => e.course.id),
  );
  const catalogue = (courses.data ?? []).filter((c) => c.status === 'PUBLISHED');
  return (
    <Page>
      <PageHeader
        title="My learning"
        description="Assigned and chosen courses, progress and certifications."
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>My courses</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {mine.isPending ? (
              <Skeleton className="m-4 h-20" />
            ) : !mine.data?.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                You are not enrolled in any course yet.
              </p>
            ) : (
              <ul className="divide-y divide-border" aria-label="My courses">
                {mine.data.map((e) => (
                  <EnrollmentRow key={e.id} e={e} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catalogue</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!catalogue.length ? (
              <p className="p-4 text-sm text-muted-foreground">No published courses.</p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Course catalogue">
                {catalogue.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <Link
                        to={`/learning/courses/${c.id}`}
                        className="text-primary hover:underline"
                      >
                        {c.title}
                      </Link>
                      <span className="block text-muted-foreground">
                        {label(c.format)} · {c.moduleCount} modules
                        {c.durationMinutes ? ` · ${String(c.durationMinutes)} min` : ''}
                        {c.skills.length ? ` · ${c.skills.join(', ')}` : ''}
                      </span>
                    </span>
                    {enrolledIds.has(c.id) ? (
                      <Badge variant="info">enrolled</Badge>
                    ) : (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={run.isPending}
                        onClick={() => {
                          run.mutate(() => api.post(`/learning/courses/${c.id}/enroll`, {}));
                        }}
                      >
                        Enrol
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {paths.data?.length ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Learning paths</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {paths.data.map((p) => (
              <p key={p.id}>
                <strong>{p.name}</strong>: {p.courses.map((c) => c.title).join(' → ')}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </Page>
  );
}

// ------------------------------------------------------------------------------ one course

function Quiz({
  module,
  enrollmentId,
  passPercent,
}: {
  module: CourseModuleItem;
  enrollmentId: string;
  passPercent: number;
}) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [result, setResult] = useState<QuizResultItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useMutation({
    mutationFn: () =>
      api.post<QuizResultItem>(`/me/learning/${enrollmentId}/quizzes/${module.id}`, { answers }),
    onSuccess: async (r) => {
      setResult(r);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: TALENT });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const toggle = (qid: string, i: number, on: boolean) => {
    const cur = answers[qid] ?? [];
    setAnswers({ ...answers, [qid]: on ? [...cur, i] : cur.filter((x) => x !== i) });
  };
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      {result ? (
        <Alert tone={result.passed ? 'success' : 'warning'}>
          Score {result.scorePercent}% —{' '}
          {result.passed
            ? 'passed'
            : `not passed (pass mark ${String(passPercent)}%); you can try again`}
          .
        </Alert>
      ) : null}
      {module.questions.map((q, n) => (
        <fieldset key={q.id} className="flex flex-col gap-1 text-sm">
          <legend className="font-medium">
            {n + 1}. {q.text}
            {result ? (result.perQuestion.find((x) => x.id === q.id)?.correct ? ' ✓' : ' ✗') : ''}
          </legend>
          {q.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2">
              <Checkbox
                checked={(answers[q.id] ?? []).includes(i)}
                onCheckedChange={(c) => {
                  toggle(q.id, i, c === true);
                }}
              />{' '}
              {o}
            </label>
          ))}
        </fieldset>
      ))}
      <div>
        <Button
          size="sm"
          disabled={attempt.isPending}
          onClick={() => {
            attempt.mutate();
          }}
        >
          Submit answers
        </Button>
      </div>
    </div>
  );
}

export function CoursePage() {
  const { id = '' } = useParams<{ id: string }>();
  const course = useCourse(id);
  const manage = usePermission(P.LEARNING_COURSE_MANAGE);
  const { error, run } = useAct();
  const [feedback, setFeedback] = useState(false);
  if (course.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (course.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(course.error)} />
      </Page>
    );
  const c = course.data;
  const e = c.myEnrollment && c.myEnrollment.status !== 'WITHDRAWN' ? c.myEnrollment : null;
  const active = e && e.status !== 'COMPLETED';
  return (
    <Page>
      <PageHeader
        title={c.title}
        description={`${c.code} · ${label(c.format)}${c.passPercent ? ` · pass mark ${String(c.passPercent)}%` : ''}${c.certificationValidityMonths ? ` · certification valid ${String(c.certificationValidityMonths)} months` : ''}`}
        actions={
          <>
            <Status s={e?.status ?? c.status} />
            {!e && c.status === 'PUBLISHED' ? (
              <Button
                size="sm"
                onClick={() => {
                  run.mutate(() => api.post(`/learning/courses/${c.id}/enroll`, {}));
                }}
              >
                Enrol
              </Button>
            ) : null}
            {e?.status === 'COMPLETED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFeedback(true);
                }}
              >
                Rate this course
              </Button>
            ) : null}
            {active ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  run.mutate(() => api.post(`/me/learning/${e.id}/withdraw`, {}));
                }}
              >
                Withdraw
              </Button>
            ) : null}
            {manage && c.status !== 'PUBLISHED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  run.mutate(() => api.patch(`/learning/courses/${c.id}`, { status: 'PUBLISHED' }));
                }}
              >
                Publish
              </Button>
            ) : null}
            {manage && c.status === 'PUBLISHED' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  run.mutate(() => api.patch(`/learning/courses/${c.id}`, { status: 'ARCHIVED' }));
                }}
              >
                Archive
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
      {c.description ? <p className="mb-4 text-sm text-muted-foreground">{c.description}</p> : null}
      {e ? (
        <div className="mb-4 w-64">
          <Bar value={e.progress} />
          <span className="text-xs text-muted-foreground">
            {e.progress}% complete{e.scorePercent ? ` · best score ${e.scorePercent}%` : ''}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {c.modules.map((m, i) => {
          const done = e?.completedModules.includes(m.id) ?? false;
          return (
            <Card key={m.id}>
              <CardHeader>
                <CardTitle>
                  {i + 1}. {m.title}
                </CardTitle>
                <Badge variant={done ? 'success' : 'neutral'}>
                  {done ? 'done' : m.type === 'QUIZ' ? 'quiz' : 'content'}
                </Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {m.content ? <p className="whitespace-pre-wrap">{m.content}</p> : null}
                {m.url ? (
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    Open material
                  </a>
                ) : null}
                {m.type === 'CONTENT' && active && !done ? (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        run.mutate(() =>
                          api.post(`/me/learning/${e.id}/modules/${m.id}/complete`, {}),
                        );
                      }}
                    >
                      Mark as done
                    </Button>
                  </div>
                ) : null}
                {m.type === 'QUIZ' && active && !done ? (
                  <Quiz module={m} enrollmentId={e.id} passPercent={c.passPercent} />
                ) : null}
                {m.type === 'QUIZ' && manage && !e ? (
                  <ol className="list-decimal pl-5 text-muted-foreground">
                    {m.questions.map((q) => (
                      <li key={q.id}>
                        {q.text} — {(q.correct ?? []).map((x) => q.options[x]).join(', ')}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Dialog open={feedback} onOpenChange={setFeedback}>
        <DialogContent>
          <DialogHeader title="Course feedback" />
          {e ? (
            <ResourceForm
              fields={[
                {
                  name: 'rating',
                  label: 'Rating',
                  kind: 'select',
                  required: true,
                  placeholder: 'Select…',
                  options: ['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: `${v} / 5` })),
                },
                { name: 'comment', label: 'Comment', kind: 'textarea' },
              ]}
              defaultValues={{ rating: '', comment: '' }}
              schema={courseFeedbackSchema}
              submit={(body) => api.post(`/me/learning/${e.id}/feedback`, body)}
              invalidate={[TALENT]}
              submitLabel="Send"
              onDone={() => {
                setFeedback(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ admin

interface DraftQuestion {
  id: string;
  text: string;
  options: string[];
  correct: number[];
}
interface DraftModule {
  key: string;
  title: string;
  type: 'CONTENT' | 'QUIZ';
  content: string;
  url: string;
  questions: DraftQuestion[];
}

function CourseEditor({ onDone }: { onDone: () => void }) {
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    code: '',
    title: '',
    description: '',
    format: 'ONLINE',
    durationMinutes: '',
    passPercent: '0',
    certificationValidityMonths: '',
    skills: '',
  });
  const [modules, setModules] = useState<DraftModule[]>([
    { key: uid(), title: '', type: 'CONTENT', content: '', url: '', questions: [] },
  ]);
  const setModule = (i: number, patch: Partial<DraftModule>) => {
    setModules(modules.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };
  const setQuestion = (i: number, qi: number, patch: Partial<DraftQuestion>) => {
    const m = modules[i];
    if (m)
      setModule(i, { questions: m.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) });
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Code" required>
            <Input
              value={v.code}
              onChange={(e) => {
                setV({ ...v, code: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Title" required>
            <Input
              value={v.title}
              onChange={(e) => {
                setV({ ...v, title: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Format" required>
            <Select
              value={v.format}
              onChange={(e) => {
                setV({ ...v, format: e.target.value });
              }}
              options={['ONLINE', 'VIDEO', 'DOCUMENT', 'CLASSROOM', 'EXTERNAL'].map((f) => ({
                value: f,
                label: label(f),
              }))}
            />
          </FormField>
          <FormField label="Duration (minutes)">
            <Input
              value={v.durationMinutes}
              onChange={(e) => {
                setV({ ...v, durationMinutes: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Pass mark (%)" description="Quizzes must reach this score.">
            <Input
              value={v.passPercent}
              onChange={(e) => {
                setV({ ...v, passPercent: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Certification valid (months)" description="Blank: no certification.">
            <Input
              value={v.certificationValidityMonths}
              onChange={(e) => {
                setV({ ...v, certificationValidityMonths: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Skills (comma separated)">
            <Input
              value={v.skills}
              onChange={(e) => {
                setV({ ...v, skills: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <FormField label="Description">
          <Textarea
            value={v.description}
            onChange={(e) => {
              setV({ ...v, description: e.target.value });
            }}
          />
        </FormField>
        {modules.map((m, i) => (
          <fieldset key={m.key} className="flex flex-col gap-2 rounded border border-border p-3">
            <legend className="px-1 text-sm font-medium">Module {i + 1}</legend>
            <div className="flex gap-2">
              <Input
                aria-label={`Module ${String(i + 1)} title`}
                placeholder="Title"
                value={m.title}
                onChange={(e) => {
                  setModule(i, { title: e.target.value });
                }}
              />
              <Select
                aria-label={`Module ${String(i + 1)} type`}
                className="w-36"
                value={m.type}
                onChange={(e) => {
                  setModule(i, { type: e.target.value as DraftModule['type'] });
                }}
                options={[
                  { value: 'CONTENT', label: 'Content' },
                  { value: 'QUIZ', label: 'Quiz' },
                ]}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove module ${String(i + 1)}`}
                disabled={modules.length <= 1}
                onClick={() => {
                  setModules(modules.filter((_, j) => j !== i));
                }}
              >
                <X />
              </Button>
            </div>
            {m.type === 'CONTENT' ? (
              <>
                <Textarea
                  aria-label={`Module ${String(i + 1)} content`}
                  placeholder="Content"
                  value={m.content}
                  onChange={(e) => {
                    setModule(i, { content: e.target.value });
                  }}
                />
                <Input
                  aria-label={`Module ${String(i + 1)} link`}
                  placeholder="Link (https://…)"
                  value={m.url}
                  onChange={(e) => {
                    setModule(i, { url: e.target.value });
                  }}
                />
              </>
            ) : (
              <>
                {m.questions.map((q, qi) => (
                  <div key={q.id} className="flex flex-col gap-1 border-l border-border pl-3">
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Question ${String(qi + 1)}`}
                        placeholder="Question"
                        value={q.text}
                        onChange={(e) => {
                          setQuestion(i, qi, { text: e.target.value });
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove question ${String(qi + 1)}`}
                        onClick={() => {
                          setModule(i, { questions: m.questions.filter((_, j) => j !== qi) });
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <Checkbox
                          aria-label={`Option ${String(oi + 1)} is correct`}
                          checked={q.correct.includes(oi)}
                          onCheckedChange={(c) => {
                            setQuestion(i, qi, {
                              correct:
                                c === true ? [...q.correct, oi] : q.correct.filter((x) => x !== oi),
                            });
                          }}
                        />
                        <Input
                          aria-label={`Option ${String(oi + 1)}`}
                          placeholder={`Option ${String(oi + 1)}`}
                          value={o}
                          onChange={(e) => {
                            setQuestion(i, qi, {
                              options: q.options.map((x, j) => (j === oi ? e.target.value : x)),
                            });
                          }}
                        />
                      </div>
                    ))}
                    <div>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setQuestion(i, qi, { options: [...q.options, ''] });
                        }}
                      >
                        <Plus /> Option
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setModule(i, {
                        questions: [
                          ...m.questions,
                          { id: `q${uid()}`, text: '', options: ['', ''], correct: [] },
                        ],
                      });
                    }}
                  >
                    <Plus /> Question
                  </Button>
                </div>
              </>
            )}
          </fieldset>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setModules([
                ...modules,
                { key: uid(), title: '', type: 'CONTENT', content: '', url: '', questions: [] },
              ]);
            }}
          >
            <Plus /> Add module
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
              code: v.code,
              title: v.title,
              description: v.description || null,
              format: v.format,
              durationMinutes: v.durationMinutes || null,
              passPercent: v.passPercent || '0',
              certificationValidityMonths: v.certificationValidityMonths || null,
              skills: v.skills
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              modules: modules.map((m) => ({
                title: m.title,
                type: m.type,
                content: m.type === 'CONTENT' ? m.content || null : null,
                url: m.type === 'CONTENT' ? m.url : '',
                questions: m.type === 'QUIZ' ? m.questions : [],
              })),
            };
            const parsed = courseSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the course');
              return;
            }
            run.mutate(() => api.post('/learning/courses', body), { onSuccess: onDone });
          }}
        >
          Save as draft
        </Button>
      </DialogFooter>
    </>
  );
}

function AssignForm({ onDone }: { onDone: () => void }) {
  const courses = useCourses();
  const paths = usePaths();
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const departments = useRefOptions({ path: '/departments' });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    target: 'course',
    courseId: '',
    pathId: '',
    departmentId: '',
    dueOn: '',
  });
  const [people, setPeople] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const name = (id: string) => employees.data?.find((e) => e.value === id)?.label ?? id;
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Assign">
            <Select
              value={v.target}
              onChange={(e) => {
                setV({ ...v, target: e.target.value });
              }}
              options={[
                { value: 'course', label: 'A course' },
                { value: 'path', label: 'A learning path' },
              ]}
            />
          </FormField>
          {v.target === 'course' ? (
            <FormField label="Course" required>
              <Select
                value={v.courseId}
                placeholder="Select…"
                onChange={(e) => {
                  setV({ ...v, courseId: e.target.value });
                }}
                options={(courses.data ?? [])
                  .filter((c) => c.status === 'PUBLISHED')
                  .map((c) => ({ value: c.id, label: `${c.title} (${c.code})` }))}
              />
            </FormField>
          ) : (
            <FormField label="Learning path" required>
              <Select
                value={v.pathId}
                placeholder="Select…"
                onChange={(e) => {
                  setV({ ...v, pathId: e.target.value });
                }}
                options={(paths.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </FormField>
          )}
          <FormField label="Whole department" description="Or pick people below.">
            <Select
              value={v.departmentId}
              placeholder="—"
              onChange={(e) => {
                setV({ ...v, departmentId: e.target.value });
              }}
              options={departments.data ?? []}
            />
          </FormField>
          <FormField label="Due">
            <Input
              type="date"
              value={v.dueOn}
              onChange={(e) => {
                setV({ ...v, dueOn: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <div className="flex gap-2">
          <Select
            aria-label="Employee"
            value={pick}
            placeholder="Add an employee…"
            options={(employees.data ?? []).filter((e) => !people.includes(e.value))}
            onChange={(e) => {
              setPick(e.target.value);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!pick}
            onClick={() => {
              setPeople([...people, pick]);
              setPick('');
            }}
          >
            Add
          </Button>
        </div>
        <ul className="flex flex-wrap gap-1" aria-label="Chosen employees">
          {people.map((p) => (
            <li key={p}>
              <Badge variant="neutral">
                {name(p)}{' '}
                <button
                  type="button"
                  aria-label={`Remove ${name(p)}`}
                  onClick={() => {
                    setPeople(people.filter((x) => x !== p));
                  }}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const body = {
              courseId: v.target === 'course' ? v.courseId || null : null,
              pathId: v.target === 'path' ? v.pathId || null : null,
              employeeIds: people,
              audience: { companyId: null, departmentId: v.departmentId || null },
              dueOn: v.dueOn || null,
            };
            const parsed = learningAssignmentSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the assignment');
              return;
            }
            run.mutate(() => api.post('/learning/assignments', body), { onSuccess: onDone });
          }}
        >
          Assign
        </Button>
      </DialogFooter>
    </>
  );
}

function PathForm({ onDone }: { onDone: () => void }) {
  const courses = useCourses();
  const [chosen, setChosen] = useState<string[]>([]);
  const published = (courses.data ?? []).filter((c) => c.status === 'PUBLISHED');
  return (
    <>
      <ResourceForm
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'description', label: 'Description', kind: 'textarea' },
        ]}
        defaultValues={{ name: '', description: '' }}
        schema={learningPathSchema}
        extra={{ courseIds: chosen }}
        submit={(body) => api.post('/learning/paths', body)}
        invalidate={[TALENT]}
        submitLabel="Save path"
        onDone={onDone}
      />
      <fieldset className="flex flex-col gap-1 px-6 pb-4 text-sm">
        <legend className="font-medium">Courses, in order</legend>
        {published.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <Checkbox
              checked={chosen.includes(c.id)}
              onCheckedChange={(on) => {
                setChosen(on === true ? [...chosen, c.id] : chosen.filter((x) => x !== c.id));
              }}
            />
            {chosen.includes(c.id) ? `${String(chosen.indexOf(c.id) + 1)}. ` : ''}
            {c.title}
          </label>
        ))}
      </fieldset>
    </>
  );
}

export function LearningAdminPage() {
  const manageCourses = usePermission(P.LEARNING_COURSE_MANAGE);
  const courses = useCourses();
  const paths = usePaths();
  const [tab, setTab] = useState('courses');
  const [status, setStatus] = useState('');
  const enrollments = useEnrollments({ status: status || undefined });
  const [days, setDays] = useState(60);
  const matrix = useSkillMatrix(days);
  const [dialog, setDialog] = useState<'course' | 'path' | 'assign' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Learning"
        description="Courses, learning paths, assignments, completions and the skills they build."
        actions={
          <>
            {manageCourses ? (
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('path');
                }}
              >
                <Plus /> Path
              </Button>
            ) : null}
            {manageCourses ? (
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('course');
                }}
              >
                <Plus /> Course
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setDialog('assign');
              }}
            >
              Assign training
            </Button>
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Learning views">
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="enrollments">Enrollments</TabsTrigger>
          <TabsTrigger value="skills">Skills & certifications</TabsTrigger>
        </TabsList>
        <TabsContent value="courses">
          {!courses.data?.length ? (
            <EmptyState title="No courses yet" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border text-sm" aria-label="Courses">
                  {courses.data.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                      <Link
                        to={`/learning/courses/${c.id}`}
                        className="min-w-0 flex-1 text-primary hover:underline"
                      >
                        {c.title} <span className="font-mono text-muted-foreground">{c.code}</span>
                      </Link>
                      <span className="text-muted-foreground">
                        {c.moduleCount} modules · {c.enrolled} enrolled · {c.completed} completed
                      </span>
                      <Status s={c.status} />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {paths.data?.length ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Learning paths</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {paths.data.map((p) => (
                  <p key={p.id}>
                    <strong>{p.name}</strong>: {p.courses.map((c) => c.title).join(' → ')}
                  </p>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="enrollments">
          <div className="mb-3 w-48">
            <Select
              aria-label="Status"
              value={status}
              placeholder="All statuses"
              onChange={(e) => {
                setStatus(e.target.value);
              }}
              options={['ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'WITHDRAWN'].map((s) => ({
                value: s,
                label: label(s),
              }))}
            />
          </div>
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border" aria-label="Enrollments">
                {(enrollments.data ?? []).map((e) => (
                  <li key={e.id} className="flex flex-col">
                    <span className="px-4 pt-2 text-sm font-medium">{e.employee.displayName}</span>
                    <ul>
                      <EnrollmentRow e={e} />
                    </ul>
                  </li>
                ))}
                {enrollments.data?.length === 0 ? (
                  <li className="p-4 text-sm text-muted-foreground">No enrollments.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="skills">
          {matrix.data ? (
            <div className="flex flex-col gap-4">
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <table className="w-full text-sm" aria-label="Skill matrix">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 font-normal">Employee</th>
                        {matrix.data.skills.map((s) => (
                          <th key={s} className="px-4 py-2 font-normal">
                            {s}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.data.rows.map((r) => (
                        <tr key={r.employee.id} className="border-t border-border">
                          <td className="px-4 py-2">{r.employee.displayName}</td>
                          {matrix.data.skills.map((s) => (
                            <td key={s} className="px-4 py-2">
                              {r.levels[s] ? label(r.levels[s]) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!matrix.data.rows.length ? (
                    <p className="p-4 text-sm text-muted-foreground">No skills recorded yet.</p>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Certifications expiring</CardTitle>
                  <Select
                    aria-label="Window"
                    className="ml-auto w-40"
                    value={String(days)}
                    onChange={(e) => {
                      setDays(Number(e.target.value));
                    }}
                    options={[30, 60, 90, 180].map((d) => ({
                      value: String(d),
                      label: `next ${String(d)} days`,
                    }))}
                  />
                </CardHeader>
                <CardContent
                  className="flex flex-col gap-1 text-sm"
                  aria-label="Expiring certifications"
                >
                  {matrix.data.expiringCertifications.map((x, i) => (
                    <p key={i}>
                      {x.employee.displayName} · {x.name} · {x.expiresOn}
                    </p>
                  ))}
                  {!matrix.data.expiringCertifications.length ? (
                    <p className="text-muted-foreground">None.</p>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Skeleton className="h-32" />
          )}
        </TabsContent>
      </Tabs>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size={dialog === 'course' || dialog === 'assign' ? 'lg' : undefined}>
          {dialog === 'course' ? (
            <>
              <DialogHeader
                title="New course"
                description="Saved as a draft; publish it from the course page."
              />
              <CourseEditor
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'path' ? (
            <>
              <DialogHeader title="New learning path" />
              <PathForm
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'assign' ? (
            <>
              <DialogHeader
                title="Assign training"
                description="HR can assign to anyone; managers to their direct reports."
              />
              <AssignForm
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
