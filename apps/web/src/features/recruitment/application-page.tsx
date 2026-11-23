import type { ApplicationStageValue, EmployeeDetails, InterviewItem } from '@hrm/shared-types';
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
  ErrorState,
  FormField,
  Select,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { assessmentSchema, hireSchema, offerSchema } from '@hrm/validation';
import { canMoveStage } from '@hrm/business-rules';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import type { RefRow } from '@/features/structure/api';
import type { FieldDef } from '@/features/structure/entity-payload';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import {
  formatMoney,
  RECRUIT,
  saveDownload,
  STAGE_LABEL,
  STATUS_VARIANT,
  useApplication,
  useTemplates,
} from './recruit-api';

const P = PERMISSIONS;
const MOVES: ApplicationStageValue[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
];
const EMPLOYEES = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};

function StageForm({
  id,
  from,
  onDone,
}: {
  id: string;
  from: ApplicationStageValue;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const options = MOVES.filter((s) => canMoveStage(from, s));
  const [stage, setStage] = useState<string>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const move = useMutation({
    mutationFn: () =>
      api.post(`/recruitment/applications/${id}/stage`, {
        stage,
        note: stage === 'REJECTED' ? null : note || null,
        rejectionReason: stage === 'REJECTED' ? note : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RECRUIT });
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
        <FormField label="Move to" required>
          <Select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
            }}
            options={options.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
          />
        </FormField>
        <FormField
          label={stage === 'REJECTED' ? 'Reason (required)' : 'Note'}
          required={stage === 'REJECTED'}
        >
          <Textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
          />
        </FormField>
        <p className="text-sm text-muted-foreground">
          Every move is recorded in the application history.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={!stage || move.isPending}
          onClick={() => {
            move.mutate();
          }}
        >
          Move
        </Button>
      </DialogFooter>
    </>
  );
}

const interviewFormSchema = z.object({
  roundName: z.string().trim().min(1, 'Required'),
  scheduledAt: z.string().min(1, 'Required'),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE'], 'Select a mode'),
  locationOrLink: z.string().nullable().optional(),
  panelistA: z.uuid('Select an interviewer'),
  panelistB: z.union([z.uuid(), z.null()]).optional(),
});

const interviewFields: FieldDef[] = [
  { name: 'roundName', label: 'Round', required: true, placeholder: 'e.g. Technical' },
  { name: 'scheduledAt', label: 'Date and time', kind: 'datetime', required: true },
  { name: 'durationMinutes', label: 'Duration (minutes)', kind: 'number', required: true },
  {
    name: 'mode',
    label: 'Mode',
    kind: 'select',
    required: true,
    placeholder: 'Select…',
    options: [
      { value: 'VIDEO', label: 'Video' },
      { value: 'IN_PERSON', label: 'In person' },
      { value: 'PHONE', label: 'Phone' },
    ],
  },
  { name: 'locationOrLink', label: 'Location or meeting link', wide: true },
  {
    name: 'panelistA',
    label: 'Interviewer',
    kind: 'ref',
    ref: EMPLOYEES,
    refParams: { status: 'ACTIVE' },
    required: true,
  },
  {
    name: 'panelistB',
    label: 'Second interviewer',
    kind: 'ref',
    ref: EMPLOYEES,
    refParams: { status: 'ACTIVE' },
  },
];

const assessmentFields: FieldDef[] = [
  { name: 'name', label: 'Assessment', required: true, wide: true },
  { name: 'score', label: 'Score', required: true },
  { name: 'maxScore', label: 'Out of', required: true },
  { name: 'assessedOn', label: 'Date', kind: 'date', required: true },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];

const offerFields: FieldDef[] = [
  { name: 'joiningDate', label: 'Joining date', kind: 'date', required: true },
  {
    name: 'annualCtc',
    label: 'Annual CTC',
    required: true,
    description: 'Gross annual cost to company.',
  },
  { name: 'currency', label: 'Currency', required: true },
  { name: 'designationId', label: 'Designation', kind: 'ref', ref: { path: '/designations' } },
  {
    name: 'jobGradeId',
    label: 'Job grade',
    kind: 'ref',
    ref: { path: '/job-grades', sortBy: 'rank' },
  },
  { name: 'notes', label: 'Notes', kind: 'textarea' },
];

function hireFields(templates: { value: string; label: string }[]): FieldDef[] {
  return [
    {
      name: 'companyId',
      label: 'Company',
      kind: 'ref',
      ref: { path: '/companies' },
      required: true,
    },
    {
      name: 'employmentType',
      label: 'Employment type',
      kind: 'select',
      required: true,
      placeholder: 'Select…',
      options: [
        { value: 'FULL_TIME', label: 'Full-time' },
        { value: 'PART_TIME', label: 'Part-time' },
        { value: 'CONTRACT', label: 'Contract' },
        { value: 'INTERN', label: 'Intern' },
        { value: 'CONSULTANT', label: 'Consultant' },
      ],
    },
    {
      name: 'branchId',
      label: 'Branch',
      kind: 'ref',
      ref: { path: '/branches' },
      refFilter: { field: 'companyId', param: 'companyId' },
    },
    {
      name: 'departmentId',
      label: 'Department',
      kind: 'ref',
      ref: { path: '/departments' },
      refFilter: { field: 'companyId', param: 'companyId' },
    },
    {
      name: 'managerId',
      label: 'Reporting manager',
      kind: 'ref',
      ref: EMPLOYEES,
      refParams: { status: 'ACTIVE' },
    },
    { name: 'probationEndDate', label: 'Probation ends', kind: 'date' },
    {
      name: 'onboardingTemplateId',
      label: 'Start onboarding with',
      kind: 'select',
      options: templates,
    },
  ];
}

function Interviews({ items }: { items: InterviewItem[] }) {
  if (!items.length)
    return <p className="px-4 py-3 text-muted-foreground">No interviews scheduled.</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Interviews">
      {items.map((i) => (
        <li key={i.id} className="flex flex-col gap-1 px-4 py-2.5 text-sm">
          <p className="font-medium">
            {i.roundName} · {new Date(i.scheduledAt).toLocaleString()} · {i.durationMinutes} min{' '}
            <Badge variant={STATUS_VARIANT[i.status] ?? 'neutral'}>{i.status.toLowerCase()}</Badge>
          </p>
          {i.panel.map((p) => (
            <p key={p.employee.id} className="text-muted-foreground">
              {p.employee.displayName}:{' '}
              {p.submittedAt
                ? `${'★'.repeat(p.rating ?? 0)} ${p.recommendation?.replace('_', ' ').toLowerCase() ?? ''} — ${p.notes ?? ''}`
                : 'feedback pending'}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

type DialogKind = 'stage' | 'assessment' | 'interview' | 'offer' | 'hire' | null;

export function ApplicationPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = usePermission(P.RECRUITMENT_CANDIDATE_MANAGE);
  const canOffer = usePermission(P.RECRUITMENT_OFFER_MANAGE);
  const app = useApplication(id);
  const templates = useTemplates(canOffer);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [error, setError] = useState<string | null>(null);
  const offerStatus = useMutation({
    mutationFn: (a: { id: string; status: string }) =>
      api.put(`/recruitment/offers/${a.id}/status`, { status: a.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: RECRUIT }),
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (app.isPending)
    return (
      <Page>
        <Skeleton className="h-64" />
      </Page>
    );
  if (app.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(app.error)} />
      </Page>
    );
  const a = app.data;
  const c = a.candidateDetails;
  const active = !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(a.stage);
  const liveOffer = a.offers.find(
    (o) => o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'ACCEPTED',
  );
  const accepted = a.offers.find((o) => o.status === 'ACCEPTED');
  const close = () => {
    setDialog(null);
  };
  return (
    <Page>
      <PageHeader
        title={c.displayName}
        description={
          <>
            <Link className="hover:underline" to={`/recruitment/openings/${a.opening.id}`}>
              {a.opening.title}
            </Link>{' '}
            · {c.email}
            {c.phone ? ` · ${c.phone}` : ''}
          </>
        }
        actions={
          <>
            <Badge variant="outline">{STAGE_LABEL[a.stage]}</Badge>
            {c.hasResume ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void saveDownload(
                    `/recruitment/candidates/${c.id}/resume`,
                    c.resumeFileName ?? 'resume',
                  )
                }
              >
                <Download /> Resume
              </Button>
            ) : null}
            {canManage && a.stage !== 'HIRED' && a.stage !== 'WITHDRAWN' ? (
              <Button
                size="sm"
                onClick={() => {
                  setDialog('stage');
                }}
              >
                Move stage
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
      {a.employee ? (
        <Alert tone="success" className="mb-3">
          Hired —{' '}
          <Link className="underline" to={`/people/employees/${a.employee.id}`}>
            {a.employee.displayName} ({a.employee.employeeNumber})
          </Link>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Interviews</CardTitle>
              {canManage && active ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialog('interview');
                  }}
                >
                  Schedule
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <Interviews items={a.interviews} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Assessments</CardTitle>
              {canManage && active ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialog('assessment');
                  }}
                >
                  Add
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {a.assessments.length ? (
                <ul className="divide-y divide-border" aria-label="Assessments">
                  {a.assessments.map((s) => (
                    <li key={s.id} className="px-4 py-2 text-sm">
                      <span className="font-medium">{s.name}</span> · {s.score}/{s.maxScore} ·{' '}
                      {s.assessedOn}
                      {s.notes ? (
                        <span className="block text-muted-foreground">{s.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-3 text-muted-foreground">No assessments.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Offer</CardTitle>
              {canOffer && a.stage === 'OFFER' && !liveOffer ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDialog('offer');
                  }}
                >
                  Create offer
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {a.offers.length === 0 ? (
                <p className="text-muted-foreground">
                  {a.stage === 'OFFER'
                    ? 'No offer yet.'
                    : 'Move the application to the offer stage to make an offer.'}
                </p>
              ) : (
                a.offers.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{formatMoney(o.annualCtc, o.currency)}</span>
                    <span className="text-muted-foreground">
                      joining {o.joiningDate}
                      {o.designation ? ` · ${o.designation.name}` : ''}
                    </span>
                    <Badge variant={STATUS_VARIANT[o.status] ?? 'neutral'}>
                      {o.status.toLowerCase()}
                    </Badge>
                    {canOffer && o.status === 'DRAFT' ? (
                      <Button
                        size="xs"
                        onClick={() => {
                          offerStatus.mutate({ id: o.id, status: 'SENT' });
                        }}
                      >
                        Mark sent
                      </Button>
                    ) : null}
                    {canOffer && o.status === 'SENT' ? (
                      <>
                        <Button
                          size="xs"
                          onClick={() => {
                            offerStatus.mutate({ id: o.id, status: 'ACCEPTED' });
                          }}
                        >
                          Accepted
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => {
                            offerStatus.mutate({ id: o.id, status: 'DECLINED' });
                          }}
                        >
                          Declined
                        </Button>
                      </>
                    ) : null}
                    {canOffer &&
                    (o.status === 'DRAFT' || o.status === 'SENT' || o.status === 'ACCEPTED') &&
                    !a.employee ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          offerStatus.mutate({ id: o.id, status: 'WITHDRAWN' });
                        }}
                      >
                        Withdraw
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
              {canOffer && accepted && !a.employee ? (
                <div>
                  <Button
                    onClick={() => {
                      setDialog('hire');
                    }}
                  >
                    Hire — create employee
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Candidate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p>{[c.currentTitle, c.currentCompany].filter(Boolean).join(' at ') || '—'}</p>
            <p className="text-muted-foreground">
              {c.totalExperienceMonths !== null
                ? `${String(Math.floor(c.totalExperienceMonths / 12))}y ${String(c.totalExperienceMonths % 12)}m experience · `
                : ''}
              {c.location ?? ''}
            </p>
            {c.skills.length ? (
              <div className="flex flex-wrap gap-1">
                {c.skills.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </div>
            ) : null}
            <p className="text-muted-foreground">
              Source: {c.source.replace('_', ' ').toLowerCase()}
              {c.consentAt ? ` · consent ${new Date(c.consentAt).toLocaleDateString()}` : ''}
            </p>
            <h3 className="mt-2 font-medium">History</h3>
            <ol className="flex flex-col gap-1" aria-label="Application history">
              {a.events.map((e) => (
                <li key={e.id} className="text-muted-foreground">
                  {new Date(e.createdAt).toLocaleDateString()} ·{' '}
                  {e.fromStage ? `${STAGE_LABEL[e.fromStage]} → ` : ''}
                  {STAGE_LABEL[e.toStage]}
                  {e.actor ? ` by ${e.actor}` : ''}
                  {e.note ? ` — ${e.note}` : ''}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) close();
        }}
      >
        <DialogContent size={dialog === 'hire' || dialog === 'interview' ? 'lg' : 'md'}>
          {dialog === 'stage' ? (
            <>
              <DialogHeader
                title="Move application"
                description={`Currently: ${STAGE_LABEL[a.stage]}`}
              />
              <StageForm id={id} from={a.stage} onDone={close} />
            </>
          ) : dialog === 'assessment' ? (
            <>
              <DialogHeader title="Record an assessment" />
              <ResourceForm
                fields={assessmentFields}
                defaultValues={{
                  name: '',
                  score: '',
                  maxScore: '',
                  assessedOn: new Date().toISOString().slice(0, 10),
                  notes: '',
                }}
                schema={assessmentSchema}
                submit={(body) => api.post(`/recruitment/applications/${id}/assessments`, body)}
                invalidate={[RECRUIT]}
                submitLabel="Save"
                onDone={close}
              />
            </>
          ) : dialog === 'interview' ? (
            <>
              <DialogHeader
                title="Schedule an interview"
                description="Interviewers see it under My interviews and submit feedback there."
              />
              <ResourceForm
                fields={interviewFields}
                defaultValues={{
                  roundName: '',
                  scheduledAt: '',
                  durationMinutes: '60',
                  mode: '',
                  locationOrLink: '',
                  panelistA: '',
                  panelistB: '',
                }}
                schema={interviewFormSchema}
                submit={(body) => {
                  const { panelistA, panelistB, scheduledAt, ...rest } = body as Record<
                    string,
                    string | null
                  >;
                  return api.post(`/recruitment/applications/${id}/interviews`, {
                    ...rest,
                    scheduledAt: new Date(String(scheduledAt)).toISOString(),
                    panelEmployeeIds: [panelistA, panelistB].filter(Boolean),
                  });
                }}
                invalidate={[RECRUIT]}
                submitLabel="Schedule"
                onDone={close}
              />
            </>
          ) : dialog === 'offer' ? (
            <>
              <DialogHeader title="Create an offer" />
              <ResourceForm
                fields={offerFields}
                defaultValues={{
                  joiningDate: '',
                  annualCtc: '',
                  currency: 'INR',
                  designationId: '',
                  jobGradeId: '',
                  notes: '',
                }}
                schema={offerSchema}
                submit={(body) => api.post(`/recruitment/applications/${id}/offers`, body)}
                invalidate={[RECRUIT]}
                submitLabel="Create offer"
                onDone={close}
              />
            </>
          ) : dialog === 'hire' ? (
            <>
              <DialogHeader
                title="Hire"
                description={`Creates the employee record joining on ${accepted?.joiningDate ?? ''}.`}
              />
              <ResourceForm
                fields={hireFields(
                  (templates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
                )}
                defaultValues={{
                  companyId: '',
                  employmentType: '',
                  branchId: '',
                  departmentId: '',
                  managerId: '',
                  probationEndDate: '',
                  onboardingTemplateId: templates.data?.find((t) => t.isDefault)?.id ?? '',
                }}
                schema={hireSchema}
                submit={async (body) => {
                  const e = await api.post<EmployeeDetails>(
                    `/recruitment/applications/${id}/hire`,
                    body,
                  );
                  void navigate(`/people/employees/${e.id}`);
                  return e;
                }}
                invalidate={[RECRUIT, ['employees']]}
                submitLabel="Hire"
                onDone={close}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}
