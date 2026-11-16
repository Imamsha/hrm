import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthTokens, InvitationPreview } from '@hrm/shared-types';
import { Alert, Button, FormField, Input, Skeleton } from '@hrm/ui-web';
import { passwordSchema, requiredText } from '@hrm/validation';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { AuthLayout } from './auth-layout';
import { useAuth } from './auth-store';
import { establishSession, loadSession, switchOrganization } from './session';
import { useQueryClient } from '@tanstack/react-query';

const newAccountSchema = z
  .object({ fullName: requiredText(200), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

function NewAccountForm({ token, preview }: { token: string; preview: InvitationPreview }) {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof newAccountSchema>>({
    resolver: zodResolver(newAccountSchema),
    defaultValues: { fullName: preview.fullName ?? '', password: '', confirm: '' },
  });
  const onSubmit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      const res = await api.post<AuthTokens & { organizationId: string }>(
        '/invitations/accept',
        { token, fullName: v.fullName, password: v.password },
        { skipAuthRefresh: true },
      );
      await establishSession(res);
      void navigate('/', { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['fullName', 'password']));
    }
  });
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
      {formError ? <Alert tone="destructive">{formError}</Alert> : null}
      <FormField label="Email">
        <Input value={preview.email} readOnly disabled />
      </FormField>
      <FormField label="Full name" error={form.formState.errors.fullName?.message} required>
        <Input autoComplete="name" autoFocus {...form.register('fullName')} />
      </FormField>
      <FormField label="Password" error={form.formState.errors.password?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register('password')} />
      </FormField>
      <FormField label="Confirm password" error={form.formState.errors.confirm?.message} required>
        <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
      </FormField>
      <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
        Join {preview.organizationName}
      </Button>
    </form>
  );
}

function ExistingAccount({ token, preview }: { token: string; preview: InvitationPreview }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useAuth((s) => s.session);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedInAsInvitee = session?.user.email === preview.email;

  if (!signedInAsInvitee) {
    const next = `/accept-invitation?token=${encodeURIComponent(token)}`;
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="info">
          An account already exists for <strong>{preview.email}</strong>. Sign in as that account to
          accept.
          {session ? ` You are currently signed in as ${session.user.email}.` : ''}
        </Alert>
        <Button asChild size="lg">
          <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in as {preview.email}</Link>
        </Button>
      </div>
    );
  }

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ organizationId: string }>('/invitations/accept', { token });
      await loadSession();
      await switchOrganization(queryClient, res.organizationId);
      void navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="destructive">{error}</Alert> : null}
      <Button size="lg" onClick={() => void accept()} disabled={busy} aria-busy={busy}>
        Join {preview.organizationName}
      </Button>
    </div>
  );
}

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    queryFn: () =>
      api.get<InvitationPreview>('/invitations/preview', {
        query: { token },
        skipAuthRefresh: true,
      }),
    enabled: token.length > 0,
    retry: false,
  });

  return (
    <AuthLayout
      title={preview.data ? `Join ${preview.data.organizationName}` : 'Accept invitation'}
      description={preview.data ? `You were invited as ${preview.data.email}.` : undefined}
    >
      {!token ? (
        <Alert tone="destructive">This invitation link is incomplete.</Alert>
      ) : preview.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
        </div>
      ) : preview.isError ? (
        <Alert tone="destructive">{errorMessage(preview.error)}</Alert>
      ) : preview.data.accountExists ? (
        <ExistingAccount token={token} preview={preview.data} />
      ) : (
        <NewAccountForm token={token} preview={preview.data} />
      )}
    </AuthLayout>
  );
}
