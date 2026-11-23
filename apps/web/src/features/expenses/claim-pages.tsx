import type { ExpenseCategoryItem, ExpenseClaimDetails, ExpenseClaimItem } from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogContent,
  DialogHeader,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  type PaginationState,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import {
  expenseCategorySchema,
  expenseClaimSchema,
  expenseSettingsSchema,
  markPaidSchema,
  updateExpenseCategorySchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { authorizedFetch, saveDownload } from '@/features/recruitment/recruit-api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  amount,
  CLAIM_LABEL,
  SPEND,
  SPEND_VARIANT,
  todayIso,
  useClaim,
  useClaims,
  useExpenseCategories,
  useExpenseSettings,
  useMyClaims,
  useMyTrips,
} from './expenses-api';

const P = PERMISSIONS;

export function ClaimStatus({ status }: { status: string }) {
  return (
    <Badge variant={SPEND_VARIANT[status] ?? 'neutral'}>
      {CLAIM_LABEL[status] ?? status.toLowerCase()}
    </Badge>
  );
}

function claimColumns(showEmployee: boolean): DataTableColumnDef<ExpenseClaimItem>[] {
  return [
    {
      id: 'title',
      header: 'Claim',
      size: 240,
      cell: ({ row }) => (
        <Link
          to={`/expenses/claims/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.original.title}
        </Link>
      ),
    },
    ...(showEmployee
      ? [
          {
            id: 'employee',
            header: 'Employee',
            size: 180,
            cell: ({ row }: { row: { original: ExpenseClaimItem } }) =>
              row.original.employee.displayName,
          },
        ]
      : []),
    { id: 'trip', header: 'Trip', size: 160, cell: ({ row }) => row.original.trip?.purpose ?? '—' },
    {
      id: 'items',
      header: 'Items',
      size: 70,
      meta: { numeric: true },
      cell: ({ row }) => row.original.itemCount,
    },
    {
      id: 'claimed',
      header: 'Claimed',
      size: 120,
      meta: { numeric: true },
      cell: ({ row }) => amount(row.original.totalClaimed),
    },
    {
      id: 'approved',
      header: 'Approved',
      size: 120,
      meta: { numeric: true },
      cell: ({ row }) => amount(row.original.totalApproved),
    },
    {
      id: 'status',
      header: 'Status',
      size: 130,
      cell: ({ row }) => <ClaimStatus status={row.original.status} />,
    },
  ];
}

export function MyExpensesPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const claims = useMyClaims({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const columns = useMemo(() => claimColumns(false), []);
  return (
    <Page>
      <PageHeader
        title="My expenses"
        description="Claim business expenses with receipts; your manager and finance approve them."
        actions={
          <Button asChild>
            <Link to="/expenses/claims/new">
              <Plus /> New claim
            </Link>
          </Button>
        }
      />
      <DataTable
        aria-label="My expense claims"
        mode="server"
        columns={columns}
        data={claims.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={claims.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={claims.isPending}
        error={claims.isError ? errorMessage(claims.error) : null}
        emptyTitle="No expense claims"
      />
    </Page>
  );
}

// ------------------------------------------------------------------------------ claim editor

interface Row {
  categoryId: string;
  date: string;
  days: string;
  description: string;
  merchant: string;
  currency: string;
  originalAmount: string;
  exchangeRate: string;
  justification: string;
}
const blankRow = (currency: string): Row => ({
  categoryId: '',
  date: todayIso(),
  days: '1',
  description: '',
  merchant: '',
  currency,
  originalAmount: '',
  exchangeRate: '1',
  justification: '',
});

function ClaimEditor({
  claim,
  categories,
  currency,
  onSaved,
}: {
  claim: ExpenseClaimDetails | null;
  categories: ExpenseCategoryItem[];
  currency: string;
  onSaved: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const trips = useMyTrips({ pageSize: 50 });
  const [title, setTitle] = useState(claim?.title ?? '');
  const [tripId, setTripId] = useState(claim?.trip?.id ?? '');
  const [rows, setRows] = useState<Row[]>(
    claim?.items.map((i) => ({
      categoryId: i.category.id,
      date: i.date,
      days: String(i.days),
      description: i.description,
      merchant: i.merchant ?? '',
      currency: i.currency,
      originalAmount: i.originalAmount,
      exchangeRate: i.exchangeRate,
      justification: i.justification ?? '',
    })) ?? [blankRow(currency)],
  );
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const save = useMutation({
    mutationFn: (body: object) =>
      claim
        ? api.put<ExpenseClaimDetails>(`/expense-claims/${claim.id}`, body)
        : api.post<ExpenseClaimDetails>('/me/expense-claims', body),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: SPEND });
      setError(null);
      onSaved(saved.id);
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const options = categories
    .filter((c) => c.status === 'ACTIVE')
    .map((c) => ({ value: c.id, label: c.name }));
  const approvedTrips = (trips.data?.items ?? []).filter((t) => t.status === 'APPROVED');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{claim ? 'Edit draft' : 'New claim'}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Title" required>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Trip" description="Link expenses of an approved trip.">
            <Select
              value={tripId}
              onChange={(e) => {
                setTripId(e.target.value);
              }}
              options={[
                { value: '', label: '— None —' },
                ...approvedTrips.map((t) => ({
                  value: t.id,
                  label: `${t.purpose} (${t.startDate})`,
                })),
              ]}
            />
          </FormField>
        </FormGrid>
        {rows.map((r, i) => (
          <fieldset
            key={i}
            className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-6"
            aria-label={`Item ${String(i + 1)}`}
          >
            <FormField label="Category" required className="md:col-span-2">
              <Select
                value={r.categoryId}
                placeholder="Select…"
                options={options}
                onChange={(e) => {
                  set(i, { categoryId: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Date" required>
              <Input
                type="date"
                value={r.date}
                onChange={(e) => {
                  set(i, { date: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Days">
              <Input
                inputMode="numeric"
                value={r.days}
                onChange={(e) => {
                  set(i, { days: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Currency">
              <Input
                value={r.currency}
                onChange={(e) => {
                  set(i, { currency: e.target.value.toUpperCase() });
                }}
              />
            </FormField>
            <FormField label="Amount" required>
              <Input
                inputMode="decimal"
                value={r.originalAmount}
                onChange={(e) => {
                  set(i, { originalAmount: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Description" required className="md:col-span-2">
              <Input
                value={r.description}
                onChange={(e) => {
                  set(i, { description: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Merchant">
              <Input
                value={r.merchant}
                onChange={(e) => {
                  set(i, { merchant: e.target.value });
                }}
              />
            </FormField>
            {r.currency !== currency ? (
              <FormField
                label={`Rate to ${currency}`}
                required
                description="As on your bill or card statement."
              >
                <Input
                  inputMode="decimal"
                  value={r.exchangeRate}
                  onChange={(e) => {
                    set(i, { exchangeRate: e.target.value });
                  }}
                />
              </FormField>
            ) : null}
            <FormField
              label="Justification"
              description="Needed when an item is over a policy limit."
              className="md:col-span-2"
            >
              <Input
                value={r.justification}
                onChange={(e) => {
                  set(i, { justification: e.target.value });
                }}
              />
            </FormField>
            <div className="flex items-end justify-end">
              <Button
                variant="ghost"
                size="sm"
                disabled={rows.length === 1}
                onClick={() => {
                  setRows((rs) => rs.filter((_, j) => j !== i));
                }}
              >
                <X /> Remove item
              </Button>
            </div>
          </fieldset>
        ))}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRows((rs) => [...rs, blankRow(currency)]);
            }}
          >
            <Plus /> Add item
          </Button>
          <Button
            size="sm"
            disabled={save.isPending}
            onClick={() => {
              const body = {
                title,
                tripId: tripId || null,
                items: rows.map((r) => ({
                  ...r,
                  days: Number(r.days || '1'),
                  merchant: r.merchant || null,
                  justification: r.justification || null,
                  exchangeRate: r.currency === currency ? '1' : r.exchangeRate,
                })),
              };
              const parsed = expenseClaimSchema.safeParse(body);
              if (!parsed.success) {
                const issue = parsed.error.issues[0];
                setError(
                  issue
                    ? `${issue.path.join(' › ') || 'Claim'}: ${issue.message}`
                    : 'Check the claim',
                );
                return;
              }
              save.mutate(body);
            }}
          >
            Save draft
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptControl({
  claim,
  itemId,
  receipt,
  editable,
}: {
  claim: ExpenseClaimDetails;
  itemId: string;
  receipt: { fileName: string } | null;
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      await authorizedFetch(`/expense-claims/${claim.id}/items/${itemId}/receipt`, {
        method: 'POST',
        body: form,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPEND }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {receipt ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={() =>
            void saveDownload(
              `/expense-claims/${claim.id}/items/${itemId}/receipt`,
              receipt.fileName,
            )
          }
        >
          <Paperclip className="size-3" /> {receipt.fileName}
        </Button>
      ) : (
        <span className="text-muted-foreground">No receipt</span>
      )}
      {editable ? (
        <label className="cursor-pointer text-sm text-primary hover:underline">
          {receipt ? 'Replace' : 'Attach receipt'}
          <input
            type="file"
            className="sr-only"
            aria-label={`Receipt for item ${itemId}`}
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
            }}
          />
        </label>
      ) : null}
      {error ? <span className="text-destructive">{error}</span> : null}
    </span>
  );
}

function FinancePanel({ claim }: { claim: ExpenseClaimDetails }) {
  const queryClient = useQueryClient();
  const [approved, setApproved] = useState<Record<string, string>>(
    Object.fromEntries(claim.items.map((i) => [i.id, i.amount])),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [payout, setPayout] = useState('PAYROLL');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (body: object) => api.post(`/expense-claims/${claim.id}/finance-decision`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPEND }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finance verification</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {claim.items.map((i, n) => (
          <div key={i.id} className="grid items-end gap-2 md:grid-cols-[1fr_9rem_1fr]">
            <span className="text-sm">
              {n + 1}. {i.description} · claimed {amount(i.amount)}
            </span>
            <FormField label="Approve">
              <Input
                aria-label={`Approved amount for item ${String(n + 1)}`}
                value={approved[i.id] ?? ''}
                onChange={(e) => {
                  setApproved({ ...approved, [i.id]: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Note">
              <Input
                aria-label={`Note for item ${String(n + 1)}`}
                value={notes[i.id] ?? ''}
                onChange={(e) => {
                  setNotes({ ...notes, [i.id]: e.target.value });
                }}
              />
            </FormField>
          </div>
        ))}
        <FormGrid columns={2}>
          <FormField label="Pay">
            <Select
              value={payout}
              onChange={(e) => {
                setPayout(e.target.value);
              }}
              options={[
                { value: 'PAYROLL', label: 'With the next payroll' },
                { value: 'EXTERNAL', label: 'Outside payroll (mark paid later)' },
              ]}
            />
          </FormField>
          <FormField label="Comment" description="Required to reject.">
            <Input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </FormField>
        </FormGrid>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={decide.isPending}
            onClick={() => {
              decide.mutate({
                decision: 'APPROVED',
                payoutMethod: payout,
                note: note || null,
                items: claim.items
                  .filter((i) => approved[i.id] !== i.amount)
                  .map((i) => ({
                    itemId: i.id,
                    approvedAmount: approved[i.id] ?? i.amount,
                    note: notes[i.id] || null,
                  })),
              });
            }}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending || !note}
            onClick={() => {
              decide.mutate({ decision: 'REJECTED', note });
            }}
          >
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ClaimPage() {
  const { id = '' } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const claim = useClaim(isNew ? '' : id);
  const categories = useExpenseCategories();
  const settings = useExpenseSettings();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { path: string; body?: object }) =>
      api.post(`/expense-claims/${id}/${a.path}`, a.body ?? {}),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: SPEND });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const currency = settings.data?.currency ?? 'INR';
  if (isNew)
    return (
      <Page>
        <PageHeader title="New expense claim" />
        {categories.isPending ? (
          <Skeleton className="h-40" />
        ) : (
          <ClaimEditor
            claim={null}
            categories={categories.data ?? []}
            currency={currency}
            onSaved={(newId) => void navigate(`/expenses/claims/${newId}`, { replace: true })}
          />
        )}
      </Page>
    );
  if (claim.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (claim.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(claim.error)} />
      </Page>
    );
  const c = claim.data;
  return (
    <Page>
      <PageHeader
        title={c.title}
        description={`${c.employee.displayName}${c.trip ? ` · trip: ${c.trip.purpose}` : ''}${c.approver ? ` · manager: ${c.approver.displayName}` : ''}`}
        actions={
          <>
            <ClaimStatus status={c.status} />
            {c.can.edit && !editing ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditing(true);
                }}
              >
                Edit
              </Button>
            ) : null}
            {c.can.submit ? (
              <Button
                size="sm"
                disabled={act.isPending}
                onClick={() => {
                  act.mutate({ path: 'submit' });
                }}
              >
                Submit
              </Button>
            ) : null}
            {c.can.cancel ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  act.mutate({ path: 'cancel' });
                }}
              >
                Cancel claim
              </Button>
            ) : null}
            {c.can.reopen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  act.mutate({ path: 'reopen' });
                }}
              >
                Reopen to edit
              </Button>
            ) : null}
            {c.can.markPaid ? (
              <Button
                size="sm"
                onClick={() => {
                  setPaying(true);
                }}
              >
                Mark paid
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
      {c.decisionNote ? (
        <Alert tone={c.status === 'REJECTED' ? 'destructive' : 'info'} className="mb-3">
          {c.decisionNote}
        </Alert>
      ) : null}
      {c.status === 'DRAFT' && c.issues.length ? (
        <Alert tone="warning" className="mb-3">
          <ul aria-label="Policy issues">
            {c.issues.map((x, i) => (
              <li key={i}>
                Item {x.item + 1}: {x.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {editing && c.can.edit ? (
        <div className="mb-4">
          <ClaimEditor
            claim={c}
            categories={categories.data ?? []}
            currency={currency}
            onSaved={() => {
              setEditing(false);
            }}
          />
        </div>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
            <span className="ml-auto text-sm">
              Claimed {amount(c.totalClaimed, currency)}
              {c.totalApproved ? ` · approved ${amount(c.totalApproved, currency)}` : ''}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm" aria-label="Claim items">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-normal">Item</th>
                  <th className="px-4 py-2 font-normal">Receipt</th>
                  <th className="px-4 py-2 text-right font-normal">Amount</th>
                  <th className="px-4 py-2 text-right font-normal">Approved</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id} className="border-t border-border align-top">
                    <td className="px-4 py-2">
                      <span className="font-medium">{i.description}</span>
                      <span className="block text-muted-foreground">
                        {i.category.name} · {i.date}
                        {i.days > 1 ? ` · ${String(i.days)} days` : ''}
                        {i.merchant ? ` · ${i.merchant}` : ''}
                        {i.currency !== currency
                          ? ` · ${amount(i.originalAmount, i.currency)} @ ${i.exchangeRate}`
                          : ''}
                      </span>
                      {i.justification ? (
                        <span className="block">Justification: {i.justification}</span>
                      ) : null}
                      {i.issues.map((x) => (
                        <span key={x.code} className="block text-warning">
                          {x.message.replace(' — add a justification', '')}
                        </span>
                      ))}
                      {i.financeNote ? (
                        <span className="block text-muted-foreground">
                          Finance: {i.financeNote}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">
                      <ReceiptControl
                        claim={c}
                        itemId={i.id}
                        receipt={i.receipt}
                        editable={c.can.edit}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">{amount(i.amount, currency)}</td>
                    <td className="px-4 py-2 text-right">{amount(i.approvedAmount, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          {c.can.managerDecide ? (
            <Card>
              <CardHeader>
                <CardTitle>Your approval</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Textarea
                  aria-label="Comment"
                  placeholder="Comment (required to reject)"
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      act.mutate({
                        path: 'manager-decision',
                        body: { decision: 'APPROVED', note: note || null },
                      });
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!note}
                    onClick={() => {
                      act.mutate({
                        path: 'manager-decision',
                        body: { decision: 'REJECTED', note },
                      });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          {c.can.financeDecide ? <FinancePanel claim={c} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2 text-sm" aria-label="Claim history">
                {c.events.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{CLAIM_LABEL[e.toStatus]}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {new Date(e.at).toLocaleString()}
                      {e.actor ? ` · ${e.actor}` : ''}
                    </span>
                    {e.note ? <span className="block">{e.note}</span> : null}
                  </li>
                ))}
              </ol>
              {c.paidReference ? (
                <p className="mt-2 text-sm">
                  Paid {c.paidOn} · {c.paidReference}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog open={paying} onOpenChange={setPaying}>
        <DialogContent>
          <DialogHeader title="Mark as paid" />
          <ResourceForm
            fields={[
              { name: 'paidOn', label: 'Paid on', kind: 'date', required: true },
              { name: 'reference', label: 'Payment reference', required: true },
            ]}
            defaultValues={{ paidOn: todayIso(), reference: '' }}
            schema={markPaidSchema}
            submit={(body) => api.post(`/expense-claims/${id}/mark-paid`, body)}
            invalidate={[SPEND]}
            submitLabel="Mark paid"
            onDone={() => {
              setPaying(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ approvals & all claims

function ClaimsTable({
  scope,
  status,
  label,
}: {
  scope: 'approvals' | 'all';
  status?: string;
  label: string;
}) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const claims = useClaims({
    scope,
    status,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  });
  const columns = useMemo(() => claimColumns(true), []);
  return (
    <DataTable
      aria-label={label}
      mode="server"
      columns={columns}
      data={claims.data?.items ?? []}
      getRowId={(r) => r.id}
      rowCount={claims.data?.pagination.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={claims.isPending}
      error={claims.isError ? errorMessage(claims.error) : null}
      emptyTitle="Nothing here"
    />
  );
}

export function ExpenseApprovalsPage() {
  const canVerify = usePermission(P.EXPENSES_CLAIM_VERIFY);
  const canRead = usePermission(P.EXPENSES_CLAIM_READ);
  return (
    <Page>
      <PageHeader
        title="Expense approvals"
        description="Claims of your team awaiting you, and — for finance — claims awaiting verification and payment."
      />
      <Tabs defaultValue="team">
        <TabsList aria-label="Approval queues">
          <TabsTrigger value="team">My team</TabsTrigger>
          {canVerify ? <TabsTrigger value="finance">Finance verification</TabsTrigger> : null}
          {canVerify ? <TabsTrigger value="payout">To pay outside payroll</TabsTrigger> : null}
          {canRead || canVerify ? <TabsTrigger value="all">All claims</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="team">
          <ClaimsTable scope="approvals" label="Team claims awaiting approval" />
        </TabsContent>
        <TabsContent value="finance">
          {canVerify ? (
            <ClaimsTable scope="all" status="MANAGER_APPROVED" label="Claims awaiting finance" />
          ) : null}
        </TabsContent>
        <TabsContent value="payout">
          {canVerify ? (
            <ClaimsTable scope="all" status="FINANCE_APPROVED" label="Approved claims to pay" />
          ) : null}
        </TabsContent>
        <TabsContent value="all">
          {canRead || canVerify ? <ClaimsTable scope="all" label="All expense claims" /> : null}
        </TabsContent>
      </Tabs>
    </Page>
  );
}

// ------------------------------------------------------------------------------ setup

const categoryFields: FieldDef[] = [
  { name: 'code', label: 'Code', required: true, createOnly: true },
  { name: 'name', label: 'Name', required: true },
  { name: 'maxPerItem', label: 'Limit per item', description: 'Blank = no limit.' },
  { name: 'maxPerMonth', label: 'Limit per employee per month', description: 'Blank = no limit.' },
  {
    name: 'dailyLimit',
    label: 'Limit per day',
    description: 'For allowances claimed for several days.',
  },
  {
    name: 'receiptRequiredAbove',
    label: 'Receipt required above',
    description: 'Blank = never; 0 = always.',
  },
  { name: 'taxable', label: 'Taxable when reimbursed through payroll', kind: 'checkbox' },
  { name: 'description', label: 'Description', kind: 'textarea' },
];

function SettingsCard() {
  const settings = useExpenseSettings();
  const queryClient = useQueryClient();
  const [v, setV] = useState<{ claimWindowDays: string; defaultPayoutMethod: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.put('/expenses/settings', body),
    onSuccess: async () => {
      setMessage('Saved.');
      setV(null);
      await queryClient.invalidateQueries({ queryKey: SPEND });
    },
    onError: (e) => {
      setMessage(errorMessage(e));
    },
  });
  if (!settings.data) return <Skeleton className="h-24" />;
  const cur = v ?? {
    claimWindowDays: settings.data.claimWindowDays ? String(settings.data.claimWindowDays) : '',
    defaultPayoutMethod: settings.data.defaultPayoutMethod,
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Claim settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {message ? <Alert tone="info">{message}</Alert> : null}
        <FormGrid columns={2}>
          <FormField
            label="Claim window (days)"
            description="Expenses older than this cannot be claimed. Blank = no window."
          >
            <Input
              inputMode="numeric"
              value={cur.claimWindowDays}
              onChange={(e) => {
                setV({ ...cur, claimWindowDays: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Default payout">
            <Select
              value={cur.defaultPayoutMethod}
              onChange={(e) => {
                setV({ ...cur, defaultPayoutMethod: e.target.value });
              }}
              options={[
                { value: 'PAYROLL', label: 'With payroll' },
                { value: 'EXTERNAL', label: 'Outside payroll' },
              ]}
            />
          </FormField>
        </FormGrid>
        <div>
          <Button
            size="sm"
            disabled={!v || save.isPending}
            onClick={() => {
              const body = {
                claimWindowDays: cur.claimWindowDays ? Number(cur.claimWindowDays) : null,
                defaultPayoutMethod: cur.defaultPayoutMethod,
              };
              const parsed = expenseSettingsSchema.safeParse(body);
              if (!parsed.success) {
                setMessage(parsed.error.issues[0]?.message ?? 'Check the settings');
                return;
              }
              save.mutate(body);
            }}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ExpenseSetupPage() {
  const categories = useExpenseCategories(true);
  const [dialog, setDialog] = useState<ExpenseCategoryItem | 'new' | null>(null);
  const columns = useMemo<DataTableColumnDef<ExpenseCategoryItem>[]>(
    () => [
      {
        id: 'name',
        header: 'Category',
        size: 200,
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: 'item',
        header: 'Per item',
        size: 110,
        meta: { numeric: true },
        cell: ({ row }) => amount(row.original.maxPerItem),
      },
      {
        id: 'month',
        header: 'Per month',
        size: 110,
        meta: { numeric: true },
        cell: ({ row }) => amount(row.original.maxPerMonth),
      },
      {
        id: 'day',
        header: 'Per day',
        size: 100,
        meta: { numeric: true },
        cell: ({ row }) => amount(row.original.dailyLimit),
      },
      {
        id: 'receipt',
        header: 'Receipt above',
        size: 120,
        meta: { numeric: true },
        cell: ({ row }) =>
          row.original.receiptRequiredAbove === null
            ? 'Never'
            : amount(row.original.receiptRequiredAbove),
      },
      {
        id: 'tax',
        header: 'Taxable',
        size: 80,
        cell: ({ row }) => (row.original.taxable ? 'Yes' : 'No'),
      },
      {
        id: 'status',
        header: 'Status',
        size: 90,
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'ACTIVE' ? 'success' : 'neutral'}>
            {row.original.status.toLowerCase()}
          </Badge>
        ),
      },
      {
        id: 'edit',
        header: '',
        size: 60,
        cell: ({ row }) => (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setDialog(row.original);
            }}
          >
            Edit
          </Button>
        ),
      },
    ],
    [],
  );
  const editing = dialog && dialog !== 'new' ? dialog : null;
  return (
    <Page>
      <PageHeader
        title="Expense setup"
        description="Categories and policy limits are your organization's policy; nothing is pre-filled."
      />
      <div className="flex flex-col gap-4">
        <SettingsCard />
        <DataTable
          aria-label="Expense categories"
          columns={columns}
          data={categories.data ?? []}
          getRowId={(r) => r.id}
          isLoading={categories.isPending}
          emptyTitle="No categories"
          toolbar={
            <Button
              size="sm"
              onClick={() => {
                setDialog('new');
              }}
            >
              <Plus /> New category
            </Button>
          }
        />
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader title={editing ? `Edit ${editing.name}` : 'New expense category'} />
          {dialog ? (
            <ResourceForm
              fields={categoryFields}
              editing={!!editing}
              defaultValues={{
                code: editing?.code ?? '',
                name: editing?.name ?? '',
                maxPerItem: editing?.maxPerItem ?? '',
                maxPerMonth: editing?.maxPerMonth ?? '',
                dailyLimit: editing?.dailyLimit ?? '',
                receiptRequiredAbove: editing?.receiptRequiredAbove ?? '',
                taxable: editing?.taxable ? 'true' : 'false',
                description: editing?.description ?? '',
                status: editing?.status ?? 'ACTIVE',
              }}
              statusOptions={
                editing
                  ? [
                      { value: 'ACTIVE', label: 'Active' },
                      { value: 'INACTIVE', label: 'Inactive' },
                    ]
                  : undefined
              }
              schema={editing ? updateExpenseCategorySchema : expenseCategorySchema}
              submit={(body) =>
                editing
                  ? api.patch(`/expenses/categories/${editing.id}`, body)
                  : api.post('/expenses/categories', body)
              }
              invalidate={[SPEND]}
              submitLabel="Save"
              onDone={() => {
                setDialog(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
