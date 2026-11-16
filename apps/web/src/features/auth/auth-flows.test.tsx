import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/features/auth/auth-store';
import { safeNext } from '@/lib/navigation';
import { fail, ok, renderAt, sessionFixture, signOutForTest, stubFetch } from '@/test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  signOutForTest();
});

describe('route guards', () => {
  it('redirects anonymous users to sign in, preserving the destination', async () => {
    signOutForTest();
    stubFetch(() => ok(null));
    const { router } = renderAt('/admin/members?page=2');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(
      '/admin/members?page=2',
    );
  });

  it('only follows same-origin relative redirects', () => {
    expect(safeNext('/admin/members')).toBe('/admin/members');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});

describe('sign in', () => {
  it('signs in with password and lands on the requested page', async () => {
    signOutForTest();
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.endsWith('/auth/login')) return ok({ accessToken: 'at-1', expiresIn: 900 });
      if (c.url.endsWith('/auth/me')) return ok(sessionFixture(['organization.settings.read']));
      return ok({ status: 'ok', version: '0', environment: 'test', uptimeSeconds: 1, checks: {} });
    });
    const { router } = renderAt('/login?next=%2Faccount%2Fsecurity');

    await user.type(screen.getByLabelText(/Email/), 'asha@acme.test');
    await user.type(screen.getByLabelText(/Password/), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/account/security');
    });
    expect(calls.find((c) => c.url.endsWith('/auth/login'))?.body).toEqual({
      email: 'asha@acme.test',
      password: 'correct horse battery',
    });
    expect(useAuth.getState().accessToken).toBe('at-1');
  });

  it('asks for the second factor when MFA is enabled', async () => {
    signOutForTest();
    const user = userEvent.setup();
    const calls = stubFetch((c) => {
      if (c.url.endsWith('/auth/login')) return ok({ mfaRequired: true, mfaToken: 'mfa-1' });
      if (c.url.endsWith('/auth/mfa/verify')) return ok({ accessToken: 'at-2', expiresIn: 900 });
      if (c.url.endsWith('/auth/me')) return ok(sessionFixture());
      return ok(null);
    });
    renderAt('/login');
    await user.type(screen.getByLabelText(/Email/), 'asha@acme.test');
    await user.type(screen.getByLabelText(/Password/), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor verification' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Enter the 6-digit code')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Authentication code/), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => {
      expect(useAuth.getState().accessToken).toBe('at-2');
    });
    expect(calls.find((c) => c.url.endsWith('/auth/mfa/verify'))?.body).toEqual({
      mfaToken: 'mfa-1',
      code: '123456',
    });
  });

  it('shows the API error without revealing which field was wrong', async () => {
    signOutForTest();
    const user = userEvent.setup();
    stubFetch(() => fail(401, 'UNAUTHENTICATED', 'Invalid email or password'));
    renderAt('/login');
    await user.type(screen.getByLabelText(/Email/), 'asha@acme.test');
    await user.type(screen.getByLabelText(/Password/), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});

describe('registration', () => {
  it('validates on submit and maps server field errors', async () => {
    signOutForTest();
    const user = userEvent.setup();
    stubFetch(() =>
      fail(400, 'VALIDATION_FAILED', 'Password must not contain your name or e-mail address', [
        { path: 'password', message: 'Password must not contain your name or e-mail address' },
      ]),
    );
    renderAt('/register');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(/Organization name/), 'Acme');
    await user.type(screen.getByLabelText(/Your full name/), 'Asha Rao');
    await user.type(screen.getByLabelText(/Work email/), 'asha@acme.test');
    await user.type(screen.getByLabelText(/^Password/), 'asha-rao-password-1');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(
      await screen.findByText('Password must not contain your name or e-mail address'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('aria-invalid', 'true');
  });
});
