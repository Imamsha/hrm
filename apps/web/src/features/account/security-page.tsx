import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthEventItem, MfaEnabledResult, MfaSetup, SessionListItem } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormField,
  FormGrid,
  Input,
  Skeleton,
} from '@hrm/ui-web';
import { changePasswordSchema, mfaDisableSchema, mfaEnableSchema } from '@hrm/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toDataURL } from 'qrcode';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Page, PageHeader } from '@/app/layout/page';
import { useAuth } from '@/features/auth/auth-store';
import { loadSession } from '@/features/auth/session';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

function ChangePasswordCard() {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    setDone(false);
    try {
      await api.post('/auth/password/change', v);
      form.reset();
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['currentPassword', 'newPassword']));
    }
  });
  return (
    <Card>
      <form noValidate onSubmit={(e) => void onSubmit(e)}>
        <CardHeader>
          <div>
            <CardTitle>Password</CardTitle>
            <CardDescription>Changing it signs you out on every other device.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {formError ? <Alert tone="destructive">{formError}</Alert> : null}
          {done ? (
            <Alert tone="success">Password changed. Other devices have been signed out.</Alert>
          ) : null}
          <FormGrid columns={2}>
            <FormField
              label="Current password"
              error={form.formState.errors.currentPassword?.message}
              required
            >
              <Input
                type="password"
                autoComplete="current-password"
                {...form.register('currentPassword')}
              />
            </FormField>
            <FormField
              label="New password"
              error={form.formState.errors.newPassword?.message}
              required
            >
              <Input
                type="password"
                autoComplete="new-password"
                {...form.register('newPassword')}
              />
            </FormField>
          </FormGrid>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function MfaEnrollment({ onStart, onDone }: { onStart: () => void; onDone: () => void }) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof mfaEnableSchema>>({
    resolver: zodResolver(mfaEnableSchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    if (setup) void toDataURL(setup.otpauthUri, { margin: 1, width: 176 }).then(setQr);
  }, [setup]);

  const start = useMutation({
    mutationFn: () => api.post<MfaSetup>('/auth/mfa/totp/setup'),
    onSuccess: (s) => {
      onStart();
      setSetup(s);
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  const enable = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const res = await api.post<MfaEnabledResult>('/auth/mfa/totp/enable', v);
      setCodes(res.recoveryCodes);
      await loadSession();
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['code']));
    }
  });

  if (codes) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success" title="Two-factor authentication is on">
          Save these recovery codes somewhere safe. Each works once if you lose your authenticator.
          They will not be shown again.
        </Alert>
        <ul className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-3 font-mono text-md sm:grid-cols-5">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button onClick={onDone}>I have saved my codes</Button>
        </div>
      </div>
    );
  }
  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <div>
          <Button
            onClick={() => {
              start.mutate();
            }}
            disabled={start.isPending}
          >
            Set up authenticator app
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      noValidate
      onSubmit={(e) => void enable(e)}
      className="flex flex-col gap-4 sm:flex-row sm:items-start"
    >
      <div className="shrink-0 rounded-md border border-border bg-white p-2">
        {qr ? (
          <img src={qr} alt="QR code for your authenticator app" width={176} height={176} />
        ) : (
          <Skeleton className="size-44" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <p className="text-base">
          Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator,
          1Password…), or enter this key:
        </p>
        <code className="rounded-sm bg-muted px-2 py-1 font-mono text-sm break-all">
          {setup.secret}
        </code>
        <FormField label="6-digit code" error={form.formState.errors.code?.message} required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="max-w-40"
            {...form.register('code')}
          />
        </FormField>
        <div>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            Verify and turn on
          </Button>
        </div>
      </div>
    </form>
  );
}

