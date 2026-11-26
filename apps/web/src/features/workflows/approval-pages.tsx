import type { WorkflowProcessValue } from '@hrm/shared-types';
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
  FormGrid,
  Input,
  Select,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { delegationSchema, workflowDefinitionSchema } from '@hrm/validation';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { useRoles } from '@/features/members/api';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import { api } from '@/lib/api';
import {
  label,
  MEASURE_LABEL,
  PROCESS_LABEL,
  useAct,
  useDefinitions,
  useDelegations,
  useHistory,
  useInbox,
} from './workflows-api';

const PROCESSES = Object.keys(PROCESS_LABEL) as WorkflowProcessValue[];
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const STATUS_VARIANT: Record<string, 'neutral' | 'warning' | 'success' | 'destructive' | 'info'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  SKIPPED: 'neutral',
  CANCELLED: 'neutral',
  WAITING: 'neutral',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={STATUS_VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);

// ------------------------------------------------------------------------------ inbox

function Delegations() {
  const delegations = useDelegations();
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({ delegateEmployeeId: '', from: '', to: '', note: '' });
  const [processes, setProcesses] = useState<WorkflowProcessValue[]>([]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delegate my approvals</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={3}>
          <FormField label="Delegate" required>
            <Select
              value={v.delegateEmployeeId}
              placeholder="Choose a colleague…"
              options={employees.data ?? []}
              onChange={(e) => {
                setV({ ...v, delegateEmployeeId: e.target.value });
              }}
            />
          </FormField>
          <FormField label="From" required>
            <Input
              type="date"
              value={v.from}
              onChange={(e) => {
                setV({ ...v, from: e.target.value });
              }}
            />
          </FormField>
          <FormField label="To" required>
            <Input
              type="date"
              value={v.to}
              onChange={(e) => {
                setV({ ...v, to: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <fieldset className="flex flex-wrap gap-3">
          <legend className="mb-1 text-xs text-muted-foreground">
            Only for (none ticked = all approvals)
          </legend>
          {PROCESSES.map((p) => (
            <label key={p} className="flex items-center gap-2">
              <Checkbox
                checked={processes.includes(p)}
                onCheckedChange={(c) => {
                  setProcesses(c === true ? [...processes, p] : processes.filter((x) => x !== p));
                }}
              />{' '}
              {PROCESS_LABEL[p]}
            </label>
          ))}
        </fieldset>
        <div>
          <Button
            size="sm"
            onClick={() => {
              const body = { ...v, processes, note: v.note || null };
              const parsed = delegationSchema.safeParse(body);
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Check the delegation');
                return;
              }
              run.mutate(() => api.post('/me/delegations', body), {
                onSuccess: () => {
                  setV({ delegateEmployeeId: '', from: '', to: '', note: '' });
                  setProcesses([]);
                },
              });
            }}
          >
            Delegate
          </Button>
        </div>
        <ul className="flex flex-col gap-1" aria-label="My delegations">
          {(delegations.data?.given ?? []).map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              To {d.delegate.displayName} · {d.from} → {d.to} ·{' '}
              {d.processes.length
                ? d.processes.map((p) => PROCESS_LABEL[p]).join(', ')
                : 'all approvals'}
              {d.active ? <Badge variant="info">in force</Badge> : null}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Revoke delegation to ${d.delegate.displayName}`}
                onClick={() => {
                  run.mutate(() => api.delete(`/me/delegations/${d.id}`));
                }}
              >
                <X />
              </Button>
            </li>
          ))}
          {(delegations.data?.received ?? []).map((d) => (
            <li key={d.id} className="text-muted-foreground">
              You act for {d.delegator.displayName} · {d.from} → {d.to}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ApprovalInboxPage() {
  const inbox = useInbox();
  const { error, run } = useAct();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Page>
      <PageHeader
        title="Approval inbox"
        description="Steps of approval workflows waiting for you, across leave, expenses, travel and timesheets."
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <div>
          {inbox.isPending ? (
            <Skeleton className="h-32" />
          ) : !inbox.data?.length ? (
            <EmptyState
              title="Nothing waiting for you"
              description="Requests that follow your organization's own rules appear on their usual approval pages."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <ul className="divide-y divide-border text-sm" aria-label="Approval tasks">
                  {inbox.data.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <Link to={t.link} className="font-medium text-primary hover:underline">
                          {t.summary}
                        </Link>
                        <span className="block text-muted-foreground">
                          {PROCESS_LABEL[t.process]} · {t.requester.displayName} · step{' '}
                          {t.stepNumber} of {t.stepCount}: {t.stepName}
                          {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleString()}` : ''}
                        </span>
                      </span>
                      {t.overdue ? <Badge variant="destructive">overdue</Badge> : null}
                      {t.onBehalfOf ? (
                        <Badge variant="info">for {t.onBehalfOf.displayName}</Badge>
                      ) : null}
                      {t.escalatedFrom ? (
                        <Badge variant="warning">
                          escalated from {t.escalatedFrom.displayName}
                        </Badge>
                      ) : null}
                      <Button
                        size="sm"
                        disabled={run.isPending}
                        onClick={() => {
                          run.mutate(() =>
                            api.post(`/approvals/${t.id}/decision`, {
                              decision: 'APPROVED',
                              note: null,
                            }),
                          );
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRejecting(t.id);
                          setNote('');
                        }}
                      >
                        Reject
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
        <Delegations />
      </div>
      <Dialog
        open={rejecting !== null}
        onOpenChange={(o) => {
          if (!o) setRejecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title="Reject"
            description="The request is rejected; the requester sees your reason."
          />
          <DialogBody>
            <FormField label="Reason" required>
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejecting(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={!note.trim()}
              onClick={() => {
                run.mutate(
                  () =>
                    api.post(`/approvals/${rejecting ?? ''}/decision`, {
                      decision: 'REJECTED',
                      note,
                    }),
                  {
                    onSuccess: () => {
                      setRejecting(null);
                    },
                  },
                );
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** Who approved what, step by step (shown on request pages). */
export function ApprovalTrail({
  process,
  subjectId,
}: {
  process: WorkflowProcessValue;
  subjectId: string;
}) {
  const history = useHistory(process, subjectId);
  if (!history.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {history.data.map((h) => (
          <ol
            key={h.id}
            className="flex flex-col gap-1"
            aria-label={`Approval steps (${h.definitionName})`}
          >
            {h.steps.map((s) => (
              <li key={s.number} className="flex flex-wrap items-center gap-2">
                <Status s={s.status} />
                <span>
                  {s.number}. {s.name}
                  {s.decidedBy
                    ? ` — ${s.decidedBy}`
                    : s.assignees.length
                      ? ` — ${s.assignees.map((a) => a.displayName).join(', ')}`
                      : ''}
                  {s.onBehalfOf ? ` (for ${s.onBehalfOf.displayName})` : ''}
                  {s.skippedReason ? ` (${s.skippedReason})` : ''}
                  {s.note ? ` · “${s.note}”` : ''}
                </span>
              </li>
            ))}
          </ol>
        ))}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------------ designer

interface DraftStep {
  name: string;
  type: 'REPORTING_MANAGER' | 'MANAGER_LEVEL' | 'ROLE' | 'EMPLOYEE';
  level: string;
  roleKey: string;
  employeeId: string;
  minMeasure: string;
  slaHours: string;
  escalate: '' | 'NEXT_MANAGER' | 'EMPLOYEE';
  escalateEmployeeId: string;
}
const blankStep = (): DraftStep => ({
  name: '',
  type: 'REPORTING_MANAGER',
  level: '2',
  roleKey: '',
  employeeId: '',
  minMeasure: '',
  slaHours: '',
  escalate: '',
  escalateEmployeeId: '',
});

function DefinitionEditor({ onDone }: { onDone: () => void }) {
  const roles = useRoles();
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const { error, setError, run } = useAct();
  const [process, setProcess] = useState<WorkflowProcessValue>('LEAVE_REQUEST');
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([{ ...blankStep(), name: 'Reporting manager' }]);
  const set = (i: number, patch: Partial<DraftStep>) => {
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const body = () => ({
    process,
    name,
    steps: steps.map((s) => ({
      name: s.name,
      approver:
        s.type === 'MANAGER_LEVEL'
          ? { type: s.type, level: Number(s.level) }
          : s.type === 'ROLE'
            ? { type: s.type, roleKey: s.roleKey }
            : s.type === 'EMPLOYEE'
              ? { type: s.type, employeeId: s.employeeId }
              : { type: s.type },
      minMeasure: s.minMeasure || null,
      slaHours: s.slaHours ? Number(s.slaHours) : null,
      escalateTo:
        s.escalate === 'NEXT_MANAGER'
          ? { type: 'NEXT_MANAGER' }
          : s.escalate === 'EMPLOYEE'
            ? { type: 'EMPLOYEE', employeeId: s.escalateEmployeeId }
            : null,
    })),
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Process" required>
            <Select
              value={process}
              options={PROCESSES.map((p) => ({ value: p, label: PROCESS_LABEL[p] }))}
              onChange={(e) => {
                setProcess(e.target.value as WorkflowProcessValue);
              }}
            />
          </FormField>
          <FormField label="Name" required>
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </FormField>
        </FormGrid>
        {steps.map((s, i) => (
          <fieldset
            key={i}
            className="flex flex-col gap-2 rounded border border-border p-3"
            aria-label={`Step ${String(i + 1)}`}
          >
            <legend className="px-1 text-sm font-medium">Step {i + 1}</legend>
            <FormGrid columns={3}>
              <FormField label="Step name" required>
                <Input
                  value={s.name}
                  onChange={(e) => {
                    set(i, { name: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="Approver" required>
                <Select
                  value={s.type}
                  options={[
                    { value: 'REPORTING_MANAGER', label: 'Reporting manager' },
                    { value: 'MANAGER_LEVEL', label: 'Higher manager' },
                    { value: 'ROLE', label: 'Anyone with a role' },
                    { value: 'EMPLOYEE', label: 'A named person' },
                  ]}
                  onChange={(e) => {
                    set(i, { type: e.target.value as DraftStep['type'] });
                  }}
                />
              </FormField>
              {s.type === 'MANAGER_LEVEL' ? (
                <FormField label="Level" description="2 = the manager's manager">
                  <Select
                    value={s.level}
                    options={['2', '3', '4', '5', '6'].map((l) => ({
                      value: l,
                      label: `Level ${l}`,
                    }))}
                    onChange={(e) => {
                      set(i, { level: e.target.value });
                    }}
                  />
                </FormField>
              ) : s.type === 'ROLE' ? (
                <FormField label="Role" required>
                  <Select
                    value={s.roleKey}
                    placeholder="Select…"
                    options={(roles.data ?? [])
                      .filter((r) => r.key !== 'client')
                      .map((r) => ({ value: r.key, label: r.name }))}
                    onChange={(e) => {
                      set(i, { roleKey: e.target.value });
                    }}
                  />
                </FormField>
              ) : s.type === 'EMPLOYEE' ? (
                <FormField label="Person" required>
                  <Select
                    value={s.employeeId}
                    placeholder="Select…"
                    options={employees.data ?? []}
                    onChange={(e) => {
                      set(i, { employeeId: e.target.value });
                    }}
                  />
                </FormField>
              ) : (
                <span />
              )}
              <FormField
                label={`Only from (${MEASURE_LABEL[process]})`}
                description="Blank: always"
              >
                <Input
                  value={s.minMeasure}
                  onChange={(e) => {
                    set(i, { minMeasure: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="SLA (hours)" description="Blank: no deadline">
                <Input
                  value={s.slaHours}
                  onChange={(e) => {
                    set(i, { slaHours: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="When late, escalate to">
                <Select
                  value={s.escalate}
                  options={[
                    { value: '', label: 'Nobody' },
                    { value: 'NEXT_MANAGER', label: "The approver's manager" },
                    { value: 'EMPLOYEE', label: 'A named person' },
                  ]}
                  onChange={(e) => {
                    set(i, { escalate: e.target.value as DraftStep['escalate'] });
                  }}
                />
              </FormField>
              {s.escalate === 'EMPLOYEE' ? (
                <FormField label="Escalate to" required>
                  <Select
                    value={s.escalateEmployeeId}
                    placeholder="Select…"
                    options={employees.data ?? []}
                    onChange={(e) => {
                      set(i, { escalateEmployeeId: e.target.value });
                    }}
                  />
                </FormField>
              ) : null}
            </FormGrid>
            <div>
              <Button
                size="xs"
                variant="ghost"
                disabled={steps.length <= 1}
                onClick={() => {
                  setSteps(steps.filter((_, j) => j !== i));
                }}
              >
                <X /> Remove step
              </Button>
            </div>
          </fieldset>
        ))}
        <div>
          <Button
            size="sm"
            variant="outline"
            disabled={steps.length >= 10}
            onClick={() => {
              setSteps([...steps, blankStep()]);
            }}
          >
            <Plus /> Add step
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Steps whose approver is the requester, or that nobody can decide, are skipped and
          recorded. Escalation reassigns a late step; it never approves it.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const parsed = workflowDefinitionSchema.safeParse(body());
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the steps');
              return;
            }
            run.mutate(() => api.post('/workflows', body()), { onSuccess: onDone });
          }}
        >
          Save (inactive)
        </Button>
      </DialogFooter>
    </>
  );
}

export function WorkflowsPage() {
  const defs = useDefinitions();
  const { error, run } = useAct();
  const [creating, setCreating] = useState(false);
  const approverText = (a: NonNullable<typeof defs.data>[number]['steps'][number]['approver']) =>
    a.type === 'REPORTING_MANAGER'
      ? 'reporting manager'
      : a.type === 'MANAGER_LEVEL'
        ? `manager level ${String(a.level)}`
        : a.type === 'ROLE'
          ? `anyone with role ${a.roleKey}`
          : (a.employee?.displayName ?? 'a named person');
  return (
    <Page>
      <PageHeader
        title="Approval workflows"
        description="Your own approval chains. Without an active workflow, each request keeps its built-in rule (the reporting manager)."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New workflow
          </Button>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!defs.data?.length ? (
        <EmptyState title="No workflows yet" />
      ) : (
        <div className="flex flex-col gap-3" aria-label="Workflows">
          {defs.data.map((d) => (
            <Card key={d.id}>
              <CardHeader>
                <CardTitle>{d.name}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {PROCESS_LABEL[d.process]} · used {d.instances} times
                </span>
                <Status s={d.status} />
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    run.mutate(() =>
                      api.put(`/workflows/${d.id}/status`, {
                        status: d.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                      }),
                    );
                  }}
                >
                  {d.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </Button>
              </CardHeader>
              <CardContent>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                  {d.steps.map((s, i) => (
                    <li key={i}>
                      <strong>{s.name}</strong>: {approverText(s.approver)}
                      {s.minMeasure ? ` · from ${s.minMeasure} ${MEASURE_LABEL[d.process]}` : ''}
                      {s.slaHours ? ` · SLA ${String(s.slaHours)} h` : ''}
                      {s.escalateTo
                        ? ` · escalates to ${s.escalateTo.type === 'NEXT_MANAGER' ? "the approver's manager" : (s.escalateTo.employee?.displayName ?? 'a named person')}`
                        : ''}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader
            title="New approval workflow"
            description="Saved inactive; activating it replaces the active workflow of the same process. Running approvals keep their steps."
          />
          <DefinitionEditor
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}
