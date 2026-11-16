import { zodResolver } from '@hookform/resolvers/zod';
import { type OrganizationDetails, PERMISSIONS, type SubscriptionDetails } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Select,
  Skeleton,
} from '@hrm/ui-web';
import { currencySchema, localeSchema, requiredText, timezoneSchema } from '@hrm/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Page, PageHeader } from '@/app/layout/page';
import { Can } from '@/app/guards';
import { usePermission } from '@/features/auth/auth-store';
import { loadSession } from '@/features/auth/session';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

const schema = z.object({
  name: requiredText(200),
  legalName: z.string().trim().max(300),
  defaultTimezone: timezoneSchema,
  defaultCurrency: currencySchema,
  defaultLocale: localeSchema,
});
type Values = z.input<typeof schema>;
const FIELDS = [
  'name',
  'legalName',
  'defaultTimezone',
  'defaultCurrency',
  'defaultLocale',
] as const;

const LOCALES = ['en-IN', 'hi-IN', 'en-US', 'en-GB', 'en-AE', 'en-SG'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

function supportedTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? ['Asia/Kolkata', 'UTC'];
}

function SettingsForm({ org }: { org: OrganizationDetails }) {
  const queryClient = useQueryClient();
  const canEdit = usePermission(PERMISSIONS.ORGANIZATION_SETTINGS_UPDATE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const toValues = (o: OrganizationDetails): Values => ({
    name: o.name,
    legalName: o.legalName ?? '',
    defaultTimezone: o.defaultTimezone,
    defaultCurrency: o.defaultCurrency,
    defaultLocale: o.defaultLocale,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(org) });
  useEffect(() => {
    form.reset(toValues(org));
  }, [org, form]);

  const timeZones = useMemo(
    () => supportedTimeZones().map((tz) => ({ value: tz, label: tz.replace(/_/g, ' ') })),
    [],
  );
  const currencyNames = useMemo(() => new Intl.DisplayNames(['en'], { type: 'currency' }), []);
  const localeNames = useMemo(() => new Intl.DisplayNames(['en'], { type: 'language' }), []);

  const save = useMutation({
    mutationFn: (values: Values) => {
      const dirty = form.formState.dirtyFields;
      const changed = Object.fromEntries(
        Object.entries(values)
          .filter(([k]) => dirty[k as keyof Values])
          .map(([k, v]) => [k, k === 'legalName' && v === '' ? null : v]),
      );
      return api.patch<OrganizationDetails>('/organizations/current', changed);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(['organization', 'current'], updated);
      form.reset(toValues(updated));
      setSaved(true);
      await loadSession(); // organization name in the switcher
    },
    onError: (err) => {
      setFormError(applyServerErrors(err, form.setError, FIELDS));
    },
  });

  const { errors, isDirty } = form.formState;
  return (
    <Card>
      <form
        noValidate
        onSubmit={(e) =>
          void form.handleSubmit((v) => {
            setFormError(null);
            setSaved(false);
            save.mutate(v);
          })(e)
        }
      >
        <CardHeader>
          <CardTitle>Profile & defaults</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {formError ? <Alert tone="destructive">{formError}</Alert> : null}
          {saved ? <Alert tone="success">Settings saved.</Alert> : null}
          <fieldset disabled={!canEdit} className="contents">
            <FormGrid columns={2}>
              <FormField label="Display name" error={errors.name?.message} required>
                <Input {...form.register('name')} />
              </FormField>
              <FormField
                label="Legal name"
                error={errors.legalName?.message}
                description="As registered with authorities."
              >
                <Input {...form.register('legalName')} />
              </FormField>
              <FormField label="Time zone" error={errors.defaultTimezone?.message} required>
                <Controller
                  control={form.control}
                  name="defaultTimezone"
                  render={({ field }) => <Select options={timeZones} {...field} />}
                />
              </FormField>
              <FormField label="Currency" error={errors.defaultCurrency?.message} required>
                <Controller
                  control={form.control}
                  name="defaultCurrency"
                  render={({ field }) => (
                    <Select
                      options={CURRENCIES.map((c) => ({
                        value: c,
                        label: `${c} — ${currencyNames.of(c) ?? c}`,
                      }))}
                      {...field}
                    />
                  )}
                />
              </FormField>
              <FormField label="Locale" error={errors.defaultLocale?.message} required>
                <Controller
                  control={form.control}
                  name="defaultLocale"
                  render={({ field }) => (
                    <Select
                      options={LOCALES.map((l) => ({
                        value: l,
                        label: `${localeNames.of(l) ?? l} (${l})`,
                      }))}
                      {...field}
                    />
                  )}
                />
              </FormField>
              <FormField label="Organization URL">
                <Input value={org.slug} readOnly disabled />
              </FormField>
            </FormGrid>
          </fieldset>
        </CardContent>
        {canEdit ? (
          <CardFooter className="justify-end">
            <Button
              variant="outline"
              disabled={!isDirty || save.isPending}
              onClick={() => {
                form.reset();
              }}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!isDirty || save.isPending} aria-busy={save.isPending}>
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

function SubscriptionCard() {
  const sub = useQuery({
    queryKey: ['organization', 'subscription'],
    queryFn: () => api.get<SubscriptionDetails>('/organizations/current/subscription'),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        {sub.data ? (
          <Badge
            variant={
              sub.data.status === 'ACTIVE'
                ? 'success'
                : sub.data.status === 'TRIALING'
                  ? 'info'
                  : 'warning'
            }
          >
            {sub.data.status === 'TRIALING' ? 'Trial' : sub.data.status.toLowerCase()}
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent>
        {sub.isPending ? (
          <Skeleton className="h-10" />
        ) : sub.isError ? (
          <p className="text-sm text-destructive">{errorMessage(sub.error)}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted-foreground">Plan</dt>
              <dd className="font-medium">{sub.data.planName}</dd>
            </div>
            {sub.data.trialEndsAt ? (
              <div>
                <dt className="text-sm text-muted-foreground">Trial ends</dt>
                <dd className="font-medium tabular">
                  {new Date(sub.data.trialEndsAt).toLocaleDateString()}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function OrganizationSettingsPage() {
  const org = useQuery({
    queryKey: ['organization', 'current'],
    queryFn: () => api.get<OrganizationDetails>('/organizations/current'),
  });
  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Organization"
        description="Profile and regional defaults used across modules."
      />
      <div className="flex flex-col gap-4">
        {org.isPending ? (
          <Skeleton className="h-72" />
        ) : org.isError ? (
          <Card>
            <ErrorState description={errorMessage(org.error)} onRetry={() => void org.refetch()} />
          </Card>
        ) : (
          <SettingsForm org={org.data} />
        )}
        <Can permission={PERMISSIONS.SUBSCRIPTION_PLAN_READ}>
          <SubscriptionCard />
        </Can>
      </div>
    </Page>
  );
}
