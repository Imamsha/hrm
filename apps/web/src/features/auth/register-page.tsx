import { zodResolver } from '@hookform/resolvers/zod';
import type { AuthTokens } from '@hrm/shared-types';
import { Alert, Button, FormField, Input } from '@hrm/ui-web';
import { PASSWORD_MIN_LENGTH, registerSchema } from '@hrm/validation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { AuthLayout } from './auth-layout';
import { establishSession } from './session';

const schema = registerSchema.omit({ tokenTransport: true, organizationSlug: true });
type Values = z.input<typeof schema>;
const FIELDS = ['organizationName', 'fullName', 'email', 'password'] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { organizationName: '', fullName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const tokens = await api.post<AuthTokens>('/auth/register', values, {
        skipAuthRefresh: true,
      });
      await establishSession(tokens);
      void navigate('/', { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, FIELDS));
    }
  });

  return (
    <AuthLayout
      title="Create your organization"
      description="You will be its owner and can invite your team next."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        {formError ? <Alert tone="destructive">{formError}</Alert> : null}
        <FormField label="Organization name" error={errors.organizationName?.message} required>
          <Input autoComplete="organization" autoFocus {...form.register('organizationName')} />
        </FormField>
        <FormField label="Your full name" error={errors.fullName?.message} required>
          <Input autoComplete="name" {...form.register('fullName')} />
        </FormField>
        <FormField label="Work email" error={errors.email?.message} required>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FormField>
        <FormField
          label="Password"
          description={`At least ${String(PASSWORD_MIN_LENGTH)} characters. A short phrase works well.`}
          error={errors.password?.message}
          required
        >
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FormField>
        <Button type="submit" size="lg" disabled={isSubmitting} aria-busy={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create organization'}
        </Button>
      </form>
    </AuthLayout>
  );
}
