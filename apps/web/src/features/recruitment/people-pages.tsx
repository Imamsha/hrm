import type {
  InterviewItem,
  OnboardingPlanItem,
  OnboardingTaskItem,
  OnboardingTemplateItem,
} from '@hrm/shared-types';
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
} from '@hrm/ui-web';
import { feedbackSchema, onboardingTemplateSchema, startOnboardingSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  authorizedFetch,
  RECRUIT,
  STATUS_VARIANT,
  useMyInterviews,
  useMyOnboarding,
  useMyOnboardingTasks,
  usePlans,
  useTemplates,
} from './recruit-api';

const P = PERMISSIONS;

// ------------------------------------------------------------------------------ my interviews

const feedbackFields: FieldDef[] = [
  { name: 'rating', label: 'Rating (1–5)', kind: 'number', required: true },
  {
    name: 'recommendation',
    label: 'Recommendation',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'STRONG_YES', label: 'Strong yes' },
      { value: 'YES', label: 'Yes' },
      { value: 'NO', label: 'No' },
      { value: 'STRONG_NO', label: 'Strong no' },
    ],
  },
  { name: 'notes', label: 'Notes', kind: 'textarea', required: true },
];

export function MyInterviewsPage() {
  const interviews = useMyInterviews();
  const [feedbackFor, setFeedbackFor] = useState<InterviewItem | null>(null);
  return (
    <Page>
      <PageHeader
        title="My interviews"
        description="Interviews where you are on the panel. Your feedback is yours until you submit it."
      />
      {interviews.isPending ? (
        <Skeleton className="h-32" />
      ) : interviews.isError ? (
        <ErrorState description={errorMessage(interviews.error)} />
      ) : interviews.data.length === 0 ? (
        <EmptyState title="No interviews" />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="My interviews">
          {interviews.data.map((i) => (
            <li key={i.id}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    {i.candidate.displayName} · {i.roundName}
                  </CardTitle>
                  <Badge variant={STATUS_VARIANT[i.status] ?? 'neutral'}>
                    {i.status.toLowerCase()}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                  <span>
                    {i.opening.title} · {new Date(i.scheduledAt).toLocaleString()} ·{' '}
                    {i.durationMinutes} min · {i.mode.replace('_', ' ').toLowerCase()}
                  </span>
                  {i.locationOrLink ? (
                    <span className="text-muted-foreground">{i.locationOrLink}</span>
                  ) : null}
                  {i.status !== 'CANCELLED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => {
                        setFeedbackFor(i);
                      }}
                    >
                      {i.panel.some((p) => p.submittedAt && p.rating !== null)
                        ? 'Revise feedback'
                        : 'Give feedback'}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={feedbackFor !== null}
        onOpenChange={(o) => {
          if (!o) setFeedbackFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title="Interview feedback"
            description={
              feedbackFor
                ? `${feedbackFor.candidate.displayName} · ${feedbackFor.roundName}`
                : undefined
            }
          />
          {feedbackFor ? (
            <ResourceForm
              fields={feedbackFields}
              defaultValues={{ rating: '', recommendation: '', notes: '' }}
              schema={feedbackSchema}
              submit={(body) => api.post(`/me/interviews/${feedbackFor.id}/feedback`, body)}
              invalidate={[RECRUIT]}
              submitLabel="Submit feedback"
              onDone={() => {
                setFeedbackFor(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ onboarding

const ASSIGNEES = [
  { value: 'HR', label: 'HR' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'EMPLOYEE', label: 'New joiner' },
  { value: 'IT', label: 'IT' },
];
const DOCS = [
  { value: '', label: 'No document' },
  { value: 'IDENTITY', label: 'Identity proof' },
  { value: 'ADDRESS_PROOF', label: 'Address proof' },
  { value: 'EDUCATION', label: 'Education' },
  { value: 'EMPLOYMENT', label: 'Previous employment' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'LETTER', label: 'Letter' },
  { value: 'OTHER', label: 'Other' },
];

interface DraftTask {
  title: string;
  assignee: string;
  dueOffsetDays: string;
  documentCategory: string;
}

function TemplateForm({
  template,
  onDone,
}: {
  template: OnboardingTemplateItem | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [tasks, setTasks] = useState<DraftTask[]>(
    template?.tasks.map((t) => ({
      title: t.title,
      assignee: t.assignee,
      dueOffsetDays: String(t.dueOffsetDays),
      documentCategory: t.documentCategory ?? '',
    })) ?? [{ title: '', assignee: 'HR', dueOffsetDays: '0', documentCategory: '' }],
  );
  const [error, setError] = useState<string | null>(null);
  const body = {
    name,
    isDefault,
    tasks: tasks.map((t) => ({ ...t, dueOffsetDays: Number(t.dueOffsetDays) })),
  };
  const save = useMutation({
    mutationFn: () =>
      template
        ? api.patch(`/onboarding/templates/${template.id}`, body)
        : api.post('/onboarding/templates', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RECRUIT });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const set = (i: number, patch: Partial<DraftTask>) => {
    setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  };
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </FormField>
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => {
                setIsDefault(e.target.checked);
              }}
            />{' '}
            Default template
          </label>
        </FormGrid>
        <p className="text-sm text-muted-foreground">
          Due days are relative to the joining date (negative = before joining).
        </p>
        {tasks.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_8rem_5rem_10rem_auto] items-center gap-2">
            <Input
              aria-label={`Task ${String(i + 1)} title`}
              placeholder="Task"
              value={t.title}
              onChange={(e) => {
                set(i, { title: e.target.value });
              }}
            />
            <Select
              aria-label={`Task ${String(i + 1)} assignee`}
              value={t.assignee}
              onChange={(e) => {
                set(i, { assignee: e.target.value });
              }}
              options={ASSIGNEES}
            />
            <Input
              aria-label={`Task ${String(i + 1)} due day`}
              inputMode="numeric"
              value={t.dueOffsetDays}
              onChange={(e) => {
                set(i, { dueOffsetDays: e.target.value });
              }}
            />
            <Select
              aria-label={`Task ${String(i + 1)} document`}
              value={t.documentCategory}
              onChange={(e) => {
                set(i, { documentCategory: e.target.value });
              }}
              options={DOCS}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove task ${String(i + 1)}`}
              disabled={tasks.length === 1}
              onClick={() => {
                setTasks((ts) => ts.filter((_, j) => j !== i));
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
              setTasks((ts) => [
                ...ts,
                { title: '', assignee: 'HR', dueOffsetDays: '0', documentCategory: '' },
              ]);
            }}
          >
            <Plus /> Add task
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
            const parsed = onboardingTemplateSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues.map((x) => x.message).join('. '));
              return;
            }
            save.mutate();
          }}
        >
          Save template
        </Button>
      </DialogFooter>
    </>
  );
}

function TaskRow({
  task,
  onStatus,
  onUpload,
  selfView,
}: {
  task: OnboardingTaskItem;
  onStatus: (s: string) => void;
  onUpload?: (f: File) => void;
  selfView?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{task.title}</p>
        <p className="text-muted-foreground">
          {ASSIGNEES.find((a) => a.value === task.assignee)?.label}
          {task.assigneeEmployee ? ` · ${task.assigneeEmployee.displayName}` : ''} · due{' '}
          {task.dueDate}
          {task.documentCategory
            ? ` · needs ${DOCS.find((d) => d.value === task.documentCategory)?.label.toLowerCase() ?? 'a document'}`
            : ''}
          {task.completedBy ? ` · ${task.status.toLowerCase()} by ${task.completedBy}` : ''}
        </p>
      </div>
      <Badge variant={STATUS_VARIANT[task.status] ?? 'neutral'}>{task.status.toLowerCase()}</Badge>
      {task.canComplete && task.status === 'PENDING' ? (
        selfView && task.documentCategory && onUpload ? (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-sm hover:bg-accent">
            <Upload className="size-4" /> Upload
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }}
            />
          </label>
        ) : (
          <Button
            size="xs"
            onClick={() => {
              onStatus('DONE');
            }}
          >
            Mark done
          </Button>
        )
      ) : null}
      {task.canComplete && task.status !== 'PENDING' && !selfView ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            onStatus('PENDING');
          }}
        >
          Reopen
        </Button>
      ) : null}
    </li>
  );
}

function PlanCard({ plan, selfView }: { plan: OnboardingPlanItem; selfView?: boolean }) {
  const queryClient = useQueryClient();
  const canManage = usePermission(P.ONBOARDING_PLAN_MANAGE);
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: RECRUIT });
  };
  const status = useMutation({
    mutationFn: (a: { id: string; status: string }) =>
      api.put(`/onboarding/tasks/${a.id}/status`, { status: a.status }),
    onSuccess: done,
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const upload = useMutation({
    mutationFn: (a: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', a.file);
      return authorizedFetch(`/me/onboarding/tasks/${a.id}/document`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: done,
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {plan.employee.displayName} · joins {plan.joiningDate}
        </CardTitle>
        <span className="text-sm text-muted-foreground">
          {plan.progress.closed}/{plan.progress.total} done ({plan.progress.percent}%)
        </span>
        <Badge variant={STATUS_VARIANT[plan.status] ?? 'neutral'}>
          {plan.status.replace('_', ' ').toLowerCase()}
        </Badge>
        {canManage && plan.status === 'IN_PROGRESS' && !selfView ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void api.post(`/onboarding/plans/${plan.id}/cancel`).then(done)}
          >
            Cancel plan
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <div className="h-1.5 bg-muted" aria-hidden>
          <div
            className="h-1.5 bg-success"
            style={{ width: `${String(plan.progress.percent)}%` }}
          />
        </div>
        <ul className="divide-y divide-border" aria-label="Onboarding tasks">
          {plan.tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              selfView={selfView ?? false}
              onStatus={(s) => {
                status.mutate({ id: t.id, status: s });
              }}
              onUpload={(file) => {
                upload.mutate({ id: t.id, file });
              }}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const startFields: FieldDef[] = [
  {
    name: 'employeeId',
    label: 'Employee',
    kind: 'ref',
    required: true,
    ref: {
      path: '/employees',
      label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
    },
    refParams: { status: 'ACTIVE' },
    wide: true,
  },
  {
    name: 'templateId',
    label: 'Template',
    kind: 'ref',
    required: true,
    ref: { path: '/onboarding/templates', paged: false },
  },
];

export function OnboardingPage() {
  const canTemplates = usePermission(P.ONBOARDING_TEMPLATE_MANAGE);
  const canManage = usePermission(P.ONBOARDING_PLAN_MANAGE);
  const [status, setStatus] = useState('IN_PROGRESS');
  const plans = usePlans(status || undefined);
  const templates = useTemplates();
  const [dialog, setDialog] = useState<OnboardingTemplateItem | 'new' | 'start' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Onboarding"
        description="Joining checklists for HR, IT, managers and new joiners."
        actions={
          <>
            {canTemplates ? (
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('new');
                }}
              >
                <Plus /> New template
              </Button>
            ) : null}
            {canManage ? (
              <Button
                onClick={() => {
                  setDialog('start');
                }}
              >
                <ClipboardCheck /> Start onboarding
              </Button>
            ) : null}
          </>
        }
      />
      {templates.data?.length ? (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="Templates">
          {templates.data.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              disabled={!canTemplates}
              onClick={() => {
                setDialog(t);
              }}
            >
              {t.name} · {t.tasks.length} tasks{t.isDefault ? ' · default' : ''}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="mb-3">
        <Select
          aria-label="Filter by status"
          className="h-7 w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
          }}
          options={[
            { value: 'IN_PROGRESS', label: 'In progress' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'CANCELLED', label: 'Cancelled' },
            { value: '', label: 'All' },
          ]}
        />
      </div>
      {plans.isPending ? (
        <Skeleton className="h-32" />
      ) : plans.isError ? (
        <ErrorState description={errorMessage(plans.error)} />
      ) : plans.data.length === 0 ? (
        <EmptyState
          title="No onboarding plans"
          description="Plans start when you hire a candidate or start one here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {plans.data.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size="lg">
          {dialog === 'start' ? (
            <>
              <DialogHeader title="Start onboarding" />
              <ResourceForm
                fields={startFields}
                defaultValues={{
                  employeeId: '',
                  templateId: templates.data?.find((t) => t.isDefault)?.id ?? '',
                }}
                schema={startOnboardingSchema}
                submit={(body) => api.post('/onboarding/plans', body)}
                invalidate={[RECRUIT]}
                submitLabel="Start"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog ? (
            <>
              <DialogHeader
                title={dialog === 'new' ? 'New onboarding template' : `Edit ${dialog.name}`}
              />
              <TemplateForm
                template={dialog === 'new' ? null : dialog}
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

/** The joiner's checklist plus tasks assigned to the caller (e.g. as a manager). */
export function MyOnboardingPage() {
  const plan = useMyOnboarding();
  const tasks = useMyOnboardingTasks();
  const queryClient = useQueryClient();
  const status = useMutation({
    mutationFn: (a: { id: string; status: string }) =>
      api.put(`/onboarding/tasks/${a.id}/status`, { status: a.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECRUIT }),
  });
  const others = (tasks.data ?? []).filter((t) => t.planId !== plan.data?.id);
  return (
    <Page>
      <PageHeader
        title="My onboarding"
        description="Your joining checklist and onboarding tasks assigned to you."
      />
      <div className="flex flex-col gap-4">
        {plan.isPending ? (
          <Skeleton className="h-32" />
        ) : plan.data ? (
          <PlanCard plan={plan.data} selfView />
        ) : (
          <EmptyState title="No onboarding plan for you" />
        )}
        {others.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Tasks for your new team members</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border" aria-label="Assigned onboarding tasks">
                {others.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={{ ...t, title: `${t.employee}: ${t.title}` }}
                    onStatus={(s) => {
                      status.mutate({ id: t.id, status: s });
                    }}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
