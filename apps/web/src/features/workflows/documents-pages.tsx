import type {
  ApplicationItem,
  DocumentTemplateItem,
  PublicAcceptanceItem,
  TemplateCategoryValue,
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
import { documentTemplateSchema, templateVersionSchema } from '@hrm/validation';
import { useQuery } from '@tanstack/react-query';
import { Download, FileCheck2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { authorizedFetch, saveDownload } from '@/features/recruitment/recruit-api';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import { api, errorMessage } from '@/lib/api';
import { env } from '@/lib/env';
import {
  CATEGORY_LABEL,
  label,
  useAct,
  useDocuments,
  useLibrary,
  useTemplates,
} from './workflows-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const VARIANT: Record<string, 'neutral' | 'warning' | 'success' | 'destructive' | 'info'> = {
  FINAL: 'info',
  AWAITING_ACCEPTANCE: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  PENDING: 'warning',
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  PUBLISHED: 'success',
  ARCHIVED: 'neutral',
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const CATEGORIES = Object.keys(CATEGORY_LABEL) as TemplateCategoryValue[];

// ------------------------------------------------------------------------------ templates

function TemplateEditor({
  template,
  onDone,
}: {
  template: DocumentTemplateItem | null;
  onDone: () => void;
}) {
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    name: template?.name ?? '',
    category: template?.category ?? 'APPOINTMENT_LETTER',
    title: template?.title ?? '',
    body: template?.body ?? '',
  });
  const catalogue = template?.mergeFields ?? MERGE_HINT[v.category];
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {!template ? (
          <FormGrid columns={2}>
            <FormField label="Name" required>
              <Input
                value={v.name}
                onChange={(e) => {
                  setV({ ...v, name: e.target.value });
                }}
              />
            </FormField>
            <FormField label="Category" required>
              <Select
                value={v.category}
                options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] ?? c }))}
                onChange={(e) => {
                  setV({ ...v, category: e.target.value as TemplateCategoryValue });
                }}
              />
            </FormField>
          </FormGrid>
        ) : null}
        <FormField label="Title" required>
          <Input
            value={v.title}
            onChange={(e) => {
              setV({ ...v, title: e.target.value });
            }}
          />
        </FormField>
        <FormField
          label="Text"
          required
          description="Your own wording. Use merge fields like {{employee.name}}; every field must have a value when the letter is generated."
        >
          <Textarea
            className="min-h-64 font-mono text-sm"
            value={v.body}
            onChange={(e) => {
              setV({ ...v, body: e.target.value });
            }}
          />
        </FormField>
        <div className="flex flex-wrap gap-1" aria-label="Merge fields">
          {catalogue.map((f) => (
            <Button
              key={f}
              size="xs"
              variant="outline"
              onClick={() => {
                setV({ ...v, body: `${v.body}{{${f}}}` });
              }}
            >
              {`{{${f}}}`}
            </Button>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            if (template) {
              const parsed = templateVersionSchema.safeParse({ title: v.title, body: v.body });
              if (!parsed.success) {
                setErrorAndStop(setError, parsed.error.issues[0]?.message);
                return;
              }
              run.mutate(
                () =>
                  api.post(`/documents/templates/${template.id}/versions`, {
                    title: v.title,
                    body: v.body,
                  }),
                { onSuccess: onDone },
              );
              return undefined;
            }
            const parsed = documentTemplateSchema.safeParse(v);
            if (!parsed.success) {
              setErrorAndStop(setError, parsed.error.issues[0]?.message);
              return;
            }
            run.mutate(() => api.post('/documents/templates', v), { onSuccess: onDone });
            return undefined;
          }}
        >
          {template ? `Save as version ${String(template.version + 1)}` : 'Create template'}
        </Button>
      </DialogFooter>
    </>
  );
}

function setErrorAndStop(set: (m: string) => void, message: string | undefined): undefined {
  set(message ?? 'Check the template');
  return undefined;
}