function MfaDisable() {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof mfaDisableSchema>>({
    resolver: zodResolver(mfaDisableSchema),
    defaultValues: { password: '', code: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post('/auth/mfa/totp/disable', v);
      await loadSession();
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['password', 'code']));
    }
  });
  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <FormGrid columns={2}>
        <FormField label="Password" error={form.formState.errors.password?.message} required>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FormField>
        <FormField label="Authenticator code" error={form.formState.errors.code?.message} required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            {...form.register('code')}
          />
        </FormField>
      </FormGrid>
      <div>
        <Button type="submit" variant="destructive" disabled={form.formState.isSubmitting}>
          Turn off two-factor authentication
        </Button>
      </div>
    </form>
  );
}

function MfaCard() {
  const enabled = useAuth((s) => s.session?.user.mfaEnabled ?? false);
  // Stays true from "Set up" until the recovery codes are acknowledged, even after MFA turns on.
  const [enrolling, setEnrolling] = useState(false);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Require a code from your phone in addition to your password.
          </CardDescription>
        </div>
        <Badge variant={enabled ? 'success' : 'neutral'}>{enabled ? 'On' : 'Off'}</Badge>
      </CardHeader>
      <CardContent>
        {enabled && !enrolling ? (
          <MfaDisable />
        ) : (
          <MfaEnrollment
            onStart={() => {
              setEnrolling(true);
            }}
            onDone={() => {
              setEnrolling(false);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get<SessionListItem[]>('/auth/sessions'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {sessions.isPending ? (
          <div className="p-4">
            <Skeleton className="h-10" />
          </div>
        ) : sessions.isError ? (
          <p className="p-4 text-sm text-destructive">{errorMessage(sessions.error)}</p>
        ) : (
          <ul className="divide-y divide-border">
            {sessions.data.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {describeAgent(s.userAgent)}{' '}
                    {s.current ? <Badge variant="primary">This device</Badge> : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {s.ipAddress ?? 'Unknown IP'} · last active{' '}
                    {new Date(s.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {s.current ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      revoke.mutate(s.id);
                    }}
                    disabled={revoke.isPending}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const EVENT_LABELS: Record<string, string> = {
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  LOGIN_LOCKED: 'Account temporarily locked',
  LOGOUT: 'Signed out',
  LOGOUT_ALL: 'Signed out everywhere',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET_REQUESTED: 'Password reset requested',
  PASSWORD_RESET_COMPLETED: 'Password reset',
  MFA_ENABLED: 'Two-factor turned on',
  MFA_DISABLED: 'Two-factor turned off',
  MFA_CHALLENGE_FAILED: 'Wrong two-factor code',
  MFA_RECOVERY_CODE_USED: 'Recovery code used',
  TOKEN_REUSE_DETECTED: 'Suspicious token reuse — session ended',
  ORGANIZATION_SWITCHED: 'Switched organization',
  SESSION_REVOKED: 'Session signed out',
  REGISTERED: 'Account created',
};

function LoginHistoryCard() {
  const history = useQuery({
    queryKey: ['auth', 'history'],
    queryFn: () => api.get<AuthEventItem[]>('/auth/login-history'),
  });
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recent security activity</CardTitle>
          <CardDescription>The last 50 security events on your account.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {history.isPending ? (
          <div className="p-4">
            <Skeleton className="h-10" />
          </div>
        ) : history.isError ? (
          <p className="p-4 text-sm text-destructive">{errorMessage(history.error)}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {history.data.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <span
                  className={/FAILED|LOCKED|REUSE/.test(e.type) ? 'text-destructive' : undefined}
                >
                  {EVENT_LABELS[e.type] ?? e.type}
                </span>
                <span className="text-sm text-muted-foreground tabular">
                  {new Date(e.occurredAt).toLocaleString()} · {e.ipAddress ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function SecurityPage() {
  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Security"
        description="Password, two-factor authentication and signed-in devices."
      />
      <div className="flex flex-col gap-4">
        <ChangePasswordCard />
        <MfaCard />
        <SessionsCard />
        <LoginHistoryCard />
      </div>
    </Page>
  );
}
