import type { AssetItem, SoftwareLicenseItem } from '@hrm/shared-types';
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
  EmptyState,
  ErrorState,
  type PaginationState,
  Select,
  Skeleton,
} from '@hrm/ui-web';
import {
  assetAllocationSchema,
  assetCategorySchema,
  assetReturnSchema,
  assetSchema,
  assetStatusSchema,
  licenseAssignmentSchema,
  maintenanceSchema,
  softwareLicenseSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  amount,
  SPEND,
  SPEND_VARIANT,
  todayIso,
  useAsset,
  useAssetCategories,
  useAssets,
  useLicenses,
  useMyAssets,
} from './expenses-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'IN_STOCK', label: 'In stock' },
  { value: 'ALLOCATED', label: 'Allocated' },
  { value: 'IN_REPAIR', label: 'In repair' },
  { value: 'RETIRED', label: 'Retired' },
  { value: 'LOST', label: 'Lost' },
];
const label = (s: string) => s.toLowerCase().replace('_', ' ');

export function AssetStatus({ status }: { status: string }) {
  return <Badge variant={SPEND_VARIANT[status] ?? 'neutral'}>{label(status)}</Badge>;
}

const assetFields: FieldDef[] = [
  { name: 'tag', label: 'Asset tag', required: true, createOnly: true },
  { name: 'name', label: 'Name', required: true },
  {
    name: 'categoryId',
    label: 'Category',
    kind: 'ref',
    required: true,
    createOnly: true,
    ref: { path: '/assets/categories', paged: false },
  },
  { name: 'serialNumber', label: 'Serial number' },
  { name: 'manufacturer', label: 'Manufacturer' },
  { name: 'model', label: 'Model' },
  { name: 'vendor', label: 'Vendor' },
  { name: 'purchaseDate', label: 'Purchase date', kind: 'date' },
  { name: 'purchaseCost', label: 'Purchase cost' },
  { name: 'warrantyEnd', label: 'Warranty until', kind: 'date' },
  { name: 'locationId', label: 'Location', kind: 'ref', ref: { path: '/locations' } },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];
const categoryFields: FieldDef[] = [
  { name: 'code', label: 'Code', required: true },
  { name: 'name', label: 'Name', required: true },
  {
    name: 'usefulLifeMonths',
    label: 'Useful life (months)',
    kind: 'number',
    description: 'For an informational book value; blank = not depreciated.',
  },
  { name: 'salvagePercent', label: 'Salvage value (% of cost)' },
];

