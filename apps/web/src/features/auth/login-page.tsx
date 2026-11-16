import { zodResolver } from '@hookform/resolvers/zod';
import type { LoginResult } from '@hrm/shared-types';
import { Alert, Button, FormField, Input } from '@hrm/ui-web';
import { loginSchema, recoveryCodeSchema, totpCodeSchema } from '@hrm/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { safeNext } from '@/lib/navigation';
import { AuthLayout } from './auth-layout';
import { establishSession } from './session';

const credentialsSchema = loginSchema.pick({ email: true, password: true });
type Credentials = z.input<typeof credentialsSchema>;

function CredentialsStep({ onMfa }: { onMfa: (token: string) => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await api.post<LoginResult>('/auth/login', values, { skipAuthRefresh: true });
      if (result.mfaRequired) {
        onMfa(result.mfaToken);
        return;
      }
      await establishSession(result);
      void navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['email', 'password']));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
      {formError ? <Alert tone="destructive">{formError}</Alert> : null}
      <FormField label="Email" error={errors.email?.message} required>
        <Input type="email" autoComplete="username" autoFocus {...form.register('email')} />
      </FormField>
      <FormField label="Password" error={errors.password?.message} required>
        <Input type="password" autoComplete="current-password" {...form.register('password')} />
      </FormField>
      <div className="-mt-1 text-right">
        <Link to="/forgot-password" className="text-sm text-primary hover:underline">
          Forgot password?
        </Link>
      </div>
      <Button type="submit" size="lg" disabled={isSubmitting} aria-busy={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

const codeSchema = z.object({ code: totpCodeSchema });
const recoverySchema = z.object({ recoveryCode: recoveryCodeSchema });

function MfaStep({ mfaToken, onRestart }: { mfaToken: string; onRestart: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [useRecovery, setUseRecovery] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const totpForm = useForm<z.input<typeof codeSchema>>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: '' },
  });
  const recoveryForm = useForm<z.input<typeof recoverySchema>>({
    resolver: zodResolver(recoverySchema),
    defaultValues: { recoveryCode: '' },
  });

  const verify = async (body: { code?: string; recoveryCode?: string }) => {
    setFormError(null);
    try {
      const tokens = await api.post<LoginResult>(
        '/auth/mfa/verify',
        { mfaToken, ...body },
        { skipAuthRefresh: true },
      );
      if (tokens.mfaRequired) throw new Error('Unexpected second challenge');
      await establishSession(tokens);
      void navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {formError ? <Alert tone="destructive">{formError}</Alert> : null}
      {useRecovery ? (
        <form
          onSubmit={(e) => void recoveryForm.handleSubmit((v) => verify(v))(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            label="Recovery code"
            error={recoveryForm.formState.errors.recoveryCode?.message}
            required
          >
            <Input
              autoComplete="one-time-code"
              autoFocus
              placeholder="abcde-12345"
              {...recoveryForm.register('recoveryCode')}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={recoveryForm.formState.isSubmitting}>
            Verify
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => void totpForm.handleSubmit((v) => verify(v))(e)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            label="Authentication code"
            description="Enter the 6-digit code from your authenticator app."
            error={totpForm.formState.errors.code?.message}
            required
          >
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              {...totpForm.register('code')}
            />
          </FormField>
          <Button type="submit" size="lg" disabled={totpForm.formState.isSubmitting}>
            Verify
          </Button>
        </form>
      )}
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => {
            setUseRecovery((v) => !v);
          }}
        >
          {useRecovery ? 'Use authenticator code' : 'Use a recovery code'}
        </button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={onRestart}>
          Start over
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  return (
    <AuthLayout
      title={mfaToken ? 'Two-factor verification' : 'Sign in'}
      description={
        mfaToken ? 'Your account is protected with two-factor authentication.' : 'Welcome back.'
      }
      footer={
        mfaToken ? null : (
          <>
            New to HRM Platform?{' '}
            <Link to="/register" className="text-primary hover:underline">
              Create an organization
            </Link>
          </>
        )
      }
    >
      {mfaToken ? (
        <MfaStep
          mfaToken={mfaToken}
          onRestart={() => {
            setMfaToken(null);
          }}
        />
      ) : (
        <CredentialsStep onMfa={setMfaToken} />
      )}
    </AuthLayout>
  );
}
