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
  FormField,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import { obligationSchema } from '@hrm/validation';
import { Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { authorizedFetch, saveDownload } from '@/features/recruitment/recruit-api';
import type { RefRow } from '@/features/structure/api';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  OPS,
  useAct,
  useComplianceDashboard,
  useComplianceTasks,
  useExpiring,
  useObligations,
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

function Tasks({ scope }: { scope: 'mine' | 'all' }) {
  const tasks = useComplianceTasks(scope);
  const { error, setError, run } = useAct();
  const [completing, setCompleting] = useState<{
    id: string;
    note: string;
    file: File | null;
  } | null>(null);
  if (tasks.isPending) return <Skeleton className="h-32" />;
  if (!tasks.data?.length) return <EmptyState title="No compliance tasks" />;
  return (
    <>
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <table
            className="w-full text-sm"
            aria-label={scope === 'mine' ? 'My compliance tasks' : 'Compliance tasks'}
          >
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">Obligation</th>
                <th className="px-3 py-2 font-normal">Owner</th>
                <th className="px-3 py-2 font-normal">Due</th>
                <th className="px-3 py-2 font-normal">State</th>
                <th className="px-3 py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {tasks.data.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {t.obligation.title}
                    <span className="block text-xs text-muted-foreground">
                      {label(t.obligation.category)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{t.owner.displayName}</td>
                  <td className="px-3 py-2">{t.dueOn}</td>
                  <td className="px-3 py-2">
                    <Status s={t.state} />
                    {t.note ? (
                      <span className="block text-xs text-muted-foreground">
                        {t.note}
                        {t.completedBy ? ` — ${t.completedBy}` : ''}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {t.canComplete ? (
                      <Button
                        size="xs"
                        onClick={() => {
                          setCompleting({ id: t.id, note: '', file: null });
                        }}
                      >
                        Complete
                      </Button>
                    ) : null}
                    {t.evidence ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          saveDownload(
                            `/compliance/tasks/${t.id}/evidence`,
                            t.evidence?.fileName ?? 'evidence',
                          ).catch((e: unknown) => {
                            setError(errorMessage(e));
                          });
                        }}
                      >
                        <Paperclip /> {t.evidence.fileName}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Dialog
        open={completing !== null}
        onOpenChange={(o) => {
          if (!o) setCompleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title="Complete task"
            description="A recurring obligation gets its next due date automatically."
          />
          {completing ? (
            <>
              <DialogBody className="flex flex-col gap-3">
                <FormField label="What was done" required>
                  <Textarea
                    value={completing.note}
                    onChange={(e) => {
                      setCompleting({ ...completing, note: e.target.value });
                    }}
                  />
                </FormField>
                <FormField label="Evidence (PDF or image)">
                  <input
                    type="file"
                    aria-label="Evidence"
                    accept="application/pdf,image/*"
                    onChange={(e) => {
                      setCompleting({ ...completing, file: e.target.files?.[0] ?? null });
                    }}
                  />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button
                  disabled={!completing.note.trim()}
                  onClick={() => {
                    const form = new FormData();
                    form.append('note', completing.note);
                    if (completing.file) form.append('file', completing.file);
                    run.mutate(
                      () =>
                        authorizedFetch(`/compliance/tasks/${completing.id}/complete`, {
                          method: 'POST',
                          body: form,
                        }),
                      {
                        onSuccess: () => {
                          setCompleting(null);
                        },
                      },
                    );
                  }}
                >
                  Complete
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Obligations() {
  const obligations = useObligations(true);
  const [creating, setCreating] = useState(false);
  const { run } = useAct();
  return (
    <>
      <div className="mb-3">
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus /> New obligation
        </Button>
      </div>
      {!obligations.data?.length ? (
        <EmptyState
          title="No obligations yet"
          description="Add the filings, renewals, audits and reviews that apply to your organization — none are pre-loaded."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Obligations">
              {obligations.data.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{o.title}</strong>{' '}
                    <span className="text-muted-foreground">
                      · {label(o.category)} · {label(o.recurrence)} · owner {o.owner.displayName}
                    </span>
                  </span>
                  <span className="text-muted-foreground">next due {o.nextDueOn ?? '—'}</span>
                  <Status s={o.status} />
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      run.mutate(() =>
                        api.patch(`/compliance/obligations/${o.id}`, {
                          status: o.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                        }),
                      );
                    }}
                  >
                    {o.status === 'ACTIVE' ? 'Stop' : 'Resume'}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New obligation" />
          <ResourceForm
            fields={[
              { name: 'title', label: 'Title', required: true },
              {
                name: 'category',
                label: 'Category',
                kind: 'select',
                required: true,
                options: [
                  'STATUTORY_FILING',
                  'LICENCE_RENEWAL',
                  'AUDIT',
                  'POLICY_REVIEW',
                  'OTHER',
                ].map((c) => ({ value: c, label: label(c) })),
              },
              {
                name: 'ownerEmployeeId',
                label: 'Owner',
                kind: 'ref',
                required: true,
                ref: employeeRef,
                refParams: { status: 'ACTIVE' },
              },
              { name: 'firstDueOn', label: 'First due on', kind: 'date', required: true },
              {
                name: 'recurrence',
                label: 'Repeats',
                kind: 'select',
                required: true,
                options: ['NONE', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'].map((r) => ({
                  value: r,
                  label: label(r),
                })),
              },
              { name: 'description', label: 'Description', kind: 'textarea' },
            ]}
            defaultValues={{
              title: '',
              category: 'STATUTORY_FILING',
              ownerEmployeeId: '',
              firstDueOn: '',
              recurrence: 'MONTHLY',
              description: '',
            }}
            schema={obligationSchema}
            submit={(body) => api.post('/compliance/obligations', body)}
            invalidate={[OPS]}
            submitLabel="Create"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function Dashboard() {
  const dash = useComplianceDashboard(true);
  const [days, setDays] = useState(60);
  const expiring = useExpiring(days, true);
  if (!dash.data) return <Skeleton className="h-32" />;
  const d = dash.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3" aria-label="Compliance summary">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Overdue tasks</p>
            <p className="text-2xl font-semibold">{d.tasks.overdue}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Due in 30 days</p>
            <p className="text-2xl font-semibold">{d.tasks.dueSoon}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">Completed this month</p>
            <p className="text-2xl font-semibold">{d.tasks.completedThisMonth}</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Expiring</CardTitle>
          <Select
            aria-label="Window"
            className="ml-auto w-40"
            value={String(days)}
            options={[30, 60, 90, 180].map((x) => ({
              value: String(x),
              label: `next ${String(x)} days`,
            }))}
            onChange={(e) => {
              setDays(Number(e.target.value));
            }}
          />
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border text-sm" aria-label="Expiring items">
            {(expiring.data ?? []).map((x, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2">
                <Link to={x.link} className="min-w-0 flex-1 text-primary hover:underline">
                  {x.title}
                </Link>
                <span className="text-muted-foreground">
                  {label(x.kind)} · {x.subject}
                </span>
                <span>{x.date}</span>
                <Status s={x.state} />
              </li>
            ))}
            {!expiring.data?.length ? (
              <li className="p-4 text-muted-foreground">Nothing expires in this window.</li>
            ) : null}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Policy acknowledgements</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {d.acknowledgements.map((a) => (
            <p key={a.documentId}>
              {a.title} v{a.version}: {a.acknowledged} of {a.audience}
            </p>
          ))}
          {!d.acknowledgements.length ? (
            <p className="text-muted-foreground">No company documents require acknowledgement.</p>
          ) : null}
        </CardContent>
      </Card>
      {d.recentAudit ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link to="/admin/audit" className="ml-auto text-sm text-primary hover:underline">
              Audit log
            </Link>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {d.recentAudit.map((r, i) => (
              <p key={i}>
                {new Date(r.at).toLocaleString()} · {r.actor ?? 'system'} · {r.action}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function CompliancePage() {
  const manage = usePermission(P.COMPLIANCE_CALENDAR_MANAGE);
  const read = usePermission(P.COMPLIANCE_DASHBOARD_READ);
  const [tab, setTab] = useState(read ? 'dashboard' : 'mine');
  return (
    <Page>
      <PageHeader
        title="Compliance"
        description="Your organization's own obligations and deadlines, what expires soon, and who acknowledged policies."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Compliance views">
          {read ? <TabsTrigger value="dashboard">Dashboard</TabsTrigger> : null}
          <TabsTrigger value="mine">My tasks</TabsTrigger>
          {manage || read ? <TabsTrigger value="all">All tasks</TabsTrigger> : null}
          {manage ? <TabsTrigger value="obligations">Obligations</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="dashboard">
          <Dashboard />
        </TabsContent>
        <TabsContent value="mine">
          <Tasks scope="mine" />
        </TabsContent>
        <TabsContent value="all">
          <Tasks scope="all" />
        </TabsContent>
        <TabsContent value="obligations">
          <Obligations />
        </TabsContent>
      </Tabs>
    </Page>
  );
}