export function AssetsPage() {
  const canManage = usePermission(P.ASSETS_ASSET_MANAGE);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const assets = useAssets({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    status: status || undefined,
    search: search || undefined,
  });
  const categories = useAssetCategories();
  const [dialog, setDialog] = useState<'asset' | 'category' | null>(null);
  const columns = useMemo<DataTableColumnDef<AssetItem>[]>(
    () => [
      {
        id: 'tag',
        header: 'Tag',
        size: 120,
        cell: ({ row }) => (
          <Link
            to={`/assets/${row.original.id}`}
            className="font-mono text-primary hover:underline"
          >
            {row.original.tag}
          </Link>
        ),
      },
      { id: 'name', header: 'Asset', size: 220, cell: ({ row }) => row.original.name },
      {
        id: 'category',
        header: 'Category',
        size: 140,
        cell: ({ row }) => row.original.category.name,
      },
      {
        id: 'serial',
        header: 'Serial',
        size: 140,
        cell: ({ row }) => row.original.serialNumber ?? '—',
      },
      {
        id: 'holder',
        header: 'With',
        size: 170,
        cell: ({ row }) => row.original.holder?.displayName ?? '—',
      },
      {
        id: 'value',
        header: 'Book value',
        size: 120,
        meta: { numeric: true },
        cell: ({ row }) => amount(row.original.bookValue),
      },
      {
        id: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) => <AssetStatus status={row.original.status} />,
      },
    ],
    [],
  );
  return (
    <Page>
      <PageHeader
        title="Assets"
        description="Laptops, phones and equipment: who has what, in what condition, and its history."
        actions={
          canManage ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setDialog('category');
                }}
              >
                <Plus /> Category
              </Button>
              <Button
                onClick={() => {
                  setDialog('asset');
                }}
                disabled={!categories.data?.length}
              >
                <Plus /> Register asset
              </Button>
            </>
          ) : null
        }
      />
      {categories.data && !categories.data.length && canManage ? (
        <Alert tone="info" className="mb-3">
          Create an asset category first.
        </Alert>
      ) : null}
      <DataTable
        aria-label="Assets"
        mode="server"
        columns={columns}
        data={assets.data?.items ?? []}
        getRowId={(r) => r.id}
        rowCount={assets.data?.pagination.total ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        isLoading={assets.isPending}
        isFetching={assets.isFetching}
        error={assets.isError ? errorMessage(assets.error) : null}
        emptyTitle="No assets"
        toolbar={
          <>
            <input
              aria-label="Search assets"
              placeholder="Tag, name or serial"
              className="h-7 rounded-md border border-border bg-background px-2 text-sm"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
            />
            <Select
              aria-label="Filter by status"
              className="h-7 w-36"
              value={status}
              options={STATUS_OPTIONS}
              onChange={(e) => {
                setStatus(e.target.value);
                setPagination((p) => ({ ...p, pageIndex: 0 }));
              }}
            />
          </>
        }
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent size={dialog === 'asset' ? 'lg' : undefined}>
          {dialog === 'asset' ? (
            <>
              <DialogHeader title="Register asset" />
              <ResourceForm
                fields={assetFields}
                defaultValues={{
                  tag: '',
                  name: '',
                  categoryId: '',
                  serialNumber: '',
                  manufacturer: '',
                  model: '',
                  vendor: '',
                  purchaseDate: '',
                  purchaseCost: '',
                  warrantyEnd: '',
                  locationId: '',
                  notes: '',
                }}
                schema={assetSchema}
                submit={(body) => api.post('/assets', body)}
                invalidate={[SPEND]}
                submitLabel="Register"
                onDone={() => {
                  setDialog(null);
                }}
              />
            </>
          ) : dialog === 'category' ? (
            <>
              <DialogHeader title="New asset category" />
              <ResourceForm
                fields={categoryFields}
                defaultValues={{ code: '', name: '', usefulLifeMonths: '', salvagePercent: '' }}
                schema={assetCategorySchema}
                submit={(body) => api.post('/assets/categories', body)}
                invalidate={[SPEND]}
                submitLabel="Create"
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

const allocateFields: FieldDef[] = [
  {
    name: 'employeeId',
    label: 'Employee',
    kind: 'ref',
    required: true,
    ref: employeeRef,
    refParams: { status: 'ACTIVE' },
    wide: true,
  },
  { name: 'allocatedOn', label: 'Handed over on', kind: 'date', required: true },
  { name: 'expectedReturnOn', label: 'Expected return', kind: 'date' },
  { name: 'conditionNote', label: 'Condition at handover', kind: 'textarea' },
];
const returnFields: FieldDef[] = [
  { name: 'returnedOn', label: 'Returned on', kind: 'date', required: true },
  {
    name: 'condition',
    label: 'Condition',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'GOOD', label: 'Good' },
      { value: 'DAMAGED', label: 'Damaged' },
      { value: 'LOST', label: 'Lost' },
    ],
  },
  {
    name: 'toStatus',
    label: 'Move to',
    kind: 'select',
    required: true,
    options: [
      { value: 'IN_STOCK', label: 'In stock' },
      { value: 'IN_REPAIR', label: 'In repair' },
      { value: 'RETIRED', label: 'Retired' },
    ],
  },
  { name: 'note', label: 'Note', kind: 'textarea' },
];
const statusFields: FieldDef[] = [
  {
    name: 'status',
    label: 'Status',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: STATUS_OPTIONS.filter((o) => o.value && o.value !== 'ALLOCATED'),
  },
  { name: 'note', label: 'Reason', kind: 'textarea', required: true },
];
const maintenanceFields: FieldDef[] = [
  { name: 'startedOn', label: 'Started on', kind: 'date', required: true },
  { name: 'completedOn', label: 'Completed on', kind: 'date' },
  { name: 'vendor', label: 'Vendor' },
  { name: 'cost', label: 'Cost' },
  { name: 'description', label: 'Work done', kind: 'textarea', required: true },
];

export function AssetPage() {
  const { id = '' } = useParams<{ id: string }>();
  const canManage = usePermission(P.ASSETS_ASSET_MANAGE);
  const asset = useAsset(id);
  const [dialog, setDialog] = useState<'allocate' | 'return' | 'status' | 'maintenance' | null>(
    null,
  );
  if (asset.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (asset.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(asset.error)} />
      </Page>
    );
  const a = asset.data;
  const forms = {
    allocate: {
      title: 'Allocate asset',
      fields: allocateFields,
      defaults: {
        employeeId: '',
        allocatedOn: todayIso(),
        expectedReturnOn: '',
        conditionNote: '',
      },
      schema: assetAllocationSchema,
      path: 'allocate',
      label: 'Allocate',
    },
    return: {
      title: 'Record return',
      fields: returnFields,
      defaults: { returnedOn: todayIso(), condition: '', toStatus: 'IN_STOCK', note: '' },
      schema: assetReturnSchema,
      path: 'return',
      label: 'Record return',
    },
    status: {
      title: 'Change status',
      fields: statusFields,
      defaults: { status: '', note: '' },
      schema: assetStatusSchema,
      path: 'status',
      label: 'Save',
    },
    maintenance: {
      title: 'Add maintenance',
      fields: maintenanceFields,
      defaults: { startedOn: todayIso(), completedOn: '', vendor: '', cost: '', description: '' },
      schema: maintenanceSchema,
      path: 'maintenance',
      label: 'Add',
    },
  } as const;
  const f = dialog ? forms[dialog] : null;
  return (
    <Page>
      <PageHeader
        title={`${a.tag} · ${a.name}`}
        description={[
          a.category.name,
          a.manufacturer,
          a.model,
          a.serialNumber ? `S/N ${a.serialNumber}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            <AssetStatus status={a.status} />
            {canManage && a.status === 'IN_STOCK' ? (
              <Button
                size="sm"
                onClick={() => {
                  setDialog('allocate');
                }}
              >
                Allocate
              </Button>
            ) : null}
            {canManage && a.status === 'ALLOCATED' ? (
              <Button
                size="sm"
                onClick={() => {
                  setDialog('return');
                }}
              >
                Record return
              </Button>
            ) : null}
            {canManage && a.status !== 'ALLOCATED' && a.status !== 'RETIRED' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog('status');
                }}
              >
                Change status
              </Button>
            ) : null}
            {canManage ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setDialog('maintenance');
                }}
              >
                Add maintenance
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Allocations</CardTitle>
              {a.holder ? (
                <span className="text-sm text-muted-foreground">
                  Now with {a.holder.displayName}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {a.allocations.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="Allocations">
                  {a.allocations.map((x) => (
                    <li key={x.id} className="px-4 py-2">
                      <span className="font-medium">{x.employee.displayName}</span> ·{' '}
                      {x.allocatedOn} → {x.returnedOn ?? 'now'}
                      {x.acknowledgedAt
                        ? ' · acknowledged'
                        : x.returnedOn
                          ? ''
                          : ' · not yet acknowledged'}
                      {x.returnCondition ? ` · returned ${x.returnCondition.toLowerCase()}` : ''}
                      {x.conditionNote ? (
                        <span className="block text-muted-foreground">
                          Handover: {x.conditionNote}
                        </span>
                      ) : null}
                      {x.returnNote ? (
                        <span className="block text-muted-foreground">Return: {x.returnNote}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">Never allocated.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Maintenance</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {a.maintenance.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="Maintenance">
                  {a.maintenance.map((m) => (
                    <li key={m.id} className="px-4 py-2">
                      {m.startedOn} → {m.completedOn ?? 'ongoing'} · {m.description}
                      {m.vendor ? ` · ${m.vendor}` : ''} {m.cost ? `· ${amount(m.cost)}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No maintenance recorded.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Purchased</span>
              <span>{a.purchaseDate ?? '—'}</span>
              <span className="text-muted-foreground">Cost</span>
              <span>{amount(a.purchaseCost)}</span>
              <span className="text-muted-foreground">Book value</span>
              <span>{amount(a.bookValue)}</span>
              <span className="text-muted-foreground">Warranty until</span>
              <span>{a.warrantyEnd ?? '—'}</span>
              <span className="text-muted-foreground">Vendor</span>
              <span>{a.vendor ?? '—'}</span>
              <span className="text-muted-foreground">Location</span>
              <span>{a.location?.name ?? '—'}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-1 text-sm" aria-label="Asset history">
                {a.events.map((e, i) => (
                  <li key={i}>
                    <span className="font-medium">{label(e.type)}</span>
                    {e.employee ? ` · ${e.employee.displayName}` : ''}
                    <span className="text-muted-foreground">
                      {' '}
                      · {new Date(e.at).toLocaleDateString()}
                      {e.actor ? ` · ${e.actor}` : ''}
                    </span>
                    {e.note ? <span className="block text-muted-foreground">{e.note}</span> : null}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
      <Dialog
        open={f !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          {f ? (
            <>
              <DialogHeader title={f.title} />
              <ResourceForm
                fields={f.fields}
                defaultValues={f.defaults}
                schema={f.schema}
                submit={(body) =>
                  f.path === 'status'
                    ? api.put(`/assets/${id}/status`, body)
                    : api.post(`/assets/${id}/${f.path}`, body)
                }
                invalidate={[SPEND]}
                submitLabel={f.label}
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

const licenseFields: FieldDef[] = [
  { name: 'name', label: 'Software', required: true },
  { name: 'vendor', label: 'Vendor' },
  { name: 'seats', label: 'Seats', kind: 'number', required: true },
  { name: 'expiresOn', label: 'Expires on', kind: 'date' },
  { name: 'cost', label: 'Cost' },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];

function LicenseCard({ l }: { l: SoftwareLicenseItem }) {
  const queryClient = useQueryClient();
  const canManage = usePermission(P.ASSETS_LICENSE_MANAGE);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: (assignmentId: string) => api.delete(`/licenses/${l.id}/seats/${assignmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPEND }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{l.name}</CardTitle>
        <span className="text-sm text-muted-foreground">
          {l.vendor ? `${l.vendor} · ` : ''}
          {l.usedSeats}/{l.seats} seats{l.expiresOn ? ` · expires ${l.expiresOn}` : ''}
        </span>
        {canManage && l.usedSeats < l.seats ? (
          <Button
            size="xs"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              setAssigning(true);
            }}
          >
            Assign seat
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <div className="h-1.5 bg-muted" aria-hidden>
          <div
            className="h-1.5 bg-primary"
            style={{ width: `${String(Math.round((l.usedSeats / l.seats) * 100))}%` }}
          />
        </div>
        <ul className="divide-y divide-border text-sm" aria-label={`Seats of ${l.name}`}>
          {l.assignees.map((a) => (
            <li key={a.assignmentId} className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1">{a.employee.displayName}</span>
              <span className="text-muted-foreground">
                since {new Date(a.assignedOn).toLocaleDateString()}
              </span>
              {canManage ? (
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    revoke.mutate(a.assignmentId);
                  }}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
      <Dialog open={assigning} onOpenChange={setAssigning}>
        <DialogContent>
          <DialogHeader title={`Assign a ${l.name} seat`} />
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
            ]}
            defaultValues={{ employeeId: '' }}
            schema={licenseAssignmentSchema}
            submit={(body) => api.post(`/licenses/${l.id}/seats`, body)}
            invalidate={[SPEND]}
            submitLabel="Assign"
            onDone={() => {
              setAssigning(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function LicensesPage() {
  const canManage = usePermission(P.ASSETS_LICENSE_MANAGE);
  const licenses = useLicenses();
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title="Software licences"
        description="Seats per licence; assignments can never exceed the seats bought."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> New licence
            </Button>
          ) : null
        }
      />
      {licenses.isPending ? (
        <Skeleton className="h-32" />
      ) : licenses.isError ? (
        <ErrorState description={errorMessage(licenses.error)} />
      ) : !licenses.data.length ? (
        <EmptyState title="No licences" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {licenses.data.map((l) => (
            <LicenseCard key={l.id} l={l} />
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader title="New licence" />
          <ResourceForm
            fields={licenseFields}
            defaultValues={{ name: '', vendor: '', seats: '', expiresOn: '', cost: '', notes: '' }}
            schema={softwareLicenseSchema}
            submit={(body) => api.post('/licenses', body)}
            invalidate={[SPEND]}
            submitLabel="Create"
            onDone={() => {
              setCreating(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

export function MyAssetsPage() {
  const queryClient = useQueryClient();
  const mine = useMyAssets();
  const ack = useMutation({
    mutationFn: (allocationId: string) => api.post(`/me/assets/${allocationId}/acknowledge`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SPEND }),
  });
  return (
    <Page>
      <PageHeader
        title="My assets"
        description="Equipment and software issued to you. Confirm what you have received."
      />
      {mine.isPending ? (
        <Skeleton className="h-32" />
      ) : mine.isError ? (
        <ErrorState description={errorMessage(mine.error)} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
          <Card>
            <CardHeader>
              <CardTitle>Equipment</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {mine.data.assets.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="My equipment">
                  {mine.data.assets.map((a) => (
                    <li
                      key={a.allocationId}
                      className="flex flex-wrap items-center gap-3 px-4 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="font-mono">{a.tag}</span> · {a.name}
                        <span className="block text-muted-foreground">
                          Since {a.allocatedOn}
                          {a.expectedReturnOn ? ` · return by ${a.expectedReturnOn}` : ''}
                        </span>
                      </span>
                      {a.acknowledgedAt ? (
                        <Badge variant="success">received</Badge>
                      ) : (
                        <Button
                          size="xs"
                          onClick={() => {
                            ack.mutate(a.allocationId);
                          }}
                        >
                          Confirm receipt
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No equipment issued to you.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Software</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {mine.data.licenses.length ? (
                <ul className="divide-y divide-border text-sm" aria-label="My software">
                  {mine.data.licenses.map((l) => (
                    <li key={l.id} className="px-4 py-2">
                      {l.name}
                      {l.vendor ? (
                        <span className="text-muted-foreground"> · {l.vendor}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">No software seats.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </Page>
  );
}
