import type { ClientItem } from '@hrm/shared-types';
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
import {
  billingSettingsSchema,
  clientContactSchema,
  clientSchema,
  invoiceSchema,
  paymentSchema,
  taxRateSchema,
  updateClientSchema,
} from '@hrm/validation';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { useMembersPage } from '@/features/members/api';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  PROJECTS,
  todayLocal,
  useBillingSettings,
  useClients,
  useInvoice,
  useInvoices,
  useTaxRates,
  VARIANT,
  useAct,
} from './projects-api';

const P = PERMISSIONS;
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);

// ------------------------------------------------------------------------------ clients

function PortalUsers({ c }: { c: ClientItem }) {
  const members = useMembersPage({ page: 1, pageSize: 100, sortDir: 'asc', status: 'ACTIVE' });
  const { error, run } = useAct();
  const [pick, setPick] = useState('');
  const candidates = (members.data?.items ?? []).filter(
    (m) => m.roles.length === 1 && m.roles[0]?.key === 'client',
  );
  return (
    <div className="flex flex-col gap-2">
      <p className="font-medium">Portal logins</p>
      <p className="text-xs text-muted-foreground">
        Invite the contact under Members with only the Client role, then link them here.
      </p>
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      {c.portalUsers.map((u) => (
        <p key={u.membershipId} className="flex items-center gap-2">
          {u.name} · {u.email}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Remove portal access of ${u.name}`}
            onClick={() => {
              run.mutate(() => api.delete(`/clients/${c.id}/portal-users/${u.membershipId}`));
            }}
          >
            <X />
          </Button>
        </p>
      ))}
      <div className="flex gap-2">
        <Select
          aria-label="Client login"
          value={pick}
          placeholder="Choose a Client-role member…"
          options={candidates
            .filter((m) => !c.portalUsers.some((u) => u.membershipId === m.membershipId))
            .map((m) => ({ value: m.membershipId, label: `${m.fullName} (${m.email})` }))}
          onChange={(e) => {
            setPick(e.target.value);
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!pick}
          onClick={() => {
            run.mutate(() => api.post(`/clients/${c.id}/portal-users`, { membershipId: pick }), {
              onSuccess: () => {
                setPick('');
              },
            });
          }}
        >
          Link
        </Button>
      </div>
    </div>
  );
}

function ClientCard({ c, manage }: { c: ClientItem; manage: boolean }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'edit' | 'contact' | null>(null);
  const { error, run } = useAct();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.name}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {c.code} · {c.currency} · {c.paymentTermsDays} days · {c.projects} projects
        </span>
        <Status s={c.status} />
        {manage ? (
          <div className="ml-auto flex gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setDialog('edit');
              }}
            >
              Edit
            </Button>
            <Button
              size="xs"
              variant="ghost"
              aria-expanded={open}
              onClick={() => {
                setOpen(!open);
              }}
            >
              {open ? 'Hide' : 'Contacts & portal'}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <p className="font-medium">Contacts</p>
            {error ? <Alert tone="destructive">{error}</Alert> : null}
            {c.contacts.map((x) => (
              <p key={x.id} className="flex items-center gap-2">
                {x.name}
                {x.role ? ` · ${x.role}` : ''}
                {x.email ? ` · ${x.email}` : ''}
                {x.phone ? ` · ${x.phone}` : ''}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${x.name}`}
                  onClick={() => {
                    run.mutate(() => api.delete(`/clients/${c.id}/contacts/${x.id}`));
                  }}
                >
                  <X />
                </Button>
              </p>
            ))}
            <div>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setDialog('contact');
                }}
              >
                <Plus /> Contact
              </Button>
            </div>
          </div>
          <PortalUsers c={c} />
        </CardContent>
      ) : null}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === 'edit' ? (
            <>
              <DialogHeader title={`Edit ${c.name}`} />
              <ResourceForm
                editing
                fields={[
                  { name: 'name', label: 'Name', required: true },
                  { name: 'currency', label: 'Currency', required: true },
                  { name: 'paymentTermsDays', label: 'Payment terms (days)', required: true },
                  { name: 'email', label: 'Billing e-mail', kind: 'email' },
                  { name: 'taxNumber', label: 'Tax registration number' },
                  { name: 'billingAddress', label: 'Billing address', kind: 'textarea' },
                  { name: 'notes', label: 'Notes', kind: 'textarea' },
                ]}
                defaultValues={{
                  name: c.name,
                  currency: c.currency,
                  paymentTermsDays: String(c.paymentTermsDays),
                  email: c.email ?? '',
                  taxNumber: c.taxNumber ?? '',
                  billingAddress: c.billingAddress ?? '',
                  notes: c.notes ?? '',
                  status: c.status,
                }}
                statusOptions={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
                schema={updateClientSchema}
                submit={(body) => api.patch(`/clients/${c.id}`, body)}
                invalidate={[PROJECTS]}
                submitLabel="Save"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'contact' ? (
            <>
              <DialogHeader title="New contact" />
              <ResourceForm
                fields={[
                  { name: 'name', label: 'Name', required: true },
                  { name: 'role', label: 'Role' },
                  { name: 'email', label: 'E-mail', kind: 'email' },
                  { name: 'phone', label: 'Phone' },
                ]}
                defaultValues={{ name: '', role: '', email: '', phone: '' }}
                schema={clientContactSchema}
                submit={(body) => api.post(`/clients/${c.id}/contacts`, body)}
                invalidate={[PROJECTS]}
                submitLabel="Add"
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

export function ClientsPage() {
  const manage = usePermission(P.PROJECTS_CLIENT_MANAGE);
  const clients = useClients();
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Clients"
        description="Who you deliver projects for and bill."
        actions={
          manage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New client
            </Button>
          ) : null
        }
      />
      {clients.isPending ? (
        <Skeleton className="h-32" />
      ) : clients.isError ? (
        <ErrorState description={errorMessage(clients.error)} />
      ) : !clients.data.length ? (
        <EmptyState title="No clients yet" />
      ) : (
        <div className="flex flex-col gap-3" aria-label="Clients">
          {clients.data.map((c) => (
            <ClientCard key={c.id} c={c} manage={manage} />
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New client" />
          <ResourceForm
            fields={[
              { name: 'code', label: 'Code', required: true },
              { name: 'name', label: 'Name', required: true },
              {
                name: 'currency',
                label: 'Billing currency',
                required: true,
                description: 'ISO code, e.g. INR, USD.',
              },
              { name: 'paymentTermsDays', label: 'Payment terms (days)', required: true },
              { name: 'email', label: 'Billing e-mail', kind: 'email' },
              { name: 'taxNumber', label: 'Tax registration number' },
              { name: 'billingAddress', label: 'Billing address', kind: 'textarea' },
            ]}
            defaultValues={{
              code: '',
              name: '',
              currency: '',
              paymentTermsDays: '',
              email: '',
              taxNumber: '',
              billingAddress: '',
            }}
            schema={clientSchema}
            submit={(body) => api.post('/clients', body)}
            invalidate={[PROJECTS]}
            submitLabel="Create client"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ invoices

function NewInvoice({ onDone }: { onDone: (id: string) => void }) {
  const clients = useClients();
  const taxes = useTaxRates();
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    clientId: '',
    withTime: true,
    timeFrom: '',
    timeTo: '',
    timeTaxRateId: '',
    notes: '',
  });
  const [lines, setLines] = useState<
    { description: string; quantity: string; unitPrice: string; taxRateId: string }[]
  >([]);
  const taxOptions = (taxes.data ?? [])
    .filter((t) => !t.effectiveTo || t.effectiveTo >= todayLocal())
    .map((t) => ({ value: t.id, label: `${t.name} (${t.ratePercent}%)` }));
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormField label="Client" required>
          <Select
            value={v.clientId}
            placeholder="Select…"
            options={(clients.data ?? [])
              .filter((c) => c.status === 'ACTIVE')
              .map((c) => ({ value: c.id, label: `${c.name} (${c.currency})` }))}
            onChange={(e) => {
              setV({ ...v, clientId: e.target.value });
            }}
          />
        </FormField>
        <fieldset className="flex flex-col gap-2 rounded border border-border p-3">
          <legend className="px-1 text-sm font-medium">
            Approved billable time (time & materials projects)
          </legend>
          <FormGrid columns={3}>
            <FormField label="From">
              <Input
                type="date"
                value={v.timeFrom}
                onChange={(e) => {
                  setV({ ...v, timeFrom: e.target.value });
                }}
              />
            </FormField>
            <FormField label="To">
              <Input
                type="date"
                value={v.timeTo}
                onChange={(e) => {
                  setV({ ...v, timeTo: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Tax on time">
              <Select
                value={v.timeTaxRateId}
                placeholder="No tax"
                options={[{ value: '', label: 'No tax' }, ...taxOptions]}
                onChange={(e) => {
                  setV({ ...v, timeTaxRateId: e.target.value });
                }}
              />
            </FormField>
          </FormGrid>
        </fieldset>
        {lines.map((l, i) => (
          <div
            key={i}
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`Line ${String(i + 1)}`}
          >
            <Input
              aria-label="Description"
              className="min-w-48 flex-1"
              placeholder="Description (e.g. milestone)"
              value={l.description}
              onChange={(e) => {
                setLines(
                  lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                );
              }}
            />
            <Input
              aria-label="Quantity"
              className="w-20"
              placeholder="Qty"
              value={l.quantity}
              onChange={(e) => {
                setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)));
              }}
            />
            <Input
              aria-label="Unit price"
              className="w-32"
              placeholder="Unit price"
              value={l.unitPrice}
              onChange={(e) => {
                setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)));
              }}
            />
            <Select
              aria-label="Tax"
              className="w-44"
              value={l.taxRateId}
              placeholder="No tax"
              options={[{ value: '', label: 'No tax' }, ...taxOptions]}
              onChange={(e) => {
                setLines(lines.map((x, j) => (j === i ? { ...x, taxRateId: e.target.value } : x)));
              }}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove line ${String(i + 1)}`}
              onClick={() => {
                setLines(lines.filter((_, j) => j !== i));
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
              setLines([
                ...lines,
                { description: '', quantity: '1', unitPrice: '', taxRateId: '' },
              ]);
            }}
          >
            <Plus /> Manual line
          </Button>
        </div>
        <FormField label="Notes">
          <Textarea
            value={v.notes}
            onChange={(e) => {
              setV({ ...v, notes: e.target.value });
            }}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button
          onClick={() => {
            const body = {
              clientId: v.clientId,
              timeFrom: v.timeFrom || null,
              timeTo: v.timeTo || null,
              timeTaxRateId: v.timeTaxRateId || null,
              lines: lines.map((l) => ({ ...l, taxRateId: l.taxRateId || null })),
              notes: v.notes || null,
            };
            const parsed = invoiceSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the invoice');
              return;
            }
            run.mutate(() =>
              api.post<{ id: string }>('/invoices', body).then((r) => {
                onDone(r.id);
              }),
            );
          }}
        >
          Create draft
        </Button>
      </DialogFooter>
    </>
  );
}

function Configuration() {
  const taxes = useTaxRates();
  const settings = useBillingSettings();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tax rates</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-muted-foreground">
            Rates are your own configuration; none are pre-loaded.
          </p>
          <ul aria-label="Tax rates">
            {(taxes.data ?? []).map((t) => (
              <li key={t.id}>
                {t.name} · {t.ratePercent}% · from {t.effectiveFrom}
                {t.effectiveTo ? ` to ${t.effectiveTo}` : ''}
              </li>
            ))}
          </ul>
          <ResourceForm
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'ratePercent', label: 'Rate (%)', required: true },
              { name: 'effectiveFrom', label: 'Effective from', kind: 'date', required: true },
              { name: 'effectiveTo', label: 'Effective to', kind: 'date' },
            ]}
            defaultValues={{ name: '', ratePercent: '', effectiveFrom: '', effectiveTo: '' }}
            schema={taxRateSchema}
            submit={(body) => api.post('/billing/tax-rates', body)}
            invalidate={[PROJECTS]}
            submitLabel="Add tax rate"
            onDone={() => undefined}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invoice numbering</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {settings.data ? (
            <>
              <p className="mb-2 text-muted-foreground">
                Next number: {settings.data.invoicePrefix}-{new Date().getFullYear()}-
                {String(settings.data.nextSequence).padStart(4, '0')}
              </p>
              <ResourceForm
                fields={[{ name: 'invoicePrefix', label: 'Prefix', required: true }]}
                defaultValues={{ invoicePrefix: settings.data.invoicePrefix }}
                schema={billingSettingsSchema}
                submit={(body) => api.put('/billing/settings', body)}
                invalidate={[PROJECTS]}
                submitLabel="Save"
                onDone={() => undefined}
              />
            </>
          ) : (
            <Skeleton className="h-20" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function BillingPage() {
  const [tab, setTab] = useState('invoices');
  const [status, setStatus] = useState('');
  const invoices = useInvoices({ status: status || undefined });
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Page>
      <PageHeader
        title="Billing"
        description="Invoices from approved time and fixed fees, payments and tax rates."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New invoice
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Billing views">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="setup">Tax & numbering</TabsTrigger>
        </TabsList>
        <TabsContent value="invoices">
          <div className="mb-3 w-48">
            <Select
              aria-label="Status"
              value={status}
              placeholder="All statuses"
              options={['DRAFT', 'ISSUED', 'PAID', 'VOID'].map((s) => ({
                value: s,
                label: label(s),
              }))}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
            />
          </div>
          {!invoices.data?.length ? (
            <EmptyState title="No invoices" />
          ) : (
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm" aria-label="Invoices">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-normal">Invoice</th>
                      <th className="px-3 py-2 font-normal">Client</th>
                      <th className="px-3 py-2 font-normal">Issued</th>
                      <th className="px-3 py-2 font-normal">Due</th>
                      <th className="px-3 py-2 text-right font-normal">Total</th>
                      <th className="px-3 py-2 text-right font-normal">Balance</th>
                      <th className="px-3 py-2 font-normal">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.map((i) => (
                      <tr key={i.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <Link
                            to={`/billing/invoices/${i.id}`}
                            className="text-primary hover:underline"
                          >
                            {i.number ?? 'Draft'}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{i.client.name}</td>
                        <td className="px-3 py-2">{i.issuedOn ?? '—'}</td>
                        <td className="px-3 py-2">
                          {i.dueOn ?? '—'}
                          {i.overdue ? (
                            <Badge variant="destructive" className="ml-1">
                              overdue
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {i.currency} {i.total}
                        </td>
                        <td className="px-3 py-2 text-right">{i.balance}</td>
                        <td className="px-3 py-2">
                          <Status s={i.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="setup">
          <Configuration />
        </TabsContent>
      </Tabs>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader
            title="New invoice"
            description="A draft: review it, then issue it to number it."
          />
          <NewInvoice
            onDone={(id) => {
              setCreating(false);
              void navigate(`/billing/invoices/${id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** Read-only invoice, shared with the client portal. */
export function InvoiceView({ inv }: { inv: NonNullable<ReturnType<typeof useInvoice>['data']> }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4 text-sm">
        <div className="flex flex-wrap gap-4">
          <p>
            <span className="text-muted-foreground">Client</span>
            <br />
            {inv.client.name}
          </p>
          <p>
            <span className="text-muted-foreground">Issued</span>
            <br />
            {inv.issuedOn ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Due</span>
            <br />
            {inv.dueOn ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">Currency</span>
            <br />
            {inv.currency}
          </p>
        </div>
        <table className="w-full" aria-label="Invoice lines">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">Description</th>
              <th className="py-1 text-right font-normal">Qty</th>
              <th className="py-1 text-right font-normal">Unit price</th>
              <th className="py-1 text-right font-normal">Amount</th>
              <th className="py-1 text-right font-normal">Tax</th>
              <th className="py-1 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-1">{l.description}</td>
                <td className="py-1 text-right">{l.quantity}</td>
                <td className="py-1 text-right">{l.unitPrice}</td>
                <td className="py-1 text-right">{l.amount}</td>
                <td className="py-1 text-right">
                  {l.taxName ? `${l.tax} (${l.taxName} ${l.taxPercent ?? ''}%)` : '—'}
                </td>
                <td className="py-1 text-right">{l.total}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={5} className="py-1 text-right">
                Subtotal
              </td>
              <td className="py-1 text-right">{inv.subtotal}</td>
            </tr>
            <tr>
              <td colSpan={5} className="py-1 text-right">
                Tax
              </td>
              <td className="py-1 text-right">{inv.taxTotal}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={5} className="py-1 text-right">
                Total
              </td>
              <td className="py-1 text-right" aria-label="Invoice total">
                {inv.total}
              </td>
            </tr>
            <tr>
              <td colSpan={5} className="py-1 text-right">
                Paid
              </td>
              <td className="py-1 text-right">{inv.paid}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={5} className="py-1 text-right">
                Balance
              </td>
              <td className="py-1 text-right">{inv.balance}</td>
            </tr>
          </tfoot>
        </table>
        {inv.notes ? (
          <p className="whitespace-pre-wrap text-muted-foreground">{inv.notes}</p>
        ) : null}
        {inv.payments.length ? (
          <ul aria-label="Payments" className="text-muted-foreground">
            {inv.payments.map((p) => (
              <li key={p.id}>
                {p.receivedOn} · {p.amount}
                {p.reference ? ` · ${p.reference}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
        {inv.voidReason ? <Alert tone="warning">Void: {inv.voidReason}</Alert> : null}
      </CardContent>
    </Card>
  );
}

export function InvoicePage() {
  const { id = '' } = useParams<{ id: string }>();
  const invoice = useInvoice(id);
  const navigate = useNavigate();
  const { error, run } = useAct();
  const [issuedOn, setIssuedOn] = useState(todayLocal());
  const [dialog, setDialog] = useState<'pay' | 'void' | null>(null);
  const [reason, setReason] = useState('');
  if (invoice.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (invoice.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(invoice.error)} />
      </Page>
    );
  const inv = invoice.data;
  return (
    <Page>
      <PageHeader
        title={inv.number ?? 'Draft invoice'}
        description={`${inv.client.name} · ${inv.currency} ${inv.total}`}
        actions={
          <>
            <Status s={inv.status} />
            {inv.status === 'DRAFT' ? (
              <>
                <Input
                  aria-label="Issue date"
                  type="date"
                  className="w-40"
                  value={issuedOn}
                  onChange={(e) => {
                    setIssuedOn(e.target.value);
                  }}
                />
                <Button
                  onClick={() => {
                    run.mutate(() => api.post(`/invoices/${inv.id}/issue`, { issuedOn }));
                  }}
                >
                  Issue
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    run.mutate(() =>
                      api.delete(`/invoices/${inv.id}`).then(() => navigate('/billing')),
                    );
                  }}
                >
                  Delete draft
                </Button>
              </>
            ) : null}
            {inv.status === 'ISSUED' ? (
              <>
                <Button
                  onClick={() => {
                    setDialog('pay');
                  }}
                >
                  Record payment
                </Button>
                {inv.paid === '0.00' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setDialog('void');
                    }}
                  >
                    Void
                  </Button>
                ) : null}
              </>
            ) : null}
          </>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <InvoiceView inv={inv} />
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === 'pay' ? (
            <>
              <DialogHeader title="Record payment" description={`Balance ${inv.balance}`} />
              <ResourceForm
                fields={[
                  { name: 'amount', label: 'Amount', required: true },
                  { name: 'receivedOn', label: 'Received on', kind: 'date', required: true },
                  { name: 'reference', label: 'Reference' },
                ]}
                defaultValues={{ amount: inv.balance, receivedOn: todayLocal(), reference: '' }}
                schema={paymentSchema}
                submit={(body) => api.post(`/invoices/${inv.id}/payments`, body)}
                invalidate={[PROJECTS]}
                submitLabel="Record"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'void' ? (
            <>
              <DialogHeader
                title="Void invoice"
                description="Its time becomes billable again; the number is not reused."
              />
              <div className="flex flex-col gap-3 px-6 pb-6">
                <FormField label="Reason" required>
                  <Textarea
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                    }}
                  />
                </FormField>
                <Button
                  disabled={!reason.trim()}
                  onClick={() => {
                    run.mutate(() => api.post(`/invoices/${inv.id}/void`, { reason }), {
                      onSuccess: () => {
                        setDialog(null);
                      },
                    });
                  }}
                >
                  Void invoice
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
