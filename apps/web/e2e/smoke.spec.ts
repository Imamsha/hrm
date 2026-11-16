import { expect, test } from '@playwright/test';

test('system status shows live data from the API', async ({ page }) => {
  await page.goto('/system/status');
  await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();
  await expect(page.getByText('All systems operational')).toBeVisible({ timeout: 15_000 });
  const table = page.getByRole('table', { name: 'Dependency health' });
  await expect(table.getByText('PostgreSQL')).toBeVisible();
  await expect(table.getByText('Operational')).toHaveCount(4);
});

test('theme can be switched to dark and persists across reloads', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  await page.goto('/');
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('mobile navigation opens as a drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile only');
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'System status' }).click();
  await expect(page).toHaveURL(/\/system\/status$/);
  await expect(page.getByRole('dialog')).toBeHidden();
});
