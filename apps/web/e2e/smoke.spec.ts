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
  // Password hashing (argon2id) is deliberately slow; allow for a loaded CI machine.
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });
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

test('build structure through the UI and see it on the org chart', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('ACME-IN');
  await dialog.getByLabel(/^Name/).fill('Acme India');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('table', { name: 'Companies' }).getByText('Acme India'),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'Departments' }).click();
  await page.getByRole('button', { name: /New department/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME-IN)' });
  await dialog.getByLabel(/^Code/).fill('ENG');
  await dialog.getByLabel(/^Name/).fill('Engineering');
  await dialog.getByRole('button', { name: 'Create department' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: /New department/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME-IN)' });
  await dialog.getByLabel(/^Code/).fill('PLAT');
  await dialog.getByLabel(/^Name/).fill('Platform');
  await dialog.getByLabel(/^Parent department/).selectOption({ label: 'Engineering (ENG)' });
  await dialog.getByRole('button', { name: 'Create department' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/organization/org-chart');
  const tree = page.getByRole('tree', { name: 'Acme India departments' });
  await expect(tree.getByText('Engineering')).toBeVisible();
  await expect(tree.getByText('Platform')).toBeVisible();
});

test('add an employee and maintain their profile', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('ACME');
  await dialog.getByLabel(/^Name/).fill('Acme India');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/people/employees');
  await page.getByRole('button', { name: /Add employee/ }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Next number: EMP-0001')).toBeVisible();
  await dialog.getByLabel(/^First name/).fill('Asha');
  await dialog.getByLabel(/^Last name/).fill('Rao');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();

  await expect(page.getByRole('heading', { name: /Asha Rao/ })).toBeVisible();
  await expect(page.getByText('EMP-0001').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Personal' }).click();
  await page
    .getByRole('heading', { name: 'Addresses' })
    .locator('..')
    .getByRole('button', { name: 'Add' })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Type/).selectOption('CURRENT');
  await dialog.getByLabel(/^Address line 1/).fill('1 MG Road');
  await dialog.getByLabel(/^City/).fill('Bengaluru');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('list', { name: 'Addresses' }).getByText('1 MG Road')).toBeVisible();

  await page.goto('/people/employees');
  await expect(page.getByRole('table', { name: 'Employees' }).getByText('Asha Rao')).toBeVisible();
});
