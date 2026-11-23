import type { PublicCareers, PublicOpening } from '@hrm/shared-types';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { DOCUMENT_MAX_BYTES, portalApplicationSchema } from '@hrm/validation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorMessage } from '@/lib/api';
import { env } from '@/lib/env';
import { formatMoney } from './recruit-api';

const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERN: 'Internship',
  CONSULTANT: 'Consultant',
};

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-4 py-4 md:px-8">
        <p className="text-lg font-semibold">{title}</p>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}

function experience(o: PublicOpening): string | null {
  if (o.experienceMinYears === null && o.experienceMaxYears === null) return null;
  if (o.experienceMaxYears === null) return `${String(o.experienceMinYears)}+ years`;
  return `${String(o.experienceMinYears ?? 0)}–${String(o.experienceMaxYears)} years`;
}

/** Public list of an organization's open positions (no sign-in). */
export function CareersPage() {
  const { org = '' } = useParams<{ org: string }>();
  const careers = useQuery({
    queryKey: ['careers', org],
    queryFn: () => api.get<PublicCareers>(`/careers/${org}/jobs`, { skipAuthRefresh: true }),
  });
  if (careers.isPending)
    return (
      <Shell title="Careers">
        <Skeleton className="h-40" />
      </Shell>
    );
  if (careers.isError)
    return (
      <Shell title="Careers">
        <ErrorState
          title="This career site is not available"
          description={errorMessage(careers.error)}
        />
      </Shell>
    );
  const c = careers.data;
  return (
    <Shell title={`Careers at ${c.organization.name}`}>
      {c.openings.length === 0 ? (
        <EmptyState title="No open positions right now" description="Please check back later." />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Open positions">
          {c.openings.map((o) => (
            <li key={o.slug}>
              <Link
                to={`/careers/${org}/${o.slug}`}
                className="block rounded-lg border border-border p-4 hover:bg-accent"
              >
                <p className="text-md font-medium">{o.title}</p>
                <p className="text-sm text-muted-foreground">
                  {[o.company, o.location, TYPE_LABEL[o.employmentType], experience(o)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

/** A public job page with the application form (resume + consent). */
export function CareerJobPage() {
  const { org = '', slug = '' } = useParams<{ org: string; slug: string }>();
  const job = useQuery({
    queryKey: ['careers', org, slug],
    queryFn: () =>
      api.get<PublicOpening>(`/careers/${org}/jobs/${slug}`, { skipAuthRefresh: true }),
  });
  const [fields, setFields] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    currentCompany: '',
    currentTitle: '',
    location: '',
    coverLetter: '',
  });
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v.trim()) form.append(k, v.trim());
      form.append('consent', String(consent));
      if (file) form.append('resume', file);
      const res = await fetch(`${env.apiBaseUrl}/careers/${org}/jobs/${slug}/applications`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; details?: { message: string }[] };
        } | null;
        throw new Error(
          body?.error?.details?.[0]?.message ??
            body?.error?.message ??
            'Could not submit your application',
        );
      }
    },
    onError: (e) => {
      setError(errorMessage(e));
    },
  });
  if (job.isPending)
    return (
      <Shell title="Careers">
        <Skeleton className="h-64" />
      </Shell>
    );
  if (job.isError)
    return (
      <Shell title="Careers">
        <ErrorState title="This position is not available" description={errorMessage(job.error)} />
      </Shell>
    );
  const o = job.data;
  const set =
    (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFields((f) => ({ ...f, [k]: e.target.value }));
    };
  const submit = () => {
    const parsed = portalApplicationSchema.safeParse({ ...fields, consent: String(consent) });
    const problem = !parsed.success
      ? (parsed.error.issues[0]?.message ?? 'Check the form')
      : !file
        ? 'Attach your resume (PDF or image)'
        : file.size > DOCUMENT_MAX_BYTES
          ? 'Your resume can be at most 10 MB'
          : null;
    setError(problem);
    if (problem) return;
    apply.mutate();
  };
  return (
    <Shell title={o.company}>
      <Link to={`/careers/${org}`} className="text-sm text-primary hover:underline">
        ← All positions
      </Link>
      <h1 className="mt-2 text-xl font-semibold">{o.title}</h1>
      <p className="text-muted-foreground">
        {[o.location, TYPE_LABEL[o.employmentType], experience(o)].filter(Boolean).join(' · ')}
        {o.salary
          ? ` · ${formatMoney(o.salary.min, o.salary.currency)}${o.salary.max ? ` – ${formatMoney(o.salary.max, o.salary.currency)}` : ''}`
          : ''}
      </p>
      <section className="mt-4 whitespace-pre-line">{o.description}</section>
      {o.requirements ? (
        <section className="mt-4">
          <h2 className="font-medium">Requirements</h2>
          <p className="whitespace-pre-line">{o.requirements}</p>
        </section>
      ) : null}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Apply</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {apply.isSuccess ? (
            <Alert tone="success">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4" /> Thank you — your application has been received.
              </span>
            </Alert>
          ) : (
            <>
              {error ? <Alert tone="destructive">{error}</Alert> : null}
              <FormGrid columns={2}>
                <FormField label="First name" required>
                  <Input
                    value={fields.firstName}
                    onChange={set('firstName')}
                    autoComplete="given-name"
                  />
                </FormField>
                <FormField label="Last name">
                  <Input
                    value={fields.lastName}
                    onChange={set('lastName')}
                    autoComplete="family-name"
                  />
                </FormField>
                <FormField label="E-mail" required>
                  <Input
                    type="email"
                    value={fields.email}
                    onChange={set('email')}
                    autoComplete="email"
                  />
                </FormField>
                <FormField label="Phone" required>
                  <Input value={fields.phone} onChange={set('phone')} autoComplete="tel" />
                </FormField>
                <FormField label="Current company">
                  <Input value={fields.currentCompany} onChange={set('currentCompany')} />
                </FormField>
                <FormField label="Current title">
                  <Input value={fields.currentTitle} onChange={set('currentTitle')} />
                </FormField>
                <FormField label="Location">
                  <Input value={fields.location} onChange={set('location')} />
                </FormField>
                <FormField
                  label="Resume"
                  required
                  description="PDF, PNG, JPEG or WebP; up to 10 MB."
                >
                  <Input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                    }}
                  />
                </FormField>
                <FormField label="Cover letter" className="sm:col-span-2">
                  <Textarea value={fields.coverLetter} onChange={set('coverLetter')} />
                </FormField>
              </FormGrid>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={consent}
                  onCheckedChange={(v) => {
                    setConsent(v === true);
                  }}
                  className="mt-0.5"
                />
                <span>
                  I agree that {o.company} may store and process the information I provide,
                  including my resume, to consider me for this and future positions.
                </span>
              </label>
              <div>
                <Button onClick={submit} disabled={apply.isPending} aria-busy={apply.isPending}>
                  Submit application
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Shell>
  );
}
