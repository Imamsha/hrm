import type {
  BankAccountItem,
  EmployeeDetails,
  EmployeeDocumentItem,
  EmploymentRecordItem,
} from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Select,
  Skeleton,
} from '@hrm/ui-web';
import {
  createBankAccountSchema,
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_MAX_BYTES,
  statutoryIdsSchema,
  updateBankAccountSchema,
} from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { ZodType } from 'zod';
import { Link } from 'react-router';
import type { FieldDef } from '@/features/structure/entity-payload';
import { api, errorMessage } from '@/lib/api';
import {
  downloadDocument,
  employeeKeys,
  type ProfileBase,
  uploadDocument,
  useBankAccounts,
  useCollection,
  useDocuments,
  useEmploymentHistory,
  useReports,
  useStatutoryIds,
} from './api';
import type { CollectionDef, Summary } from './collections';
import {
  CHANGE_TYPE_LABEL,
  DOCUMENT_CATEGORY_LABEL,
  EMPLOYMENT_TYPE_LABEL,
  formatDate,
  options,
} from './labels';

/** A form opened in the profile's shared dialog. */
export interface FormRequest {
  title: string;
  description?: string;
  fields: FieldDef[];
  values: Record<string, string>;
  schema: ZodType;
  submit: (body: Record<string, unknown>) => Promise<unknown>;
  submitLabel: string;
}

export interface ConfirmRequest {
  title: string;
  description: string;
  label: string;
  destructive?: boolean;
  run: () => Promise<unknown>;
}

export interface SectionProps {
  profile: ProfileBase;
  employee: EmployeeDetails;
  openForm: (r: FormRequest) => void;
  confirm: (r: ConfirmRequest) => void;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate">{children ?? '—'}</dd>
    </div>
  );
}

function Loading() {
  return <Skeleton className="m-4 h-12" />;
}

// ------------------------------------------------------------------------ job history