/** Field catalogue per category (mirrors @hrm/business-rules MERGE_FIELDS). */
const ORG = ['organization.name', 'today'];
const EMP = [
  'employee.name',
  'employee.firstName',
  'employee.number',
  'employee.designation',
  'employee.department',
  'employee.company',
  'employee.location',
  'employee.dateOfJoining',
  'employee.workEmail',
];
const MERGE_HINT: Record<TemplateCategoryValue, string[]> = {
  OFFER_LETTER: [
    ...ORG,
    'candidate.name',
    'candidate.email',
    'offer.jobTitle',
    'offer.ctc',
    'offer.currency',
    'offer.joiningDate',
    'offer.expiresOn',
    'offer.department',
    'offer.location',
  ],
  APPOINTMENT_LETTER: [...ORG, ...EMP, 'employee.ctc'],
  EXPERIENCE_LETTER: [...ORG, ...EMP, 'employee.lastWorkingDay'],
  RELIEVING_LETTER: [...ORG, ...EMP, 'employee.lastWorkingDay'],
  SALARY_CERTIFICATE: [...ORG, ...EMP, 'employee.ctc'],
  POLICY: [...ORG, ...EMP],
  OTHER: [...ORG, ...EMP],
};

export function TemplatesPage() {
  const templates = useTemplates();
  const { error, run } = useAct();
  const [editing, setEditing] = useState<DocumentTemplateItem | 'new' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Document templates"
        description="Letters in your own words with merge fields. Published versions never change."
        actions={
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> New template
          </Button>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!templates.data?.length ? (
        <EmptyState title="No templates yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Templates">
              {templates.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <strong>{t.name}</strong>{' '}
                    <span className="text-muted-foreground">
                      · {CATEGORY_LABEL[t.category]} · v{t.version}
                    </span>
                  </span>
                  <Status s={t.status} />
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      setEditing(t);
                    }}
                  >
                    New version
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      run.mutate(() =>
                        api.put(`/documents/templates/${t.id}/status`, {
                          status: t.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                        }),
                      );
                    }}
                  >
                    {t.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader
            title={editing === 'new' ? 'New template' : `New version of ${editing?.name ?? ''}`}
          />
          {editing ? (
            <TemplateEditor
              template={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ generated documents

function GenerateDialog({ onDone }: { onDone: () => void }) {
  const templates = useTemplates();
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const offers = useQuery({
    queryKey: ['documents', 'offers'],
    queryFn: () =>
      api.getPage<ApplicationItem>('/recruitment/applications', {
        query: { stage: 'OFFER', pageSize: 100 },
      }),
  });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({ templateId: '', employeeId: '', offerId: '' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [signers, setSigners] = useState<string[]>([]);
  const [candidateSigns, setCandidateSigns] = useState(true);
  const t = (templates.data ?? []).find((x) => x.id === v.templateId);
  const isOffer = t?.category === 'OFFER_LETTER';
  const extra = t
    ? t.mergeFields.filter(
        (f) =>
          ['employee.lastWorkingDay', 'offer.expiresOn'].includes(f) &&
          `${t.title}\n${t.body}`.includes(`{{${f}}}`),
      )
    : [];
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormField label="Template" required>
          <Select
            value={v.templateId}
            placeholder="Select…"
            options={(templates.data ?? [])
              .filter((x) => x.status === 'ACTIVE')
              .map((x) => ({
                value: x.id,
                label: `${x.name} (${CATEGORY_LABEL[x.category] ?? x.category})`,
              }))}
            onChange={(e) => {
              setV({ ...v, templateId: e.target.value });
            }}
          />
        </FormField>
        {t ? (
          isOffer ? (
            <FormField label="Offer" required>
              <Select
                value={v.offerId}
                placeholder="Select…"
                options={(offers.data?.items ?? [])
                  .filter((a) => a.offer)
                  .map((a) => ({
                    value: a.offer?.id ?? '',
                    label: `${a.candidate.displayName} — ${a.opening.title} (${label(a.offer?.status ?? '')})`,
                  }))}
                onChange={(e) => {
                  setV({ ...v, offerId: e.target.value });
                }}
              />
            </FormField>
          ) : (
            <FormField label="Employee" required>
              <Select
                value={v.employeeId}
                placeholder="Select…"
                options={employees.data ?? []}
                onChange={(e) => {
                  setV({ ...v, employeeId: e.target.value });
                }}
              />
            </FormField>
          )
        ) : null}
        {extra.map((f) => (
          <FormField
            key={f}
            label={f}
            required
            description="Not on record; entered for this letter."
          >
            <Input
              type={f.endsWith('Day') || f.endsWith('On') ? 'date' : 'text'}
              value={values[f] ?? ''}
              onChange={(e) => {
                setValues({ ...values, [f]: e.target.value });
              }}
            />
          </FormField>
        ))}
        {t ? (
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium">Acceptance</legend>
            {isOffer ? (
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={candidateSigns}
                  onCheckedChange={(c) => {
                    setCandidateSigns(c === true);
                  }}
                />{' '}
                The candidate accepts by an e-mailed one-time code (marks the offer accepted)
              </label>
            ) : (
              <>
                <Select
                  aria-label="Add signer"
                  value=""
                  placeholder="Add an employee who must accept…"
                  options={(employees.data ?? []).filter((e) => !signers.includes(e.value))}
                  onChange={(e) => {
                    if (e.target.value) setSigners([...signers, e.target.value]);
                  }}
                />
                <ol className="list-decimal pl-5">
                  {signers.map((s) => (
                    <li key={s}>
                      {employees.data?.find((e) => e.value === s)?.label}{' '}
                      <button
                        type="button"
                        className="text-muted-foreground underline"
                        onClick={() => {
                          setSigners(signers.filter((x) => x !== s));
                        }}
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              E-acceptance records who accepted, when, from where and the document's SHA-256. It is
              not a qualified or Aadhaar e-signature.
            </p>
          </fieldset>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!t || run.isPending}
          onClick={() => {
            if (!t) return;
            if (isOffer ? !v.offerId : !v.employeeId) {
              setError(isOffer ? 'Choose the offer' : 'Choose the employee');
              return;
            }
            const body = {
              templateId: v.templateId,
              ...(isOffer ? { offerId: v.offerId } : { employeeId: v.employeeId }),
              values: Object.fromEntries(Object.entries(values).filter(([, x]) => x)),
              signers: isOffer
                ? candidateSigns
                  ? [{ kind: 'CANDIDATE' }]
                  : []
                : signers.map((employeeId) => ({ kind: 'EMPLOYEE', employeeId })),
            };
            run.mutate(() => api.post('/documents', body), { onSuccess: onDone });
          }}
        >
          Generate PDF
        </Button>
      </DialogFooter>
    </>
  );
}

export function DocumentsPage() {
  const generate = usePermission(P.DOCUMENTS_DOCUMENT_GENERATE);
  const docs = useDocuments();
  const { error, setError, run } = useAct();
  const [creating, setCreating] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const dl = (id: string, title: string, certificate: boolean) => {
    saveDownload(
      `/documents/${id}/file${certificate ? '?certificate=true' : ''}`,
      `${title}${certificate ? ' (accepted)' : ''}.pdf`,
    ).catch((e: unknown) => {
      setError(errorMessage(e));
    });
  };
  return (
    <Page>
      <PageHeader
        title={generate ? 'Documents' : 'My documents'}
        description={
          generate
            ? 'Letters generated from your templates, and their acceptance.'
            : 'Letters issued to you, and documents waiting for your acceptance.'
        }
        actions={
          generate ? (
            <Button
              onClick={() => {
                setCreating(true);
              }}
            >
              <Plus /> Generate
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {docs.isPending ? (
        <Skeleton className="h-32" />
      ) : !docs.data?.length ? (
        <EmptyState title="No documents" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Documents">
              {docs.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <strong>{d.title}</strong>
                    <span className="block text-muted-foreground">
                      {CATEGORY_LABEL[d.category]} ·{' '}
                      {d.employee?.displayName ?? d.offer?.candidateName ?? ''} · {d.template.name}{' '}
                      v{d.template.version} · {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                    {d.signers.length ? (
                      <span className="block text-xs text-muted-foreground">
                        {d.signers
                          .map(
                            (s) =>
                              `${String(s.order)}. ${s.name}: ${label(s.status)}${s.at ? ` ${new Date(s.at).toLocaleString()}` : ''}${s.method ? ` (${s.method === 'EMAIL_OTP' ? 'e-mailed code' : 'signed in'})` : ''}${s.reason ? ` — ${s.reason}` : ''}`,
                          )
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <Status s={d.status} />
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={`Download ${d.title}`}
                    onClick={() => {
                      dl(d.id, d.title, false);
                    }}
                  >
                    <Download /> PDF
                  </Button>
                  {d.hasCertificate ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        dl(d.id, d.title, true);
                      }}
                    >
                      <FileCheck2 /> With certificate
                    </Button>
                  ) : null}
                  {d.canAccept ? (
                    <>
                      <Button
                        size="xs"
                        onClick={() => {
                          run.mutate(() => api.post(`/documents/${d.id}/accept`, {}));
                        }}
                      >
                        Accept
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setDeclining(d.id);
                          setReason('');
                        }}
                      >
                        Decline
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="Generate a document" />
          {creating ? (
            <GenerateDialog
              onDone={() => {
                setCreating(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={declining !== null}
        onOpenChange={(o) => {
          if (!o) setDeclining(null);
        }}
      >
        <DialogContent>
          <DialogHeader title="Decline" />
          <DialogBody>
            <FormField label="Reason" required>
              <Textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button
              disabled={!reason.trim()}
              onClick={() => {
                run.mutate(() => api.post(`/documents/${declining ?? ''}/decline`, { reason }), {
                  onSuccess: () => {
                    setDeclining(null);
                  },
                });
              }}
            >
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ library

function Upload({
  path,
  fields,
  onDone,
  submitLabel,
}: {
  path: string;
  fields: boolean;
  onDone: () => void;
  submitLabel: string;
}) {
  const departments = useRefOptions({ path: '/departments' });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    title: '',
    category: '',
    description: '',
    requiresAcknowledgement: true,
    audienceDepartmentId: '',
  });
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {fields ? (
          <>
            <FormGrid columns={2}>
              <FormField label="Title" required>
                <Input
                  value={v.title}
                  onChange={(e) => {
                    setV({ ...v, title: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="Category" required>
                <Input
                  placeholder="e.g. Policies"
                  value={v.category}
                  onChange={(e) => {
                    setV({ ...v, category: e.target.value });
                  }}
                />
              </FormField>
              <FormField label="Only department">
                <Select
                  value={v.audienceDepartmentId}
                  placeholder="Everyone"
                  options={[{ value: '', label: 'Everyone' }, ...(departments.data ?? [])]}
                  onChange={(e) => {
                    setV({ ...v, audienceDepartmentId: e.target.value });
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.requiresAcknowledgement}
                onCheckedChange={(c) => {
                  setV({ ...v, requiresAcknowledgement: c === true });
                }}
              />{' '}
              Employees must acknowledge each version
            </label>
          </>
        ) : null}
        <FormField label="PDF file" required>
          <input
            type="file"
            accept="application/pdf"
            aria-label="PDF file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
            }}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!file || run.isPending}
          onClick={() => {
            if (!file) return;
            if (fields && (!v.title.trim() || !v.category.trim())) {
              setError('Give a title and a category');
              return;
            }
            const form = new FormData();
            form.append('file', file);
            if (fields) {
              form.append('title', v.title);
              form.append('category', v.category);
              if (v.description) form.append('description', v.description);
              form.append('requiresAcknowledgement', String(v.requiresAcknowledgement));
              if (v.audienceDepartmentId)
                form.append('audienceDepartmentId', v.audienceDepartmentId);
            }
            run.mutate(() => authorizedFetch(path, { method: 'POST', body: form }), {
              onSuccess: onDone,
            });
          }}
        >
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function LibraryPage() {
  const manage = usePermission(P.DOCUMENTS_LIBRARY_MANAGE);
  const library = useLibrary();
  const { error, setError, run } = useAct();
  const [dialog, setDialog] = useState<{ kind: 'new' } | { kind: 'version'; id: string } | null>(
    null,
  );
  return (
    <Page>
      <PageHeader
        title="Company documents"
        description="Policies and handbooks. Acknowledge each new version when asked."
        actions={
          manage ? (
            <Button
              onClick={() => {
                setDialog({ kind: 'new' });
              }}
            >
              <Plus /> Publish
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      {!library.data?.length ? (
        <EmptyState title="No documents published" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Company documents">
              {library.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <strong>{d.title}</strong>{' '}
                    <span className="text-muted-foreground">
                      · {d.category} · v{d.version} · {new Date(d.publishedAt).toLocaleDateString()}
                    </span>
                    {d.description ? (
                      <span className="block text-muted-foreground">{d.description}</span>
                    ) : null}
                    {d.stats ? (
                      <span className="block text-xs text-muted-foreground">
                        acknowledged {d.stats.acknowledged} of {d.stats.audience}
                      </span>
                    ) : null}
                  </span>
                  {manage ? <Status s={d.status} /> : null}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      saveDownload(`/library/${d.id}/file`, d.fileName).catch((e: unknown) => {
                        setError(errorMessage(e));
                      });
                    }}
                  >
                    <Download /> Open
                  </Button>
                  {d.requiresAcknowledgement ? (
                    d.acknowledgedAt ? (
                      <Badge variant="success">acknowledged</Badge>
                    ) : (
                      <Button
                        size="xs"
                        onClick={() => {
                          run.mutate(() => api.post(`/library/${d.id}/acknowledge`, {}));
                        }}
                      >
                        Acknowledge
                      </Button>
                    )
                  ) : null}
                  {manage ? (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setDialog({ kind: 'version', id: d.id });
                        }}
                      >
                        New version
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          run.mutate(() =>
                            api.put(`/library/${d.id}/status`, {
                              status: d.status === 'PUBLISHED' ? 'ARCHIVED' : 'PUBLISHED',
                            }),
                          );
                        }}
                      >
                        {d.status === 'PUBLISHED' ? 'Archive' : 'Publish'}
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader
            title={dialog?.kind === 'version' ? 'Upload a new version' : 'Publish a document'}
          />
          {dialog ? (
            <Upload
              path={dialog.kind === 'version' ? `/library/${dialog.id}/versions` : '/library'}
              fields={dialog.kind === 'new'}
              submitLabel={dialog.kind === 'version' ? 'Upload version' : 'Publish'}
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

// ------------------------------------------------------------------------------ public acceptance

async function publicCall<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${env.apiBaseUrl}/public/acceptance/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await res.json()) as {
    data?: T;
    error?: { message?: string; details?: { message: string }[] };
  };
  if (!res.ok)
    throw new Error(
      body.error?.details?.[0]?.message ??
        body.error?.message ??
        `Request failed (${String(res.status)})`,
    );
  return body.data as T;
}

/** Candidates review and accept a document from an e-mailed link (no login). */
export function PublicAcceptancePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const view = useQuery({
    queryKey: ['public-acceptance', token],
    queryFn: () => publicCall<PublicAcceptanceItem>(token),
    enabled: !!token,
    retry: false,
  });
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PublicAcceptanceItem | null>(null);
  const d = done ?? view.data;
  const act = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  };
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 px-4 py-10">
      {view.isPending && token ? <Skeleton className="h-40" /> : null}
      {!token || view.isError ? (
        <Alert tone="destructive">This link is not valid. Ask the sender for a new one.</Alert>
      ) : null}
      {d ? (
        <Card>
          <CardHeader>
            <CardTitle>{d.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              {d.organizationName} has sent this document to {d.candidateName}.
            </p>
            <a
              className="text-primary underline"
              href={`${env.apiBaseUrl}/public/acceptance/${encodeURIComponent(token)}/file`}
              target="_blank"
              rel="noreferrer"
            >
              Read the document (PDF)
            </a>
            <p className="break-all text-xs text-muted-foreground">
              Document fingerprint (SHA-256): {d.sha256}
            </p>
            {error ? <Alert tone="destructive">{error}</Alert> : null}
            {d.status === 'ACCEPTED' ? (
              <Alert tone="success">You accepted this document. Thank you.</Alert>
            ) : null}
            {d.status === 'DECLINED' ? (
              <Alert tone="info">You declined this document.</Alert>
            ) : null}
            {d.status === 'PENDING' ? (
              <>
                {!sent ? (
                  <Button
                    onClick={() => {
                      act(async () => {
                        await publicCall(`${token}/code`, { method: 'POST', body: '{}' });
                        setSent(true);
                      });
                    }}
                  >
                    E-mail me a code to accept
                  </Button>
                ) : (
                  <div className="flex items-end gap-2">
                    <FormField label="6-digit code from the e-mail">
                      <Input
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(e) => {
                          setCode(e.target.value.replace(/\D/g, ''));
                        }}
                      />
                    </FormField>
                    <Button
                      disabled={code.length !== 6}
                      onClick={() => {
                        act(async () => {
                          setDone(
                            await publicCall<PublicAcceptanceItem>(`${token}/accept`, {
                              method: 'POST',
                              body: JSON.stringify({ code }),
                            }),
                          );
                        });
                      }}
                    >
                      I accept
                    </Button>
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-muted-foreground">
                    Decline instead
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    <Textarea
                      aria-label="Reason for declining"
                      value={reason}
                      onChange={(e) => {
                        setReason(e.target.value);
                      }}
                    />
                    <div>
                      <Button
                        variant="outline"
                        disabled={!reason.trim()}
                        onClick={() => {
                          act(async () => {
                            setDone(
                              await publicCall<PublicAcceptanceItem>(`${token}/decline`, {
                                method: 'POST',
                                body: JSON.stringify({ reason }),
                              }),
                            );
                          });
                        }}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </details>
                <p className="text-xs text-muted-foreground">
                  Accepting records your acceptance of this exact document (its fingerprint), the
                  time and your network address. It is an electronic acceptance, not a qualified or
                  Aadhaar e-signature.
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
