import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'blue-tiger-river-2026';

/** Registers a brand-new organization through the UI and lands in the app. */
async function registerViaUi(page: Page) {
  const email = `e2e.${randomUUID().slice(0, 8)}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`E2E Org ${randomUUID().slice(0, 4)}`);
  await page.getByLabel('Your full name').fill('Esha Endtoend');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  return email;
}

test('protected pages redirect to sign in', async ({ page }) => {
  await page.goto('/system/status');
  await expect(page).toHaveURL(/\/login\?next=%2Fsystem%2Fstatus/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('register, see live system status and administration screens', async ({ page, isMobile }) => {
  await registerViaUi(page);

  await page.goto('/system/status');
  await expect(page.getByText('All systems operational')).toBeVisible({ timeout: 15_000 });
  const table = page.getByRole('table', { name: 'Dependency health' });
  await expect(table.getByText('Operational')).toHaveCount(4);

  test.skip(isMobile, 'Admin tables covered on desktop');
  await page.goto('/admin/members');
  const members = page.getByRole('table', { name: 'Members' });
  await expect(members.getByText('Esha Endtoend')).toBeVisible();
  await expect(members.getByText('Owner')).toBeVisible();

  await page.goto('/admin/roles');
  await expect(page.getByRole('table', { name: 'Roles' }).getByText('HR admin')).toBeVisible();
});

test('the session survives a reload and sign-out ends it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  const email = await registerViaUi(page);

  // Access token is memory-only; the httpOnly refresh cookie restores the session.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

test('theme can be switched to dark and persists across reloads', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  await registerViaUi(page);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('mobile navigation opens as a drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile only');
  await registerViaUi(page);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'System status' }).click();
  await expect(page).toHaveURL(/\/system\/status$/);
  await expect(page.getByRole('dialog')).toBeHidden();
});
