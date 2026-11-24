import type { ProjectDetails, WorkItemItem, WorkItemTypeValue } from '@hrm/shared-types';
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
  DialogContent,
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
  boardColumnsSchema,
  projectMemberSchema,
  projectSchema,
  sprintSchema,
  updateProjectSchema,
  workItemSchema,
} from '@hrm/validation';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  PROJECTS,
  useAct,
  useBoard,
  useClients,
  useItem,
  useItems,
  useMyWork,
  useProject,
  useProjects,
  VARIANT,
} from './projects-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const PARENTS: Record<WorkItemTypeValue, WorkItemTypeValue[]> = {
  EPIC: [],
  FEATURE: ['EPIC'],
  STORY: ['EPIC', 'FEATURE'],
  TASK: ['STORY'],
  BUG: ['EPIC', 'FEATURE', 'STORY'],
  SUBTASK: ['STORY', 'TASK', 'BUG'],
};
const TYPES: WorkItemTypeValue[] = ['EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG', 'SUBTASK'];
const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'];

export function Bar({ value }: { value: string | number }) {
  const n = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="h-1.5 w-full rounded bg-muted" aria-hidden>
      <div className="h-1.5 rounded bg-primary" style={{ width: `${String(n)}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------------------ list

export function ProjectsPage() {
  const manage = usePermission(P.PROJECTS_PROJECT_MANAGE);
  const [mine, setMine] = useState(false);
  const projects = useProjects(mine ? { mine: true } : {});
  const clients = useClients();
  const [creating, setCreating] = useState(false);
  const fields: FieldDef[] = [
    {
      name: 'key',
      label: 'Key',
      required: true,
      description: 'Prefix of item numbers, e.g. WEB → WEB-1.',
    },
    { name: 'name', label: 'Name', required: true },
    {
      name: 'billingType',
      label: 'Billing',
      kind: 'select',
      required: true,
      options: [
        { value: 'TIME_AND_MATERIALS', label: 'Time & materials' },
        { value: 'FIXED_FEE', label: 'Fixed fee' },
        { value: 'NON_BILLABLE', label: 'Internal (non-billable)' },
      ],
    },
    {
      name: 'clientId',
      label: 'Client',
      kind: 'select',
      placeholder: 'Internal project',
      options: (clients.data ?? [])
        .filter((c) => c.status === 'ACTIVE')
        .map((c) => ({ value: c.id, label: `${c.name} (${c.code})` })),
    },
    {
      name: 'hourlyRate',
      label: 'Default hourly rate',
      description: 'Members can have their own rate.',
    },
    { name: 'budgetAmount', label: 'Budget amount' },
    { name: 'budgetHours', label: 'Budget hours' },
    { name: 'startDate', label: 'Start', kind: 'date' },
    { name: 'endDate', label: 'End', kind: 'date' },
    { name: 'portalEnabled', label: 'Show in the client portal', kind: 'checkbox' },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ];
  return (
    <Page>
      <PageHeader
        title="Projects"
        description="Client and internal projects, their work and progress."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={mine}
                onCheckedChange={(c) => {
                  setMine(c === true);
                }}
              />{' '}
              Only mine
            </label>
            {manage ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                <Plus /> New project
              </Button>
            ) : null}
          </>
        }
      />
      {projects.isPending ? (
        <Skeleton className="h-32" />
      ) : !projects.data?.length ? (
        <EmptyState
          title="No projects"
          description={manage ? 'Create the first project.' : 'You are not on any project yet.'}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Projects">
              {projects.data.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <Link
                      to={`/projects/${p.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>{' '}
                    <span className="font-mono text-muted-foreground">{p.key}</span>
                    <span className="block text-muted-foreground">
                      {p.client ? p.client.name : 'Internal'} · {label(p.billingType)}
                      {p.myRole ? ` · you: ${label(p.myRole)}` : ''}
                    </span>
                  </span>
                  <span className="w-32">
                    <Bar value={p.progress.percentDone} />
                    <span className="text-xs text-muted-foreground">
                      {p.progress.percentDone}% done
                    </span>
                  </span>
                  <Status s={p.status} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader
            title="New project"
            description="Starts with three board columns you can rename."
          />
          <ResourceForm
            fields={fields}
            defaultValues={{
              key: '',
              name: '',
              billingType: 'TIME_AND_MATERIALS',
              clientId: '',
              hourlyRate: '',
              budgetAmount: '',
              budgetHours: '',
              startDate: '',
              endDate: '',
              portalEnabled: 'false',
              description: '',
            }}
            schema={projectSchema}
            submit={(body) => api.post('/projects', body)}
            invalidate={[PROJECTS]}
            submitLabel="Create project"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ item form

function ItemDialog({
  project,
  open,
  onClose,
  defaults,
}: {
  project: ProjectDetails;
  open: boolean;
  onClose: () => void;
  defaults?: { type?: WorkItemTypeValue; parentId?: string; sprintId?: string };
}) {
  const items = useItems(project.id, {});
  const members = project.members.filter((m) => m.role !== 'VIEWER');
  const fields: FieldDef[] = [
    {
      name: 'type',
      label: 'Type',
      kind: 'select',
      required: true,
      options: TYPES.map((t) => ({ value: t, label: label(t) })),
    },
    { name: 'title', label: 'Title', required: true, wide: true },
    {
      name: 'parentId',
      label: 'Parent',
      kind: 'select',
      placeholder: 'No parent',
      options: (items.data ?? []).map((i) => ({
        value: i.id,
        label: `${i.key} ${i.title} (${label(i.type)})`,
      })),
      show: (v) =>
        ((PARENTS as Record<string, WorkItemTypeValue[] | undefined>)[v.type ?? '']?.length ?? 0) >
        0,
    },
    {
      name: 'assigneeId',
      label: 'Assignee',
      kind: 'select',
      placeholder: 'Unassigned',
      options: members.map((m) => ({ value: m.employee.id, label: m.employee.displayName })),
    },
    {
      name: 'priority',
      label: 'Priority',
      kind: 'select',
      required: true,
      options: PRIORITIES.map((p) => ({ value: p, label: label(p) })),
    },
    {
      name: 'sprintId',
      label: 'Sprint',
      kind: 'select',
      placeholder: 'Backlog',
      options: project.sprints
        .filter((s) => s.status !== 'COMPLETED')
        .map((s) => ({ value: s.id, label: s.name })),
    },
    { name: 'storyPoints', label: 'Story points' },
    { name: 'estimateHours', label: 'Estimate (hours)' },
    { name: 'dueDate', label: 'Due', kind: 'date' },
    {
      name: 'severity',
      label: 'Severity',
      kind: 'select',
      required: true,
      placeholder: 'Select…',
      options: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR'].map((s) => ({
        value: s,
        label: label(s),
      })),
      show: (v) => v.type === 'BUG',
    },
    {
      name: 'stepsToReproduce',
      label: 'Steps to reproduce',
      kind: 'textarea',
      show: (v) => v.type === 'BUG',
    },
    { name: 'environment', label: 'Environment', show: (v) => v.type === 'BUG' },
    { name: 'clientVisible', label: 'Visible to the client', kind: 'checkbox' },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ];
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader title="New work item" description={`${project.key} · ${project.name}`} />
        <ResourceForm
          fields={fields}
          defaultValues={{
            type: defaults?.type ?? 'STORY',
            title: '',
            parentId: defaults?.parentId ?? '',
            assigneeId: '',
            priority: 'MEDIUM',
            sprintId: defaults?.sprintId ?? '',
            storyPoints: '',
            estimateHours: '',
            dueDate: '',
            severity: '',
            stepsToReproduce: '',
            environment: '',
            clientVisible: 'false',
            description: '',
          }}
          schema={workItemSchema}
          submit={(body) => api.post(`/projects/${project.id}/items`, body)}
          invalidate={[PROJECTS]}
          submitLabel="Create"
          onDone={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------ board

function Card_({
  item,
  project,
  onMove,
}: {
  item: WorkItemItem;
  project: ProjectDetails;
  onMove: (columnId: string) => void;
}) {
  return (
    <li className="rounded-md border border-border bg-background p-2 text-sm shadow-sm">
      <Link
        to={`/projects/${project.id}/items/${item.id}`}
        className="font-medium text-primary hover:underline"
      >
        {item.key}
      </Link>{' '}
      {item.title}
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Badge variant={item.type === 'BUG' ? 'destructive' : 'neutral'}>{label(item.type)}</Badge>
        {item.priority !== 'MEDIUM' ? <Status s={item.priority} /> : null}
        {item.storyPoints ? <span>{item.storyPoints} pts</span> : null}
        <span className="ml-auto">{item.assignee?.displayName ?? 'Unassigned'}</span>
      </div>
      <Select
        aria-label={`Move ${item.key}`}
        className="mt-1 h-7 text-xs"
        value={item.column.id}
        options={project.columns.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(e) => {
          onMove(e.target.value);
        }}
      />
    </li>
  );
}

function Board({ project }: { project: ProjectDetails }) {
  const [sprintId, setSprintId] = useState('');
  const board = useBoard(project.id, sprintId || undefined);
  const { error, run } = useAct();
  const sprints = project.sprints.filter((s) => s.status !== 'COMPLETED');
  if (!board.data) return <Skeleton className="h-40" />;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select
          aria-label="Sprint"
          className="w-56"
          value={sprintId || board.data.sprint?.id || ''}
          placeholder="Backlog (no sprint)"
          options={sprints.map((s) => ({
            value: s.id,
            label: `${s.name}${s.status === 'ACTIVE' ? ' (active)' : ''}`,
          }))}
          onChange={(e) => {
            setSprintId(e.target.value);
          }}
        />
        {board.data.sprint ? (
          <span className="text-muted-foreground">
            {board.data.sprint.startDate} → {board.data.sprint.endDate}
            {board.data.sprint.goal ? ` · ${board.data.sprint.goal}` : ''}
          </span>
        ) : null}
      </div>
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${String(board.data.columns.length)}, minmax(14rem, 1fr))`,
        }}
      >
        {board.data.columns.map((c) => (
          <section
            key={c.id}
            className="rounded-lg bg-muted/50 p-2"
            aria-label={`Column ${c.name}`}
          >
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              {c.name}{' '}
              <span className="text-muted-foreground">
                {c.items.length}
                {c.wipLimit ? ` / ${String(c.wipLimit)}` : ''}
              </span>
            </h3>
            <ul className="flex flex-col gap-2">
              {c.items.map((i) => (
                <Card_
                  key={i.id}
                  item={i}
                  project={project}
                  onMove={(columnId) => {
                    run.mutate(() =>
                      api.patch(`/projects/${project.id}/items/${i.id}`, { columnId }),
                    );
                  }}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ backlog

function Backlog({ project, onNew }: { project: ProjectDetails; onNew: () => void }) {
  const [type, setType] = useState('');
  const items = useItems(project.id, type ? { type } : {});
  const { error, run } = useAct();
  const open = project.sprints.filter((s) => s.status !== 'COMPLETED');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Type"
          className="w-40"
          value={type}
          placeholder="All types"
          options={TYPES.map((t) => ({ value: t, label: label(t) }))}
          onChange={(e) => {
            setType(e.target.value);
          }}
        />
        {project.myRole !== 'VIEWER' ? (
          <Button size="sm" className="ml-auto" onClick={onNew}>
            <Plus /> New item
          </Button>
        ) : null}
      </div>
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" aria-label="Work items">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">Item</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Assignee</th>
                <th className="px-3 py-2 font-normal">Points</th>
                <th className="px-3 py-2 font-normal">Sprint</th>
              </tr>
            </thead>
            <tbody>
              {(items.data ?? []).map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <Link
                      to={`/projects/${project.id}/items/${i.id}`}
                      className="text-primary hover:underline"
                    >
                      {i.key}
                    </Link>{' '}
                    {i.title}{' '}
                    <span className="text-xs text-muted-foreground">
                      {label(i.type)}
                      {i.parent ? ` · in ${i.parent.key}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Status s={i.column.category} /> {i.column.name}
                  </td>
                  <td className="px-3 py-2">{i.assignee?.displayName ?? '—'}</td>
                  <td className="px-3 py-2">{i.storyPoints ?? '—'}</td>
                  <td className="px-3 py-2">
                    {i.type === 'EPIC' || i.type === 'FEATURE' ? (
                      '—'
                    ) : (
                      <Select
                        aria-label={`Sprint of ${i.key}`}
                        className="h-7 w-40 text-xs"
                        value={i.sprintId ?? ''}
                        placeholder="Backlog"
                        options={[
                          { value: '', label: 'Backlog' },
                          ...open.map((s) => ({ value: s.id, label: s.name })),
                        ]}
                        onChange={(e) => {
                          run.mutate(() =>
                            api.patch(`/projects/${project.id}/items/${i.id}`, {
                              sprintId: e.target.value || null,
                            }),
                          );
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {items.data?.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No work items yet.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------------ sprints

function Sprints({ project }: { project: ProjectDetails }) {
  const { error, run } = useAct();
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  return (
    <div className="flex flex-col gap-3">
      {project.canManage ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New sprint
          </Button>
        </div>
      ) : null}
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border text-sm" aria-label="Sprints">
            {project.sprints.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  <strong>{s.name}</strong> · {s.startDate} → {s.endDate} · {s.items} items ·{' '}
                  {s.points} pts
                  {s.status === 'COMPLETED'
                    ? ` · velocity ${s.completedPoints ?? '0'} of ${s.committedPoints ?? '0'}`
                    : ''}
                </span>
                <Status s={s.status} />
                {project.canManage && s.status === 'PLANNED' ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      run.mutate(() =>
                        api.post(`/projects/${project.id}/sprints/${s.id}/start`, {}),
                      );
                    }}
                  >
                    Start
                  </Button>
                ) : null}
                {project.canManage && s.status === 'ACTIVE' ? (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setCompleting(s.id);
                    }}
                  >
                    Complete
                  </Button>
                ) : null}
              </li>
            ))}
            {!project.sprints.length ? (
              <li className="p-4 text-muted-foreground">No sprints yet.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New sprint" />
          <ResourceForm
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'startDate', label: 'Start', kind: 'date', required: true },
              { name: 'endDate', label: 'End', kind: 'date', required: true },
              { name: 'goal', label: 'Goal', kind: 'textarea' },
            ]}
            defaultValues={{ name: '', startDate: '', endDate: '', goal: '' }}
            schema={sprintSchema}
            submit={(body) => api.post(`/projects/${project.id}/sprints`, body)}
            invalidate={[PROJECTS]}
            submitLabel="Create sprint"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={completing !== null}
        onOpenChange={(o) => {
          if (!o) setCompleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title="Complete sprint"
            description="Velocity is recorded; unfinished items move on."
          />
          <div className="flex flex-col gap-3 px-6 pb-6">
            <FormField label="Unfinished items go to">
              <Select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                }}
                options={[
                  { value: '', label: 'The backlog' },
                  ...project.sprints
                    .filter((s) => s.status === 'PLANNED')
                    .map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </FormField>
            <Button
              onClick={() => {
                const id = completing ?? '';
                run.mutate(
                  () =>
                    api.post(`/projects/${project.id}/sprints/${id}/complete`, {
                      moveToSprintId: target || null,
                    }),
                  {
                    onSuccess: () => {
                      setCompleting(null);
                    },
                  },
                );
              }}
            >
              Complete sprint
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------------------ members

function Members({ project }: { project: ProjectDetails }) {
  const { error, run } = useAct();
  const [adding, setAdding] = useState(false);
  const [rate, setRate] = useState<Record<string, string>>({});
  return (
    <div className="flex flex-col gap-3">
      {project.canManage ? (
        <div>
          <Button
            size="sm"
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus /> Add member
          </Button>
        </div>
      ) : null}
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border text-sm" aria-label="Members">
            {project.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1">
                  {m.employee.displayName}
                  {m.allocationPercent ? (
                    <span className="text-muted-foreground">
                      {' '}
                      · {m.allocationPercent}% allocated
                    </span>
                  ) : null}
                </span>
                {project.canManage ? (
                  <>
                    <Select
                      aria-label={`Role of ${m.employee.displayName}`}
                      className="h-8 w-32"
                      value={m.role}
                      options={['MANAGER', 'MEMBER', 'VIEWER'].map((r) => ({
                        value: r,
                        label: label(r),
                      }))}
                      onChange={(e) => {
                        run.mutate(() =>
                          api.patch(`/projects/${project.id}/members/${m.id}`, {
                            role: e.target.value,
                          }),
                        );
                      }}
                    />
                    <Input
                      aria-label={`Rate of ${m.employee.displayName}`}
                      className="h-8 w-28"
                      placeholder="Rate"
                      value={rate[m.id] ?? m.billingRate ?? ''}
                      onChange={(e) => {
                        setRate({ ...rate, [m.id]: e.target.value });
                      }}
                    />
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={rate[m.id] === undefined}
                      onClick={() => {
                        run.mutate(() =>
                          api.patch(`/projects/${project.id}/members/${m.id}`, {
                            billingRate: rate[m.id] ?? '',
                          }),
                        );
                      }}
                    >
                      Save rate
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${m.employee.displayName}`}
                      onClick={() => {
                        run.mutate(() => api.delete(`/projects/${project.id}/members/${m.id}`));
                      }}
                    >
                      <X />
                    </Button>
                  </>
                ) : (
                  <Badge variant="neutral">{label(m.role)}</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader title="Add member" />
          <ResourceForm
            fields={[
              {
                name: 'employeeId',
                label: 'Employee',
                kind: 'ref',
                required: true,
                ref: employeeRef,
                refParams: { status: 'ACTIVE' },
              },
              {
                name: 'role',
                label: 'Role',
                kind: 'select',
                required: true,
                options: [
                  { value: 'MEMBER', label: 'Member' },
                  { value: 'MANAGER', label: 'Project manager' },
                  { value: 'VIEWER', label: 'Viewer' },
                ],
              },
              {
                name: 'billingRate',
                label: 'Billing rate (hourly)',
                description: 'Blank: the project rate.',
              },
              { name: 'allocationPercent', label: 'Allocation (%)' },
            ]}
            defaultValues={{
              employeeId: '',
              role: 'MEMBER',
              billingRate: '',
              allocationPercent: '',
            }}
            schema={projectMemberSchema}
            submit={(body) => api.post(`/projects/${project.id}/members`, body)}
            invalidate={[PROJECTS]}
            submitLabel="Add"
            onDone={() => {
              setAdding(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------------------------ settings

function ColumnsEditor({ project }: { project: ProjectDetails }) {
  const { error, setError, run } = useAct();
  const [cols, setCols] = useState<
    {
      id?: string;
      name: string;
      category: ProjectDetails['columns'][number]['category'];
      wipLimit: string;
    }[]
  >(
    project.columns.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      wipLimit: c.wipLimit ? String(c.wipLimit) : '',
    })),
  );
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    const a = next[i];
    const b = next[j];
    if (!a || !b) return;
    next[i] = b;
    next[j] = a;
    setCols(next);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Board columns</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {cols.map((c, i) => (
          <div key={c.id ?? `new-${String(i)}`} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Column ${String(i + 1)} name`}
              className="w-48"
              value={c.name}
              onChange={(e) => {
                setCols(cols.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
              }}
            />
            <Select
              aria-label={`Column ${String(i + 1)} category`}
              className="w-36"
              value={c.category}
              options={[
                { value: 'TODO', label: 'To do' },
                { value: 'IN_PROGRESS', label: 'In progress' },
                { value: 'DONE', label: 'Done' },
              ]}
              onChange={(e) => {
                setCols(
                  cols.map((x, j) =>
                    j === i ? { ...x, category: e.target.value as typeof c.category } : x,
                  ),
                );
              }}
            />
            <Input
              aria-label={`Column ${String(i + 1)} WIP limit`}
              className="w-24"
              placeholder="WIP limit"
              value={c.wipLimit}
              onChange={(e) => {
                setCols(cols.map((x, j) => (j === i ? { ...x, wipLimit: e.target.value } : x)));
              }}
            />
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Move column ${String(i + 1)} left`}
              onClick={() => {
                move(i, -1);
              }}
            >
              ←
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-label={`Move column ${String(i + 1)} right`}
              onClick={() => {
                move(i, 1);
              }}
            >
              →
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove column ${String(i + 1)}`}
              onClick={() => {
                setCols(cols.filter((_, j) => j !== i));
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
              setCols([
                ...cols,
                { id: undefined, name: '', category: 'IN_PROGRESS', wipLimit: '' },
              ]);
            }}
          >
            <Plus /> Column
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const body = {
                columns: cols.map((c) => ({
                  ...(c.id ? { id: c.id } : {}),
                  name: c.name,
                  category: c.category,
                  wipLimit: c.wipLimit ? Number(c.wipLimit) : null,
                })),
              };
              const parsed = boardColumnsSchema.safeParse(body);
              if (!parsed.success) {
                setError(parsed.error.issues[0]?.message ?? 'Check the columns');
                return;
              }
              run.mutate(() => api.put(`/projects/${project.id}/columns`, body));
            }}
          >
            Save columns
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Settings({ project }: { project: ProjectDetails }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Project</CardTitle>
        </CardHeader>
        <CardContent>
          <ResourceForm
            editing
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'hourlyRate', label: 'Default hourly rate' },
              { name: 'budgetAmount', label: 'Budget amount' },
              { name: 'budgetHours', label: 'Budget hours' },
              { name: 'startDate', label: 'Start', kind: 'date' },
              { name: 'endDate', label: 'End', kind: 'date' },
              ...(project.client
                ? [
                    {
                      name: 'portalEnabled',
                      label: 'Show in the client portal',
                      kind: 'checkbox' as const,
                    },
                  ]
                : []),
              { name: 'description', label: 'Description', kind: 'textarea' },
            ]}
            defaultValues={{
              name: project.name,
              hourlyRate: project.finance?.hourlyRate ?? '',
              budgetAmount: project.finance?.budgetAmount ?? '',
              budgetHours: project.finance?.budgetHours ?? '',
              startDate: project.startDate ?? '',
              endDate: project.endDate ?? '',
              portalEnabled: String(project.portalEnabled),
              description: project.description ?? '',
              status: project.status,
            }}
            statusOptions={['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((s) => ({
              value: s,
              label: label(s),
            }))}
            schema={updateProjectSchema}
            submit={(body) => api.patch(`/projects/${project.id}`, body)}
            invalidate={[PROJECTS]}
            submitLabel="Save"
            onDone={() => undefined}
          />
        </CardContent>
      </Card>
      <ColumnsEditor key={project.columns.map((c) => c.id).join()} project={project} />
    </div>
  );
}

