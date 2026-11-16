import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, FormField, Input } from '@hrm/ui-web';
import { forgotPasswordSchema, passwordSchema } from '@hrm/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { AuthLayout } from './auth-layout';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post('/auth/password/forgot', values, { skipAuthRefresh: true });
      setSent(true);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['email']));
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      description="We will e-mail you a link to choose a new password."
      footer={
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success" title="Check your inbox">
          If an account exists for that address, a reset link is on its way. It expires in 30
          minutes.
        </Alert>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="destructive">{formError}</Alert> : null}
          <FormField label="Email" error={form.formState.errors.email?.message} required>
            <Input type="email" autoComplete="email" autoFocus {...form.register('email')} />
          </FormField>
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirm: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.post(
        '/auth/password/reset',
        { token, password: values.password },
        { skipAuthRefresh: true },
      );
      setDone(true);
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['password']));
    }
  });

  return (
    <AuthLayout title="Choose a new password" description="All other devices will be signed out.">
      {!token ? (
        <Alert tone="destructive">This reset link is incomplete. Request a new one.</Alert>
      ) : done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="Password updated">
            You can now sign in with your new password.
          </Alert>
          <Button asChild size="lg">
            <Link to="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="destructive">{formError}</Alert> : null}
          <FormField label="New password" error={form.formState.errors.password?.message} required>
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              {...form.register('password')}
            />
          </FormField>
          <FormField
            label="Confirm password"
            error={form.formState.errors.confirm?.message}
            required
          >
            <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
          </FormField>
          <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
