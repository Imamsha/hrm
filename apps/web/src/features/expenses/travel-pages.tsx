import type { TravelRequestItem } from '@hrm/shared-types';
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
  DialogBody,
  DialogContent,
  DialogFooter,
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
import { travelAdvanceSchema, travelBookingSchema, travelRequestSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import { ClaimStatus } from './claim-pages';
import {
  amount,
  SPEND,
  SPEND_VARIANT,
  todayIso,
  useMyTrips,
  useTrip,
  useTrips,
} from './expenses-api';

const P = PERMISSIONS;
const MODES = [
  { value: 'FLIGHT', label: 'Flight' },
  { value: 'TRAIN', label: 'Train' },
  { value: 'BUS', label: 'Bus' },
  { value: 'CAR', label: 'Car' },
  { value: 'OTHER', label: 'Other' },
];

function TripStatus({ status }: { status: string }) {
  return (
    <Badge variant={SPEND_VARIANT[status] ?? (status === 'SUBMITTED' ? 'warning' : 'neutral')}>
      {status === 'SUBMITTED' ? 'awaiting approval' : status.toLowerCase()}
    </Badge>
  );
}

function tripColumns(showEmployee: boolean): DataTableColumnDef<TravelRequestItem>[] {
  return [
    {
      id: 'purpose',
      header: 'Trip',
      size: 240,
      cell: ({ row }) => (
        <Link
          to={`/travel/trips/${row.original.id}`}
          className="font-medium text-primary hover:underline"
        >
          {row.original.purpose}
        </Link>
      ),
    },
    ...(showEmployee
      ? [
          {
            id: 'employee',
            header: 'Traveller',
            size: 170,
            cell: ({ row }: { row: { original: TravelRequestItem } }) =>
              row.original.employee.displayName,
          },
        ]
      : []),
    {
      id: 'dates',
      header: 'Dates',
      size: 200,
      cell: ({ row }) => `${row.original.startDate} → ${row.original.endDate}`,
    },
    {
      id: 'route',
      header: 'Route',
      size: 220,
      cell: ({ row }) => row.original.legs.map((l) => `${l.from}→${l.to}`).join(', '),
    },
    {
      id: 'advance',
      header: 'Advance asked',
      size: 120,
      meta: { numeric: true },
      cell: ({ row }) => amount(row.original.advanceRequested),
    },
    {
      id: 'status',
      header: 'Status',
      size: 140,
      cell: ({ row }) => <TripStatus status={row.original.status} />,
    },
  ];
}

function TripForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    purpose: '',
    startDate: todayIso(),
    endDate: todayIso(),
    estimatedCost: '',
    advanceRequested: '',
    notes: '',
  });
  const [legs, setLegs] = useState([{ from: '', to: '', departOn: todayIso(), mode: 'FLIGHT' }]);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: object) => api.post('/me/trips', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SPEND });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Purpose" required className="sm:col-span-2">
            <Input
              value={v.purpose}
              onChange={(e) => {
                setV({ ...v, purpose: e.target.value });
              }}
            />
          </FormField>
          <FormField label="From date" required>
            <Input
              type="date"
              value={v.startDate}
              onChange={(e) => {
                setV({ ...v, startDate: e.target.value });
              }}
            />
          </FormField>
          <FormField label="To date" required>
            <Input
              type="date"
              value={v.endDate}
              onChange={(e) => {
                setV({ ...v, endDate: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Estimated cost">
            <Input
              value={v.estimatedCost}
              onChange={(e) => {
                setV({ ...v, estimatedCost: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Advance needed">
            <Input
              value={v.advanceRequested}
              onChange={(e) => {
                setV({ ...v, advanceRequested: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        {legs.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_9rem_8rem_auto] items-center gap-2">
            <Input
              aria-label={`Leg ${String(i + 1)} from`}
              placeholder="From"
              value={l.from}
              onChange={(e) => {
                setLegs(legs.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)));
              }}
            />
            <Input
              aria-label={`Leg ${String(i + 1)} to`}
              placeholder="To"
              value={l.to}
              onChange={(e) => {
                setLegs(legs.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)));
              }}
            />
            <Input
              type="date"
              aria-label={`Leg ${String(i + 1)} date`}
              value={l.departOn}
              onChange={(e) => {
                setLegs(legs.map((x, j) => (j === i ? { ...x, departOn: e.target.value } : x)));
              }}
            />
            <Select
              aria-label={`Leg ${String(i + 1)} mode`}
              value={l.mode}
              options={MODES}
              onChange={(e) => {
                setLegs(legs.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)));
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove leg ${String(i + 1)}`}
              disabled={legs.length === 1}
              onClick={() => {
                setLegs(legs.filter((_, j) => j !== i));
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
              setLegs([...legs, { from: '', to: '', departOn: v.endDate, mode: 'FLIGHT' }]);
            }}
          >
            <Plus /> Add leg
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
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            const body = {
              ...v,
              legs,
              estimatedCost: v.estimatedCost || null,
              advanceRequested: v.advanceRequested || null,
              notes: v.notes || null,
            };
            const parsed = travelRequestSchema.safeParse(body);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the request');
              return;
            }
            save.mutate(body);
          }}
        >
          Submit request
        </Button>
      </DialogFooter>
    </>
  );
}

export function MyTripsPage() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const trips = useMyTrips({ page: pagination.pageIndex + 1, pageSize: pagination.pageSize });
  const [creating, setCreating] = useState(false);
  const columns = useMemo(() => tripColumns(false), []);
  return (
    <Page>
      <PageHeader
        title="My travel"
        description="Request trips, then claim their expenses; the travel desk books and settles them."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> Request travel
          </Button>
        }
      />
      <DataTable
        aria-label="My trips"
        mode="server"
        columns={columns}
        data={trips.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={trips.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={trips.isPending}
        error={trips.isError ? errorMessage(trips.error) : null}
        emptyTitle="No trips"
      />
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="Request travel" />
          {creating ? (
            <TripForm
              onDone={() => {
                setCreating(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

const bookingFields: FieldDef[] = [
  {
    name: 'type',
    label: 'Type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'FLIGHT', label: 'Flight' },
      { value: 'TRAIN', label: 'Train' },
      { value: 'BUS', label: 'Bus' },
      { value: 'CAB', label: 'Cab' },
      { value: 'HOTEL', label: 'Hotel' },
      { value: 'OTHER', label: 'Other' },
    ],
  },
  { name: 'vendor', label: 'Vendor', required: true },
  { name: 'reference', label: 'Booking reference' },
  { name: 'bookedOn', label: 'Booked on', kind: 'date', required: true },
  { name: 'amount', label: 'Amount', required: true },
  { name: 'paidByCompany', label: 'Paid by the company', kind: 'checkbox' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];
const advanceFields: FieldDef[] = [
  { name: 'amount', label: 'Amount', required: true },
  { name: 'paidOn', label: 'Paid on', kind: 'date', required: true },
  { name: 'reference', label: 'Payment reference', required: true },
];

export function TripPage() {
  const { id = '' } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const trip = useTrip(id);
  const [dialog, setDialog] = useState<'booking' | 'advance' | 'settle' | null>(null);
  const [note, setNote] = useState('');
  const [recovery, setRecovery] = useState('PAYROLL');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (a: { path: string; body?: object }) =>
      api.post(`/trips/${id}/${a.path}`, a.body ?? {}),
    onSuccess: async () => {
      setError(null);
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: SPEND });
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (trip.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (trip.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(trip.error)} />
      </Page>
    );
  const t = trip.data;
  const s = t.settlement;
  return (
    <Page>
      <PageHeader
        title={t.purpose}
        description={`${t.employee.displayName} · ${t.startDate} → ${t.endDate}${t.approver ? ` · manager: ${t.approver.displayName}` : ''}`}
        actions={
          <>
            <TripStatus status={t.status} />
            {t.can.cancel ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  act.mutate({ path: 'cancel' });
                }}
              >
                Cancel
              </Button>
            ) : null}
            {t.can.desk ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialog('booking');
                  }}
                >
                  Add booking
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialog('advance');
                  }}
                >
                  Record advance
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setDialog('settle');
                  }}
                >
                  Settle trip
                </Button>
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
      {t.decisionNote ? (
        <Alert tone={t.status === 'REJECTED' ? 'destructive' : 'info'} className="mb-3">
          {t.decisionNote}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Itinerary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-border text-sm" aria-label="Itinerary">
                {t.legs.map((l, i) => (
                  <li key={i} className="px-4 py-2">
                    {l.departOn} · {l.from} → {l.to} · {l.mode.toLowerCase()}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Bookings</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {t.bookings.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="Bookings">
                  {t.bookings.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 px-4 py-2">
                      <span className="min-w-0 flex-1">
                        {b.type.toLowerCase()} · {b.vendor}
                        {b.reference ? ` · ${b.reference}` : ''} · {b.bookedOn}
                      </span>
                      <span>{amount(b.amount)}</span>
                      <span className="text-muted-foreground">
                        {b.paidByCompany ? 'company paid' : 'traveller paid'}
                      </span>
                      {t.can.desk ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            void api
                              .delete(`/trips/${id}/bookings/${b.id}`)
                              .then(() => queryClient.invalidateQueries({ queryKey: SPEND }))
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No bookings recorded.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Expense claims</CardTitle>
              {t.status === 'APPROVED' ? (
                <Button size="xs" variant="outline" className="ml-auto" asChild>
                  <Link to="/expenses/claims/new">New claim</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {t.claims.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="Trip claims">
                  {t.claims.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                      <Link
                        to={`/expenses/claims/${c.id}`}
                        className="min-w-0 flex-1 text-primary hover:underline"
                      >
                        {c.title}
                      </Link>
                      <span>{amount(c.totalApproved ?? c.totalClaimed)}</span>
                      <ClaimStatus status={c.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  No claims linked to this trip yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          {t.can.decide ? (
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
                        path: 'decision',
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
                      act.mutate({ path: 'decision', body: { decision: 'REJECTED', note } });
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Settlement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm" aria-label="Settlement">
              <p>Advances paid: {amount(s.advances)}</p>
              {t.advances.map((a) => (
                <p key={a.id} className="pl-3 text-muted-foreground">
                  {a.paidOn} · {amount(a.amount)} · {a.reference}
                </p>
              ))}
              <p>Approved claims to settle: {amount(s.claimed)}</p>
              <p className="font-semibold">
                {t.status === 'SETTLED'
                  ? `Settled: ${amount(t.settlementBalance)}${t.recoveryMethod ? ` via ${t.recoveryMethod === 'PAYROLL' ? 'payroll' : (t.recoveryReference ?? 'payment')}` : ''}`
                  : s.direction === 'PAYABLE'
                    ? `Payable to traveller: ${amount(s.balance)}`
                    : s.direction === 'RECOVERABLE'
                      ? `To recover from traveller: ${amount(s.balance.replace('-', ''))}`
                      : 'Nothing to settle'}
              </p>
              {s.pendingClaims ? (
                <p className="text-warning">
                  {s.pendingClaims} claim(s) still awaiting a decision.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          {dialog === 'booking' ? (
            <>
              <DialogHeader title="Add booking" />
              <ResourceForm
                fields={bookingFields}
                defaultValues={{
                  type: '',
                  vendor: '',
                  reference: '',
                  bookedOn: todayIso(),
                  amount: '',
                  paidByCompany: 'true',
                  notes: '',
                }}
                schema={travelBookingSchema}
                submit={(body) => api.post(`/trips/${id}/bookings`, body)}
                invalidate={[SPEND]}
                submitLabel="Add"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'advance' ? (
            <>
              <DialogHeader title="Record advance" />
              <ResourceForm
                fields={advanceFields}
                defaultValues={{
                  amount: t.advanceRequested ?? '',
                  paidOn: todayIso(),
                  reference: '',
                }}
                schema={travelAdvanceSchema}
                submit={(body) => api.post(`/trips/${id}/advances`, body)}
                invalidate={[SPEND]}
                submitLabel="Record"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'settle' ? (
            <>
              <DialogHeader
                title="Settle trip"
                description="Approved trip claims are reimbursed against the advances; only the balance is paid or recovered."
              />
              <DialogBody className="flex flex-col gap-3">
                <p className="text-sm">
                  Balance: <strong>{amount(s.balance)}</strong> ({s.direction.toLowerCase()})
                </p>
                {s.direction !== 'SETTLED' ? (
                  <FormGrid columns={2}>
                    <FormField
                      label={s.direction === 'PAYABLE' ? 'Pay the balance' : 'Recover the balance'}
                    >
                      <Select
                        value={recovery}
                        onChange={(e) => {
                          setRecovery(e.target.value);
                        }}
                        options={[
                          { value: 'PAYROLL', label: 'Through the next payroll' },
                          { value: 'REPAID', label: 'Already settled (enter reference)' },
                        ]}
                      />
                    </FormField>
                    {recovery === 'REPAID' ? (
                      <FormField label="Reference" required>
                        <Input
                          value={reference}
                          onChange={(e) => {
                            setReference(e.target.value);
                          }}
                        />
                      </FormField>
                    ) : null}
                  </FormGrid>
                ) : null}
              </DialogBody>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialog(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={act.isPending}
                  onClick={() => {
                    act.mutate({
                      path: 'settle',
                      body:
                        s.direction === 'SETTLED' ? {} : { recovery, reference: reference || null },
                    });
                  }}
                >
                  Settle
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function TripsTable({
  scope,
  label,
  status,
}: {
  scope: 'approvals' | 'all';
  label: string;
  status?: string;
}) {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const trips = useTrips({
    scope,
    status,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
  });
  const columns = useMemo(() => tripColumns(true), []);
  return (
    <DataTable
      aria-label={label}
      mode="server"
      columns={columns}
      data={trips.data?.items ?? []}
      getRowId={(r) => r.id}
      rowCount={trips.data?.pagination.total ?? 0}
      pagination={pagination}
      onPaginationChange={setPagination}
      isLoading={trips.isPending}
      error={trips.isError ? errorMessage(trips.error) : null}
      emptyTitle="Nothing here"
    />
  );
}

export function TravelRequestsPage() {
  const canRead = usePermission(P.TRAVEL_REQUEST_READ);
  const canDesk = usePermission(P.TRAVEL_DESK_MANAGE);
  const canAll = canRead || canDesk;
  return (
    <Page>
      <PageHeader
        title="Travel requests"
        description="Trips awaiting your approval and, for the travel desk, every trip to book, advance and settle."
      />
      <Tabs defaultValue="approvals">
        <TabsList aria-label="Travel queues">
          <TabsTrigger value="approvals">Awaiting me</TabsTrigger>
          {canAll ? <TabsTrigger value="open">Approved trips</TabsTrigger> : null}
          {canAll ? <TabsTrigger value="all">All trips</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="approvals">
          <TripsTable scope="approvals" label="Trips awaiting approval" />
        </TabsContent>
        <TabsContent value="open">
          {canAll ? <TripsTable scope="all" status="APPROVED" label="Approved trips" /> : null}
        </TabsContent>
        <TabsContent value="all">
          {canAll ? <TripsTable scope="all" label="All trips" /> : null}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