// ------------------------------------------------------------------------------ project page

export function ProjectPage() {
  const { id = '' } = useParams<{ id: string }>();
  const project = useProject(id);
  const [tab, setTab] = useState('board');
  const [creating, setCreating] = useState(false);
  if (project.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (project.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(project.error)} />
      </Page>
    );
  const p = project.data;
  const f = p.finance;
  return (
    <Page>
      <PageHeader
        title={p.name}
        description={`${p.key} · ${p.client ? p.client.name : 'Internal'} · ${label(p.billingType)}`}
        actions={
          <>
            <Status s={p.status} />
            {p.myRole !== 'VIEWER' && (p.myRole || p.canManage) ? (
              <Button
                onClick={() => {
                  setCreating(true);
                }}
              >
                <Plus /> New item
              </Button>
            ) : null}
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="py-3 text-sm">
            <p className="text-muted-foreground">Done</p>
            <p className="text-lg font-semibold">{p.progress.percentDone}%</p>
            <Bar value={p.progress.percentDone} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-sm">
            <p className="text-muted-foreground">Open items</p>
            <p className="text-lg font-semibold">
              {Number(p.progress.todo) + Number(p.progress.inProgress)}
            </p>
          </CardContent>
        </Card>
        {f ? (
          <>
            <Card>
              <CardContent className="py-3 text-sm" aria-label="Hours">
                <p className="text-muted-foreground">Hours logged</p>
                <p className="text-lg font-semibold">
                  {f.hoursLogged}
                  {f.budgetHours ? ` / ${f.budgetHours}` : ''}
                </p>
                {f.hoursPercent ? <Bar value={f.hoursPercent} /> : null}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-3 text-sm" aria-label="Billable value">
                <p className="text-muted-foreground">Approved billable value</p>
                <p className="text-lg font-semibold">
                  {f.billableAmount}
                  {f.budgetAmount ? ` / ${f.budgetAmount}` : ''}
                </p>
                {f.amountPercent ? <Bar value={f.amountPercent} /> : null}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Project views">
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="backlog">Backlog</TabsTrigger>
          <TabsTrigger value="sprints">Sprints</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          {p.canManage ? <TabsTrigger value="settings">Settings</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="board">
          <Board project={p} />
        </TabsContent>
        <TabsContent value="backlog">
          <Backlog
            project={p}
            onNew={() => {
              setCreating(true);
            }}
          />
        </TabsContent>
        <TabsContent value="sprints">
          <Sprints project={p} />
        </TabsContent>
        <TabsContent value="members">
          <Members project={p} />
        </TabsContent>
        {p.canManage ? (
          <TabsContent value="settings">
            <Settings project={p} />
          </TabsContent>
        ) : null}
      </Tabs>
      {creating ? (
        <ItemDialog
          project={p}
          open
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
    </Page>
  );
}

// ------------------------------------------------------------------------------ item page

export function WorkItemPage() {
  const { id = '', itemId = '' } = useParams<{ id: string; itemId: string }>();
  const project = useProject(id);
  const item = useItem(id, itemId);
  const { error, run } = useAct();
  const [comment, setComment] = useState({ body: '', clientVisible: false });
  const [child, setChild] = useState<WorkItemTypeValue | null>(null);
  if (item.isPending || project.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (item.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(item.error)} />
      </Page>
    );
  if (project.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(project.error)} />
      </Page>
    );
  const w = item.data;
  const p = project.data;
  const canWrite = p.canManage || p.myRole === 'MEMBER' || p.myRole === 'MANAGER';
  const patch = (body: object) => {
    run.mutate(() => api.patch(`/projects/${id}/items/${itemId}`, body));
  };
  const childTypes = TYPES.filter((t) => PARENTS[t].includes(w.type));
  return (
    <Page>
      <PageHeader
        title={`${w.key} ${w.title}`}
        description={`${label(w.type)} in ${p.name}${w.parent ? ` · part of ${w.parent.key} ${w.parent.title}` : ''}${w.fromClient ? ' · raised by the client' : ''}`}
        actions={<Status s={w.column.category} />}
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 py-4 text-sm">
              {w.description ? (
                <p className="whitespace-pre-wrap">{w.description}</p>
              ) : (
                <p className="text-muted-foreground">No description.</p>
              )}
              {w.stepsToReproduce ? (
                <>
                  <p className="font-medium">Steps to reproduce</p>
                  <p className="whitespace-pre-wrap">{w.stepsToReproduce}</p>
                </>
              ) : null}
              {w.environment ? <p>Environment: {w.environment}</p> : null}
            </CardContent>
          </Card>
          {childTypes.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Child items</CardTitle>
                {canWrite ? (
                  <div className="ml-auto flex gap-1">
                    {childTypes.map((t) => (
                      <Button
                        key={t}
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setChild(t);
                        }}
                      >
                        <Plus /> {label(t)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border text-sm" aria-label="Child items">
                  {w.childItems.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 px-4 py-2">
                      <Link
                        to={`/projects/${id}/items/${c.id}`}
                        className="text-primary hover:underline"
                      >
                        {c.key}
                      </Link>
                      <span className="min-w-0 flex-1">{c.title}</span>
                      <Status s={c.column.category} />
                    </li>
                  ))}
                  {!w.childItems.length ? (
                    <li className="p-4 text-muted-foreground">None yet.</li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <ul className="flex flex-col gap-2" aria-label="Comments">
                {w.comments.map((c) => (
                  <li key={c.id} className="rounded border border-border p-2">
                    <p className="text-xs text-muted-foreground">
                      {c.author ?? 'Someone'} · {new Date(c.createdAt).toLocaleString()}
                      {c.fromClient
                        ? ' · from the client'
                        : c.clientVisible
                          ? ' · shared with the client'
                          : ' · internal'}
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
              </ul>
              {canWrite ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    aria-label="New comment"
                    value={comment.body}
                    onChange={(e) => {
                      setComment({ ...comment, body: e.target.value });
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {w.clientVisible ? (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={comment.clientVisible}
                          onCheckedChange={(c) => {
                            setComment({ ...comment, clientVisible: c === true });
                          }}
                        />{' '}
                        Share with the client
                      </label>
                    ) : null}
                    <Button
                      size="sm"
                      className="ml-auto"
                      disabled={!comment.body.trim()}
                      onClick={() => {
                        run.mutate(
                          () => api.post(`/projects/${id}/items/${itemId}/comments`, comment),
                          {
                            onSuccess: () => {
                              setComment({ body: '', clientVisible: false });
                            },
                          },
                        );
                      }}
                    >
                      Comment
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 py-4">
              <FormGrid columns={1}>
                <FormField label="Status">
                  <Select
                    disabled={!canWrite}
                    value={w.column.id}
                    options={p.columns.map((c) => ({ value: c.id, label: c.name }))}
                    onChange={(e) => {
                      patch({ columnId: e.target.value });
                    }}
                  />
                </FormField>
                <FormField label="Assignee">
                  <Select
                    disabled={!canWrite}
                    value={w.assignee?.id ?? ''}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...p.members
                        .filter((m) => m.role !== 'VIEWER')
                        .map((m) => ({ value: m.employee.id, label: m.employee.displayName })),
                    ]}
                    onChange={(e) => {
                      patch({ assigneeId: e.target.value || null });
                    }}
                  />
                </FormField>
                <FormField label="Priority">
                  <Select
                    disabled={!canWrite}
                    value={w.priority}
                    options={PRIORITIES.map((x) => ({ value: x, label: label(x) }))}
                    onChange={(e) => {
                      patch({ priority: e.target.value });
                    }}
                  />
                </FormField>
                {w.type !== 'EPIC' && w.type !== 'FEATURE' ? (
                  <FormField label="Sprint">
                    <Select
                      disabled={!canWrite}
                      value={w.sprintId ?? ''}
                      options={[
                        { value: '', label: 'Backlog' },
                        ...p.sprints
                          .filter((s) => s.status !== 'COMPLETED' || s.id === w.sprintId)
                          .map((s) => ({ value: s.id, label: s.name })),
                      ]}
                      onChange={(e) => {
                        patch({ sprintId: e.target.value || null });
                      }}
                    />
                  </FormField>
                ) : null}
              </FormGrid>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  disabled={!canWrite}
                  checked={w.clientVisible}
                  onCheckedChange={(c) => {
                    patch({ clientVisible: c === true });
                  }}
                />{' '}
                Visible to the client
              </label>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
                <dt className="text-muted-foreground">Points</dt>
                <dd>{w.storyPoints ?? '—'}</dd>
                <dt className="text-muted-foreground">Estimate</dt>
                <dd>{w.estimateHours ? `${w.estimateHours} h` : '—'}</dd>
                <dt className="text-muted-foreground">Logged</dt>
                <dd>{w.loggedHours} h</dd>
                <dt className="text-muted-foreground">Due</dt>
                <dd>{w.dueDate ?? '—'}</dd>
                {w.severity ? (
                  <>
                    <dt className="text-muted-foreground">Severity</dt>
                    <dd>
                      <Status s={w.severity} />
                    </dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Reporter</dt>
                <dd>{w.reporter ?? '—'}</dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol
                className="flex flex-col gap-1 text-xs text-muted-foreground"
                aria-label="History"
              >
                {w.history.map((h, i) => (
                  <li key={i}>
                    {new Date(h.at).toLocaleString()} · {h.actor ?? 'Someone'} · {h.field}
                    {h.from || h.to ? `: ${h.from ?? '—'} → ${h.to ?? '—'}` : ''}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
      {child ? (
        <ItemDialog
          project={p}
          open
          onClose={() => {
            setChild(null);
          }}
          defaults={{
            type: child,
            parentId: w.id,
            ...(w.sprintId ? { sprintId: w.sprintId } : {}),
          }}
        />
      ) : null}
    </Page>
  );
}

// ------------------------------------------------------------------------------ my work

export function MyWorkPage() {
  const work = useMyWork();
  return (
    <Page>
      <PageHeader title="My work" description="Open items assigned to you across projects." />
      {work.isPending ? (
        <Skeleton className="h-32" />
      ) : !work.data?.length ? (
        <EmptyState title="Nothing assigned to you" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="My work items">
              {work.data.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Link
                    to={`/projects/${w.project.id}/items/${w.id}`}
                    className="text-primary hover:underline"
                  >
                    {w.key}
                  </Link>
                  <span className="min-w-0 flex-1">
                    {w.title} <span className="text-muted-foreground">· {w.project.name}</span>
                  </span>
                  {w.dueDate ? (
                    <span className="text-muted-foreground">due {w.dueDate}</span>
                  ) : null}
                  <Status s={w.priority} />
                  <Badge variant={VARIANT[w.column.category] ?? 'neutral'}>{w.column.name}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