export function JobHistory({ profile }: { profile: ProfileBase }) {
  const history = useEmploymentHistory(profile);
  if (history.isPending) return <Loading />;
  if (history.isError) return <ErrorState description={errorMessage(history.error)} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employment history</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ol className="divide-y divide-border" aria-label="Employment history">
          {history.data.map((r: EmploymentRecordItem) => (
            <li key={r.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_1fr]">
              <div>
                <p className="font-medium">{CHANGE_TYPE_LABEL[r.changeType]}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatDate(r.effectiveFrom)} –{' '}
                  {r.effectiveTo ? formatDate(r.effectiveTo) : 'present'}
                </p>
              </div>
              <div className="min-w-0 text-sm">
                <p>
                  {[
                    r.designation?.name,
                    r.jobGrade ? `Grade ${r.jobGrade.name}` : null,
                    EMPLOYMENT_TYPE_LABEL[r.employmentType],
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="text-muted-foreground">
                  {[
                    r.company.name,
                    r.legalEntity?.name,
                    r.branch?.name,
                    r.department?.name,
                    r.team?.name,
                  ]
                    .filter(Boolean)
                    .join(' › ')}
                </p>
                {r.manager ? (
                  <p className="text-muted-foreground">Reports to {r.manager.displayName}</p>
                ) : null}
                {r.remarks ? <p className="mt-1 italic">{r.remarks}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------ collections

export function CollectionSection({
  def,
  profile,
  editable,
  openForm,
  confirm,
}: {
  def: CollectionDef;
  profile: ProfileBase;
  editable: boolean;
  openForm: (r: FormRequest) => void;
  confirm: (r: ConfirmRequest) => void;
}) {
  const items = useCollection<{ id: string }>(profile, def.key);
  const path = `${profile.base}/${def.key}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{def.title}</CardTitle>
        {editable ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              openForm({
                title: `Add ${def.singular}`,
                fields: def.fields,
                values: def.empty,
                schema: def.schema,
                submit: (body) => api.post(path, body),
                submitLabel: 'Add',
              });
            }}
          >
            <Plus /> Add
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {items.isPending ? (
          <Loading />
        ) : items.isError ? (
          <p className="p-4 text-sm text-destructive">{errorMessage(items.error)}</p>
        ) : items.data.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground">None recorded.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label={def.title}>
            {items.data.map((item) => {
              const s: Summary = def.summary(item as never);
              return (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.primary}</p>
                    {s.secondary ? (
                      <p className="truncate text-sm text-muted-foreground">{s.secondary}</p>
                    ) : null}
                  </div>
                  {s.badge ? <Badge variant="outline">{s.badge}</Badge> : null}
                  {editable ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${s.primary}`}
                        onClick={() => {
                          openForm({
                            title: `Edit ${def.singular}`,
                            fields: def.fields,
                            values: def.toValues(item as never),
                            schema: def.schema,
                            submit: (body) => api.patch(`${path}/${item.id}`, body),
                            submitLabel: 'Save',
                          });
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${s.primary}`}
                        onClick={() => {
                          confirm({
                            title: `Delete ${def.singular}?`,
                            description: s.primary,
                            label: 'Delete',
                            destructive: true,
                            run: () => api.delete(`${path}/${item.id}`),
                          });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------ bank & statutory

const bankFields = (creating: boolean): FieldDef[] => [
  { name: 'accountHolderName', label: 'Account holder name', required: true, wide: true },
  { name: 'bankName', label: 'Bank', required: true },
  { name: 'branchName', label: 'Bank branch' },
  { name: 'ifsc', label: 'IFSC', required: true, placeholder: 'HDFC0001234' },
  {
    name: 'accountNumber',
    label: creating ? 'Account number' : 'New account number',
    required: creating,
    omitIfBlank: !creating,
    description: creating ? undefined : 'Leave empty to keep the current number.',
  },
  {
    name: 'accountType',
    label: 'Account type',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'SAVINGS', label: 'Savings' },
      { value: 'CURRENT', label: 'Current' },
    ],
  },
  { name: 'isPrimary', label: 'Primary (salary) account', kind: 'checkbox' },
];

function Revealed({ load, label }: { load: () => Promise<string>; label: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (value) return <span className="font-mono">{value}</span>;
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`Reveal ${label}`}
      onClick={() => {
        load().then(setValue, (e: unknown) => {
          setError(errorMessage(e));
        });
      }}
    >
      <Eye /> {error ?? 'Reveal'}
    </Button>
  );
}

export function BankAndTax({ profile, employee, openForm, confirm }: SectionProps) {
  const canManage = employee.access.sensitiveManage && !profile.self;
  const canReveal = employee.access.sensitive && !profile.self;
  const accounts = useBankAccounts(profile);
  const statutory = useStatutoryIds(profile);
  const path = `${profile.base}/bank-accounts`;
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="info">
        Account numbers, PAN and UAN are encrypted and shown masked. Revealing a full value is
        recorded in the audit log. Aadhaar numbers are not collected.
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Bank accounts</CardTitle>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                openForm({
                  title: 'Add bank account',
                  fields: bankFields(true),
                  values: {
                    accountHolderName: employee.displayName,
                    bankName: '',
                    branchName: '',
                    ifsc: '',
                    accountNumber: '',
                    accountType: '',
                    isPrimary: 'false',
                  },
                  schema: createBankAccountSchema,
                  submit: (body) => api.post(path, body),
                  submitLabel: 'Add account',
                });
              }}
            >
              <Plus /> Add
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {accounts.isPending ? (
            <Loading />
          ) : accounts.isError ? (
            <p className="p-4 text-sm text-destructive">{errorMessage(accounts.error)}</p>
          ) : accounts.data.length === 0 ? (
            <p className="px-4 py-3 text-muted-foreground">No bank account recorded.</p>
          ) : (
            <ul className="divide-y divide-border" aria-label="Bank accounts">
              {accounts.data.map((a: BankAccountItem) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {a.bankName} · <span className="font-mono">{a.accountNumberMasked}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {a.accountHolderName} · {a.ifsc} ·{' '}
                      {a.accountType === 'SAVINGS' ? 'Savings' : 'Current'}
                    </p>
                  </div>
                  {a.isPrimary ? <Badge variant="primary">Primary</Badge> : null}
                  {canReveal ? (
                    <Revealed
                      label={`account ${a.accountNumberMasked}`}
                      load={() =>
                        api
                          .post<{ accountNumber: string }>(`${path}/${a.id}/reveal`)
                          .then((r) => r.accountNumber)
                      }
                    />
                  ) : null}
                  {canManage ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit account ${a.accountNumberMasked}`}
                        onClick={() => {
                          openForm({
                            title: 'Edit bank account',
                            fields: bankFields(false),
                            values: {
                              accountHolderName: a.accountHolderName,
                              bankName: a.bankName,
                              branchName: a.branchName ?? '',
                              ifsc: a.ifsc,
                              accountNumber: '',
                              accountType: a.accountType,
                              isPrimary: String(a.isPrimary),
                            },
                            schema: updateBankAccountSchema,
                            submit: (body) => api.patch(`${path}/${a.id}`, body),
                            submitLabel: 'Save',
                          });
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete account ${a.accountNumberMasked}`}
                        onClick={() => {
                          confirm({
                            title: 'Delete bank account?',
                            description: `${a.bankName} ${a.accountNumberMasked}`,
                            label: 'Delete',
                            destructive: true,
                            run: () => api.delete(`${path}/${a.id}`),
                          });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Statutory identifiers</CardTitle>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                openForm({
                  title: 'Statutory identifiers',
                  description:
                    'Enter only the values to change; empty fields keep their current value.',
                  fields: [
                    { name: 'pan', label: 'PAN', placeholder: 'AAAAA9999A', omitIfBlank: true },
                    {
                      name: 'uan',
                      label: 'UAN (EPF)',
                      placeholder: '12 digits',
                      omitIfBlank: true,
                    },
                  ],
                  values: { pan: '', uan: '' },
                  schema: statutoryIdsSchema,
                  submit: (body) => api.put(`${profile.base}/statutory-ids`, body),
                  submitLabel: 'Save',
                });
              }}
            >
              <Pencil /> Update
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {statutory.isPending ? (
            <Loading />
          ) : statutory.isError ? (
            <p className="text-sm text-destructive">{errorMessage(statutory.error)}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4">
              <Field label="PAN">
                <span className="font-mono">{statutory.data.panMasked ?? '—'}</span>
              </Field>
              <Field label="UAN">
                <span className="font-mono">{statutory.data.uanMasked ?? '—'}</span>
              </Field>
              {canReveal && (statutory.data.panMasked || statutory.data.uanMasked) ? (
                <div className="col-span-2">
                  <Revealed
                    label="PAN and UAN"
                    load={() =>
                      api
                        .post<{ pan: string | null; uan: string | null }>(
                          `${profile.base}/statutory-ids/reveal`,
                        )
                        .then((r) => `PAN ${r.pan ?? '—'} · UAN ${r.uan ?? '—'}`)
                    }
                  />
                </div>
              ) : null}
            </dl>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------------ documents

function UploadForm({ base, onDone }: { base: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: () => uploadDocument(base, file as File, { category, title }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: employeeKeys.base(base) });
      onDone();
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  const submit = () => {
    if (!file) {
      setError('Choose a file');
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setError('Files can be at most 10 MB');
      return;
    }
    if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setError('Only PDF, PNG, JPEG and WebP files are accepted');
      return;
    }
    if (!category) {
      setError('Select a category');
      return;
    }
    if (!title.trim()) {
      setError('Enter a title');
      return;
    }
    setError(null);
    upload.mutate();
  };
  return (
    <div className="flex flex-col gap-3 border-b border-border p-4">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <FormGrid columns={3}>
        <FormField label="File" required>
          <Input
            type="file"
            accept={DOCUMENT_CONTENT_TYPES.join(',')}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </FormField>
        <FormField label="Category" required>
          <Select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
            }}
            options={options(DOCUMENT_CATEGORY_LABEL)}
          />
        </FormField>
        <FormField label="Title" required>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
            }}
          />
        </FormField>
      </FormGrid>
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={upload.isPending} aria-busy={upload.isPending}>
          <Upload /> Upload
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function Documents({ profile, employee, confirm }: SectionProps) {
  const canManage = employee.access.documentsManage && !profile.self;
  const docs = useDocuments(profile);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        {canManage && !uploading ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setUploading(true);
            }}
          >
            <Upload /> Upload
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {uploading ? (
          <UploadForm
            base={profile.base}
            onDone={() => {
              setUploading(false);
            }}
          />
        ) : null}
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {docs.isPending ? (
          <Loading />
        ) : docs.isError ? (
          <p className="p-4 text-sm text-destructive">{errorMessage(docs.error)}</p>
        ) : docs.data.length === 0 ? (
          <EmptyState title="No documents" icon={<FileText />} />
        ) : (
          <ul className="divide-y divide-border" aria-label="Documents">
            {docs.data.map((d: EmployeeDocumentItem) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <FileText className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {DOCUMENT_CATEGORY_LABEL[d.category]} · {d.fileName} ·{' '}
                    {Math.ceil(d.sizeBytes / 1024)} KB ·{' '}
                    {new Date(d.uploadedAt).toLocaleDateString()}
                    {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Download ${d.title}`}
                  onClick={() => {
                    downloadDocument(profile.base, d).catch((e: unknown) => {
                      setError(errorMessage(e));
                    });
                  }}
                >
                  <Download />
                </Button>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${d.title}`}
                    onClick={() => {
                      confirm({
                        title: 'Delete document?',
                        description: d.title,
                        label: 'Delete',
                        destructive: true,
                        run: () => api.delete(`${profile.base}/documents/${d.id}`),
                      });
                    }}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------ team

export function Team({ profile }: { profile: ProfileBase }) {
  const reports = useReports(profile);
  if (reports.isPending) return <Loading />;
  if (reports.isError) return <ErrorState description={errorMessage(reports.error)} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct reports</CardTitle>
        <Badge>{reports.data.length}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        {reports.data.length === 0 ? (
          <p className="px-4 py-3 text-muted-foreground">No direct reports.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Direct reports">
            {reports.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  {profile.self ? (
                    <p className="font-medium">{r.displayName}</p>
                  ) : (
                    <Link className="font-medium hover:underline" to={`/people/employees/${r.id}`}>
                      {r.displayName}
                    </Link>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {[r.job?.designation?.name, r.job?.department?.name]
                      .filter(Boolean)
                      .join(' · ') || r.employeeNumber}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
