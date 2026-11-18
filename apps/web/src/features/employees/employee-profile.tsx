import type { EmployeeDetails, MemberListItem } from '@hrm/shared-types';
import {
  Alert,
  Avatar,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  FormField,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@hrm/ui-web';
import {
  confirmEmployeeSchema,
  extendProbationSchema,
  jobChangeSchema,
  rejoinSchema,
  separationSchema,
  updateEmployeeSchema,
  updateSelfSchema,
} from '@hrm/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page } from '@/app/layout/page';
import { ConfirmDialog } from '@/features/members/member-dialogs';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import { employeeKeys, type ProfileBase, useEmployee, useEmploymentHistory } from './api';
import { BACKGROUND_COLLECTIONS, PERSONAL_COLLECTIONS } from './collections';
import {
  jobChangeFields,
  personalFields,
  personalValues,
  placementValues,
  profileFields,
  profileValues,
  rejoinFields,
  selfContactFields,
  separationFields,
} from './employee-fields';
import { EmployeeStatusBadge } from './employees-page';
import { EMPLOYMENT_TYPE_LABEL, formatDate, SEPARATION_LABEL, todayIso } from './labels';
import {
  BankAndTax,
  CollectionSection,
  type ConfirmRequest,
  Documents,
  Field,
  type FormRequest,
  JobHistory,
  type SectionProps,
  Team,
} from './profile-sections';

function Overview({ employee: e, profile }: SectionProps) {
  const j = e.job;
  const probation =
    e.probationStatus === 'ON_PROBATION'
      ? `On probation until ${formatDate(e.probationEndDate)}`
      : e.probationStatus === 'CONFIRMED'
        ? `Confirmed on ${formatDate(e.confirmationDate)}`
        : 'No probation';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Placement</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Company">{j?.company.name}</Field>
            <Field label="Branch">{j?.branch?.name}</Field>
            <Field label="Department">{j?.department?.name}</Field>
            <Field label="Team">{j?.team?.name}</Field>
            <Field label="Designation">{j?.designation?.name}</Field>
            <Field label="Employment type">
              {j ? EMPLOYMENT_TYPE_LABEL[j.employmentType] : null}
            </Field>
            <Field label="Reporting manager">
              {j?.manager ? (
                profile.self ? (
                  j.manager.displayName
                ) : (
                  <Link className="hover:underline" to={`/people/employees/${j.manager.id}`}>
                    {j.manager.displayName}
                  </Link>
                )
              ) : null}
            </Field>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Employee number">
              <span className="font-mono">{e.employeeNumber}</span>
            </Field>
            <Field label="Date of joining">{formatDate(e.dateOfJoining)}</Field>
            <Field label="Probation">{probation}</Field>
            <Field label="Notice period">
              {e.noticePeriodDays === null ? null : `${String(e.noticePeriodDays)} days`}
            </Field>
            <Field label="Work e-mail">{e.workEmail}</Field>
            <Field label="Work phone">{e.workPhone}</Field>
            <Field label="Login account">{e.member ? e.member.email : 'Not linked'}</Field>
            {e.status !== 'ACTIVE' ? (
              <>
                <Field label="Separation">
                  {e.separationType ? SEPARATION_LABEL[e.separationType] : null}
                </Field>
                <Field label="Last working day">{formatDate(e.lastWorkingDate)}</Field>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Personal(props: SectionProps) {
  const { employee: e, profile, openForm } = props;
  const p = e.personal;
  const canEditPersonal = !profile.self && e.access.update && e.access.personal;
  const editable = profile.self ? e.status !== 'SEPARATED' : e.access.update && e.access.personal;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
          {canEditPersonal || (profile.self && e.status !== 'SEPARATED') ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                openForm(
                  profile.self
                    ? {
                        title: 'Edit contact details',
                        description: 'Other changes (name, date of birth, bank) go through HR.',
                        fields: selfContactFields,
                        values: {
                          preferredName: e.preferredName ?? '',
                          maritalStatus: p?.maritalStatus ?? '',
                          personalEmail: p?.personalEmail ?? '',
                          personalPhone: p?.personalPhone ?? '',
                        },
                        schema: updateSelfSchema,
                        submit: (body) => api.patch(profile.base, body),
                        submitLabel: 'Save',
                      }
                    : {
                        title: 'Edit personal details',
                        fields: personalFields,
                        values: personalValues(e),
                        schema: updateEmployeeSchema,
                        submit: (body) => api.patch(profile.base, body),
                        submitLabel: 'Save',
                      },
                );
              }}
            >
              <Pencil /> Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Date of birth">{formatDate(p?.dateOfBirth)}</Field>
            <Field label="Gender">{p?.gender?.replace('_', ' ').toLowerCase()}</Field>
            <Field label="Marital status">{p?.maritalStatus?.toLowerCase()}</Field>
            <Field label="Nationality">{p?.nationality}</Field>
            <Field label="Personal e-mail">{p?.personalEmail}</Field>
            <Field label="Personal phone">{p?.personalPhone}</Field>
          </dl>
        </CardContent>
      </Card>
      {PERSONAL_COLLECTIONS.map((def) => (
        <CollectionSection
          key={def.key}
          def={def}
          profile={profile}
          editable={editable}
          openForm={openForm}
          confirm={props.confirm}
        />
      ))}
    </div>
  );
}

function Background(props: SectionProps) {
  const { employee: e, profile } = props;
  const editable = profile.self ? e.status !== 'SEPARATED' : e.access.update;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {BACKGROUND_COLLECTIONS.map((def) => (
        <CollectionSection
          key={def.key}
          def={def}
          profile={profile}
          editable={editable}
          openForm={props.openForm}
          confirm={props.confirm}
        />
      ))}
    </div>
  );
}

function LinkAccountForm({ employee, onDone }: { employee: EmployeeDetails; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [membershipId, setMembershipId] = useState(employee.member?.membershipId ?? '');
  const [error, setError] = useState<string | null>(null);
  const members = useQuery({
    queryKey: ['members', 'link-options'],
    queryFn: () =>
      api.getPage<MemberListItem>('/members', { query: { pageSize: 200, status: 'ACTIVE' } }),
  });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/employees/${employee.id}/member`, { membershipId: membershipId || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
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
        <p className="text-muted-foreground">
          Linking a member gives this employee self-service access to their own profile. Invite them
          from Members first if they have no account.
        </p>
        <FormField label="Member">
          <Select
            value={membershipId}
            disabled={members.isPending}
            onChange={(e) => {
              setMembershipId(e.target.value);
            }}
            options={[
              { value: '', label: '— Not linked —' },
              ...(members.data?.items ?? []).map((m) => ({
                value: m.membershipId,
                label: `${m.fullName} (${m.email})`,
              })),
            ]}
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
            save.mutate();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

const TABS = ['overview', 'job', 'personal', 'background', 'bank', 'documents', 'team'] as const;
type Tab = (typeof TABS)[number];

/** Employee profile — one component for HR (`/employees/:id`) and self-service (`/me/employee`). */
export function EmployeeProfile({ profile }: { profile: ProfileBase }) {
  const queryClient = useQueryClient();
  const employee = useEmployee(profile);
  const history = useEmploymentHistory(profile);
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState<FormRequest | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const runConfirm = useMutation({
    mutationFn: (r: ConfirmRequest) => r.run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      setConfirmReq(null);
    },
    onError: (e) => {
      setConfirmError(errorMessage(e));
    },
  });

  if (employee.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (employee.isError)
    return (
      <Page>
        <ErrorState
          title="Could not load the profile"
          description={errorMessage(employee.error)}
          onRetry={() => void employee.refetch()}
        />
      </Page>
    );

  const e = employee.data;
  const a = e.access;
  const visibleTabs: Tab[] = TABS.filter((t) => {
    if (t === 'personal') return e.personal !== null;
    if (t === 'bank') return a.sensitive || profile.self;
    if (t === 'documents') return a.documents || profile.self;
    return true;
  });
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && visibleTabs.includes(requested) ? requested : 'overview';
  const current =
    history.data?.find(
      (r) => r.effectiveFrom <= todayIso() && (!r.effectiveTo || r.effectiveTo >= todayIso()),
    ) ?? history.data?.[0];
  const sectionProps: SectionProps = {
    profile,
    employee: e,
    openForm: setForm,
    confirm: (r) => {
      setConfirmError(null);
      setConfirmReq(r);
    },
  };
  const post = (path: string) => (body: Record<string, unknown>) =>
    api.post(`${profile.base}/${path}`, body);

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={e.displayName} className="size-11 text-md" />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
              {e.displayName} <EmployeeStatusBadge status={e.status} />
            </h1>
            <p className="text-muted-foreground">
              <span className="font-mono">{e.employeeNumber}</span>
              {e.job
                ? ` · ${[e.job.designation?.name, e.job.department?.name, e.job.company.name].filter(Boolean).join(' · ')}`
                : ''}
            </p>
          </div>
        </div>
        {!profile.self ? (
          <div className="flex gap-2">
            {a.update ? (
              <Button
                variant="outline"
                onClick={() => {
                  setForm({
                    title: 'Edit profile',
                    fields: profileFields,
                    values: profileValues(e),
                    schema: updateEmployeeSchema,
                    submit: (body) => api.patch(profile.base, body),
                    submitLabel: 'Save changes',
                  });
                }}
              >
                <Pencil /> Edit
              </Button>
            ) : null}
            {a.lifecycle || a.update ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    Actions <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {a.lifecycle && e.status !== 'SEPARATED' ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        setForm({
                          title: 'Record a job change',
                          description:
                            'Transfer, promotion, redesignation or manager change from a date. The current assignment ends the day before.',
                          fields: jobChangeFields,
                          values: {
                            effectiveFrom: '',
                            changeType: '',
                            remarks: '',
                            ...placementValues(current),
                          },
                          schema: jobChangeSchema,
                          submit: post('job-changes'),
                          submitLabel: 'Record change',
                        });
                      }}
                    >
                      Record job change
                    </DropdownMenuItem>
                  ) : null}
                  {a.lifecycle &&
                  e.probationStatus === 'ON_PROBATION' &&
                  e.status !== 'SEPARATED' ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => {
                          setForm({
                            title: 'Confirm employment',
                            fields: [
                              {
                                name: 'confirmationDate',
                                label: 'Confirmation date',
                                kind: 'date',
                                required: true,
                              },
                            ],
                            values: { confirmationDate: e.probationEndDate ?? '' },
                            schema: confirmEmployeeSchema,
                            submit: post('confirmation'),
                            submitLabel: 'Confirm',
                          });
                        }}
                      >
                        Confirm employment
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setForm({
                            title: 'Extend probation',
                            fields: [
                              {
                                name: 'probationEndDate',
                                label: 'New end date',
                                kind: 'date',
                                required: true,
                              },
                            ],
                            values: { probationEndDate: '' },
                            schema: extendProbationSchema,
                            submit: post('probation-extension'),
                            submitLabel: 'Extend',
                          });
                        }}
                      >
                        Extend probation
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {a.lifecycle && e.status === 'ACTIVE' ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        setForm({
                          title: 'Record separation',
                          description:
                            'The employee serves notice until the last working day; complete the separation after that date.',
                          fields: separationFields,
                          values: {
                            separationType: '',
                            resignationDate: '',
                            lastWorkingDate: '',
                            reason: '',
                          },
                          schema: separationSchema,
                          submit: post('separation'),
                          submitLabel: 'Record separation',
                        });
                      }}
                    >
                      Record separation
                    </DropdownMenuItem>
                  ) : null}
                  {a.lifecycle && e.status === 'ON_NOTICE' ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => {
                          sectionProps.confirm({
                            title: 'Complete separation?',
                            description: `Closes the employment on ${formatDate(e.lastWorkingDate)} and suspends the linked login.`,
                            label: 'Complete separation',
                            destructive: true,
                            run: () => api.post(`${profile.base}/separation/complete`),
                          });
                        }}
                      >
                        Complete separation
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          sectionProps.confirm({
                            title: 'Withdraw separation?',
                            description: 'The employee returns to active status.',
                            label: 'Withdraw',
                            run: () => api.delete(`${profile.base}/separation`),
                          });
                        }}
                      >
                        Withdraw separation
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {a.lifecycle && e.status === 'SEPARATED' ? (
                    <DropdownMenuItem
                      onSelect={() => {
                        setForm({
                          title: 'Record rejoining',
                          fields: rejoinFields,
                          values: {
                            dateOfJoining: '',
                            probationEndDate: '',
                            remarks: '',
                            ...placementValues(history.data?.[0]),
                          },
                          schema: rejoinSchema,
                          submit: post('rejoin'),
                          submitLabel: 'Record rejoining',
                        });
                      }}
                    >
                      Record rejoining
                    </DropdownMenuItem>
                  ) : null}
                  {a.update ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => {
                          setLinking(true);
                        }}
                      >
                        {e.member ? 'Change login account' : 'Link login account'}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>

      {e.status === 'ON_NOTICE' ? (
        <Alert tone="warning" className="mb-4">
          Serving notice — last working day {formatDate(e.lastWorkingDate)}.
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setParams({ tab: v }, { replace: true });
        }}
      >
        <TabsList aria-label="Profile sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="job">Job history</TabsTrigger>
          {visibleTabs.includes('personal') ? (
            <TabsTrigger value="personal">Personal</TabsTrigger>
          ) : null}
          <TabsTrigger value="background">Background</TabsTrigger>
          {visibleTabs.includes('bank') ? <TabsTrigger value="bank">Bank & tax</TabsTrigger> : null}
          {visibleTabs.includes('documents') ? (
            <TabsTrigger value="documents">Documents</TabsTrigger>
          ) : null}
          <TabsTrigger value="team">{profile.self ? 'My team' : 'Direct reports'}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          {tab === 'overview' ? <Overview {...sectionProps} /> : null}
        </TabsContent>
        <TabsContent value="job">
          {tab === 'job' ? <JobHistory profile={profile} /> : null}
        </TabsContent>
        <TabsContent value="personal">
          {tab === 'personal' ? <Personal {...sectionProps} /> : null}
        </TabsContent>
        <TabsContent value="background">
          {tab === 'background' ? <Background {...sectionProps} /> : null}
        </TabsContent>
        <TabsContent value="bank">
          {tab === 'bank' ? <BankAndTax {...sectionProps} /> : null}
        </TabsContent>
        <TabsContent value="documents">
          {tab === 'documents' ? <Documents {...sectionProps} /> : null}
        </TabsContent>
        <TabsContent value="team">{tab === 'team' ? <Team profile={profile} /> : null}</TabsContent>
      </Tabs>

      <Dialog
        open={form !== null}
        onOpenChange={(o) => {
          if (!o) setForm(null);
        }}
      >
        <DialogContent size="lg">
          {form ? (
            <>
              <DialogHeader title={form.title} description={form.description} />
              <ResourceForm
                fields={form.fields}
                defaultValues={form.values}
                schema={form.schema}
                submit={form.submit}
                invalidate={[employeeKeys.all]}
                submitLabel={form.submitLabel}
                onDone={() => {
                  setForm(null);
                }}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={linking} onOpenChange={setLinking}>
        <DialogContent>
          <DialogHeader title="Login account" description={e.displayName} />
          {linking ? (
            <LinkAccountForm
              employee={e}
              onDone={() => {
                setLinking(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {confirmReq ? (
        <ConfirmDialog
          open
          title={confirmReq.title}
          description={confirmReq.description}
          confirmLabel={confirmReq.label}
          destructive={confirmReq.destructive ?? false}
          pending={runConfirm.isPending}
          error={confirmError}
          onConfirm={() => {
            runConfirm.mutate(confirmReq);
          }}
          onOpenChange={(o) => {
            if (!o) setConfirmReq(null);
          }}
        />
      ) : null}
    </Page>
  );
}
