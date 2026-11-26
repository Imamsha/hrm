import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';

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

test('clock in and see a leave balance as a linked employee', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('ACME');
  await dialog.getByLabel(/^Name/).fill('Acme India');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();

  // The owner becomes an employee linked to their own login.
  await page.goto('/people/employees');
  await page.getByRole('button', { name: /Add employee/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^First name/).fill('Esha');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Esha/ })).toBeVisible();
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Link login account' }).click();
  dialog = page.getByRole('dialog');
  // Options: placeholder, “Not linked”, then the only member (the signed-in owner).
  await dialog.getByLabel('Member').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/me/attendance');
  await page.getByRole('button', { name: /Clock in/ }).click();
  await expect(page.getByRole('button', { name: /Clock out/ })).toBeVisible();
  await expect(page.getByRole('list', { name: "Today's punches" }).getByText(/^IN /)).toBeVisible();

  await page.goto('/time/policies');
  await page.getByRole('button', { name: /New leave type/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('CL');
  await dialog.getByLabel(/^Name/).fill('Casual leave');
  await dialog.getByLabel(/^Days per leave year/).fill('12');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/me/leave');
  const balances = page.getByRole('list', { name: 'Leave balances' });
  await expect(balances.getByText('Casual leave')).toBeVisible();
  await expect(balances.getByText('12.00')).toBeVisible();
});

const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

/** Polls Mailpit for the newest e-mail to `to` and returns the token of the given link. */
async function tokenFromMail(to: string, path: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`,
    );
    if (res.ok) {
      const list = (await res.json()) as { messages: { ID: string }[] };
      const id = list.messages[0]?.ID;
      if (id) {
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as {
          Text: string;
        };
        const match = new RegExp(`${path}\\?token=([A-Za-z0-9_%-]+)`).exec(msg.Text);
        if (match?.[1]) return decodeURIComponent(match[1]);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No ${path} e-mail to ${to}`);
}

test('hire through an approved requisition and the public career site', async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(120_000);
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('ACME');
  await dialog.getByLabel(/^Name/).fill('Acme India');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();

  // A second HR admin approves: nobody approves their own requisition.
  const hrEmail = `hr.${randomUUID().slice(0, 8)}@example.test`;
  await page.goto('/admin/members');
  await page.getByRole('button', { name: /Invite member/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Email/).fill(hrEmail);
  await dialog.getByRole('checkbox', { name: /HR admin/ }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/recruitment/requisitions');
  await page.getByRole('button', { name: /New requisition/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Role/).fill('Backend Engineer');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByLabel(/^Headcount/).fill('1');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  const requisitions = page.getByRole('table', { name: 'Requisitions' });
  await requisitions.getByRole('button', { name: 'Submit' }).click();
  await expect(requisitions.getByText('submitted')).toBeVisible();
  // The requester cannot approve their own requisition.
  await expect(requisitions.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  const token = await tokenFromMail(hrEmail, '/accept-invitation');
  const hrContext = await browser.newContext();
  const hr = await hrContext.newPage();
  await hr.goto(`/accept-invitation?token=${encodeURIComponent(token)}`);
  await hr.getByLabel(/^Full name/).fill('Hari Recruiter');
  await hr.getByLabel(/^Password/).fill(PASSWORD);
  await hr.getByLabel(/^Confirm password/).fill(PASSWORD);
  await hr.getByRole('button', { name: /^Join/ }).click();
  await expect(hr.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });

  await hr.goto('/recruitment/requisitions');
  await hr
    .getByRole('table', { name: 'Requisitions' })
    .getByRole('button', { name: 'Approve' })
    .click();
  await expect(hr.getByRole('table', { name: 'Requisitions' }).getByText('approved')).toBeVisible();

  await hr.goto('/recruitment/openings');
  await hr.getByRole('button', { name: /New opening/ }).click();
  dialog = hr.getByRole('dialog');
  await dialog.getByLabel(/^Job title/).fill('Backend Engineer');
  await dialog.getByLabel(/^Requisition/).selectOption({ label: 'Backend Engineer' });
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByLabel(/^Positions/).fill('1');
  await dialog.getByLabel(/^Location/).fill('Bengaluru');
  await dialog.getByLabel(/^Description/).fill('Build reliable APIs for our HR platform.');
  await dialog.getByRole('button', { name: 'Create opening' }).click();
  await expect(hr.getByRole('heading', { name: 'Backend Engineer' })).toBeVisible();
  await hr.getByRole('button', { name: 'Publish' }).click();
  const careerLink = hr.getByRole('link', { name: 'Career site page' });
  await expect(careerLink).toBeVisible();
  const jobPath = await careerLink.getAttribute('href');
  expect(jobPath).toMatch(/^\/careers\/[^/]+\/[^/]+$/);

  // An applicant, not signed in, applies on the public career site.
  const publicContext = await browser.newContext();
  const visitor = await publicContext.newPage();
  await visitor.goto(String(jobPath).split('/').slice(0, 3).join('/'));
  await visitor
    .getByRole('list', { name: 'Open positions' })
    .getByRole('link', { name: /Backend Engineer/ })
    .click();
  await visitor.getByLabel(/^First name/).fill('Ravi');
  await visitor.getByLabel(/^Last name/).fill('Kumar');
  await visitor.getByLabel(/^E-mail/).fill(`ravi.${randomUUID().slice(0, 6)}@example.test`);
  await visitor.getByLabel(/^Phone/).fill('+919812345678');
  await visitor.getByLabel(/^Resume/).setInputFiles({
    name: 'ravi-kumar.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  });
  await visitor.getByRole('checkbox').click();
  await visitor.getByRole('button', { name: 'Submit application' }).click();
  await expect(visitor.getByText(/your application has been received/)).toBeVisible();

  await hr.reload();
  await expect(
    hr.getByRole('list', { name: 'Applied candidates' }).getByText('Ravi Kumar'),
  ).toBeVisible();
  await hrContext.close();
  await publicContext.close();
});

/** Invites a member with one system role and returns a signed-in page for them. */
async function invitedPage(page: Page, browser: Browser, roleName: RegExp, fullName: string) {
  const email = `invitee.${randomUUID().slice(0, 8)}@example.test`;
  await page.goto('/admin/members');
  await page.getByRole('button', { name: /Invite member/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Email/).fill(email);
  await dialog.getByRole('checkbox', { name: roleName }).click();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog).toBeHidden();
  const token = await tokenFromMail(email, '/accept-invitation');
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(`/accept-invitation?token=${encodeURIComponent(token)}`);
  await other.getByLabel(/^Full name/).fill(fullName);
  await other.getByLabel(/^Password/).fill(PASSWORD);
  await other.getByLabel(/^Confirm password/).fill(PASSWORD);
  await other.getByRole('button', { name: /^Join/ }).click();
  await expect(other.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 15_000 });
  return { page: other, context };
}

// Statutory values below are FICTIONAL test numbers, not real rates.
test('run payroll from configured rules to a finalized payslip', async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(150_000);
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('PAY');
  await dialog.getByLabel(/^Name/).fill('Pay Co');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();

  // Components and a structure: basic 40 % of CTC, the balance as special allowance.
  await page.goto('/payroll/setup?tab=components');
  const components: [string, string, boolean][] = [
    ['BASIC', 'Basic', true],
    ['SPECIAL', 'Special allowance', false],
  ];
  for (const [code, name, pf] of components) {
    await page.getByRole('button', { name: /New component/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Code/).fill(code);
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByLabel(/^Kind/).selectOption('EARNING');
    if (pf) await dialog.getByRole('checkbox', { name: 'PF wages' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
  }
  await page.getByRole('tab', { name: 'Structures' }).click();
  await page.getByRole('button', { name: /New structure/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name/).fill('Standard');
  await dialog.getByLabel('Line 1 component').selectOption({ label: 'Basic (BASIC)' });
  await dialog.getByLabel('Line 1 calculation').selectOption('PERCENT_OF_CTC');
  await dialog.getByLabel('Line 1 value').fill('40');
  await dialog.getByRole('button', { name: /Add component/ }).click();
  await dialog
    .getByLabel('Line 2 component')
    .selectOption({ label: 'Special allowance (SPECIAL)' });
  await dialog.getByLabel('Line 2 calculation').selectOption('BALANCING');
  await dialog.getByRole('button', { name: 'Create structure' }).click();
  await expect(dialog).toBeHidden();

  // A sourced EPF rule set, activated.
  await page.goto('/payroll/statutory');
  await page.getByRole('button', { name: /New rule set/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Rule type/).selectOption('EPF');
  await dialog.getByLabel(/^Name/).fill('EPF (test values)');
  await dialog.getByLabel(/^Effective from/).fill('2025-04-01');
  await dialog.getByLabel(/^Source/).fill('Fictional E2E notification');
  await dialog.getByLabel(/^Employee rate/).fill('10');
  await dialog.getByLabel(/^Employer rate/).fill('10');
  await dialog.getByLabel(/^Pension \(EPS\) share/).fill('6');
  await dialog.getByLabel(/^Wage ceiling/).fill('20000');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(dialog).toBeHidden();
  const rules = page.getByRole('table', { name: 'Statutory rule sets' });
  await rules.getByRole('button', { name: 'Activate' }).click();
  await expect(rules.getByText('active')).toBeVisible();

  await page.goto('/payroll/setup?tab=settings');
  await page.getByRole('checkbox', { name: /Absent days are loss of pay/ }).click();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeDisabled();

  await page.goto('/people/employees');
  await page.getByRole('button', { name: /Add employee/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^First name/).fill('Meera');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Pay Co (PAY)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Meera/ })).toBeVisible();

  await page.goto('/payroll/employees');
  await page.getByLabel('Employee', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: /Set salary/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Salary structure/).selectOption({ label: 'Standard' });
  await dialog.getByLabel(/^Annual CTC/).fill('600000');
  await dialog.getByLabel(/^Effective from/).fill('2025-01-06');
  await dialog.getByLabel(/^Reason/).selectOption('JOINING');
  await dialog.getByRole('button', { name: 'Save salary' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('table', { name: 'Breakdown from 2025-01-06' }).getByText('₹20,000.00').first(),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Provident fund applies' }).click();
  await page.getByRole('checkbox', { name: 'Deduct income tax (TDS)' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Payroll profile saved.')).toBeVisible();

  await page.goto('/payroll/runs');
  await page.getByRole('button', { name: /New run/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Pay Co (PAY)' });
  await dialog.getByLabel(/^Month/).selectOption('4');
  await dialog.getByLabel(/^Year/).fill('2026');
  await dialog.getByRole('button', { name: 'Create run' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('link', { name: 'April 2026' }).click();
  await page.getByRole('button', { name: 'Calculate' }).click();
  const totals = page.getByLabel('Run totals');
  // 50000 gross − 2000 PF (10 % of the 20000 ceiling) = 48000.
  await expect(totals.getByText('₹48,000.00')).toBeVisible({ timeout: 20_000 });
  const runUrl = page.url();

  const finance = await invitedPage(page, browser, /Finance/, 'Farah Finance');
  await finance.page.goto(runUrl);
  await finance.page.getByRole('button', { name: 'Approve' }).click();
  await expect(finance.page.getByText('approved', { exact: true })).toBeVisible();
  await finance.context.close();

  await page.goto(runUrl);
  await page.getByRole('button', { name: 'Finalize' }).click();
  await expect(page.getByText('finalized', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Bank file/ })).toBeVisible();
});

test('claim an expense, have finance verify and pay it, and receive an asset', async ({
  page,
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(150_000);
  await registerViaUi(page);

  await page.goto('/organization/structure?tab=companies');
  await page.getByRole('button', { name: /New company/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('SPD');
  await dialog.getByLabel(/^Name/).fill('Spend Co');
  await dialog.getByRole('button', { name: 'Create company' }).click();
  await expect(dialog).toBeHidden();

  // The owner becomes an employee linked to their own login (no reporting manager).
  await page.goto('/people/employees');
  await page.getByRole('button', { name: /Add employee/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^First name/).fill('Esha');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Spend Co (SPD)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Esha/ })).toBeVisible();
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Link login account' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Member').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/expenses/setup');
  await page.getByRole('button', { name: /New category/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('TAXI');
  await dialog.getByLabel(/^Name/).fill('Local travel');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const today = new Date().toISOString().slice(0, 10);
  await page.goto('/expenses/claims/new');
  await page.getByLabel(/^Title/).fill('Client meeting');
  const item = page.getByRole('group', { name: 'Item 1' });
  await item.getByLabel(/^Category/).selectOption({ label: 'Local travel' });
  await item.getByLabel(/^Date/).fill(today);
  await item.getByLabel(/^Amount/).fill('450');
  await item.getByLabel(/^Description/).fill('Taxi to client office');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: 'Client meeting' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  // No reporting manager: straight to finance.
  await expect(page.getByText('With finance', { exact: true }).first()).toBeVisible();
  const claimUrl = page.url();

  const finance = await invitedPage(page, browser, /Finance/, 'Farah Finance');
  await finance.page.goto(claimUrl);
  await finance.page.getByLabel('Pay').selectOption('EXTERNAL');
  await finance.page.getByRole('button', { name: 'Approve' }).click();
  await expect(finance.page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await finance.page.getByRole('button', { name: 'Mark paid' }).click();
  dialog = finance.page.getByRole('dialog');
  await dialog.getByLabel(/^Payment reference/).fill('NEFT-123');
  await dialog.getByRole('button', { name: 'Mark paid' }).click();
  await expect(finance.page.getByText('Reimbursed', { exact: true }).first()).toBeVisible();
  await finance.context.close();

  await page.goto('/me/expenses');
  await expect(
    page.getByRole('table', { name: 'My expense claims' }).getByText('Reimbursed'),
  ).toBeVisible();

  // Assets: register, allocate to the owner, who confirms receipt.
  await page.goto('/assets');
  await page.getByRole('button', { name: /Category/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('LAPTOP');
  await dialog.getByLabel(/^Name/).fill('Laptops');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /Register asset/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Asset tag/).fill('LAP-001');
  await dialog.getByLabel(/^Name/).fill('Laptop 14 inch');
  await dialog.getByLabel(/^Category/).selectOption({ label: 'Laptops (LAPTOP)' });
  await dialog.getByRole('button', { name: 'Register' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('table', { name: 'Assets' }).getByRole('link', { name: 'LAP-001' }).click();
  await page.getByRole('button', { name: 'Allocate' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Employee/).selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Allocate' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Now with Esha')).toBeVisible();

  await page.goto('/me/assets');
  const equipment = page.getByRole('list', { name: 'My equipment' });
  await equipment.getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(equipment.getByText('received')).toBeVisible();
});

test('track a KPI goal and answer an anonymous pulse survey', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(120_000);
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
  await dialog.getByLabel(/^First name/).fill('Esha');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Esha/ })).toBeVisible();
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Link login account' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Member').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // A measured goal: progress follows the current value between start and target.
  await page.goto('/me/goals');
  await page.getByRole('button', { name: /New goal/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Title/).fill('Close support tickets');
  await dialog.getByLabel(/^Type/).selectOption('KPI');
  await expect(dialog.getByRole('option', { name: /^Esha/ })).toBeAttached();
  await dialog.getByLabel(/^Employee/).selectOption({ index: 1 });
  await dialog.getByLabel(/^Start value/).fill('0');
  await dialog.getByLabel(/^Target value/).fill('200');
  await dialog.getByLabel(/^Unit/).fill('tickets');
  await dialog.getByRole('button', { name: 'Create goal' }).click();
  await expect(dialog).toBeHidden();
  const goals = page.getByRole('list', { name: 'Goals' });
  await goals.getByRole('button', { name: 'Check in' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Current value/).fill('50');
  await dialog.getByLabel(/^What changed/).fill('Cleared the backlog');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(goals).toContainText('50 of 200 tickets');
  await expect(goals).toContainText('25%');

  // An anonymous pulse: the respondent is told, and results appear at the group minimum.
  await page.goto('/engagement/surveys');
  await page.getByRole('button', { name: /New survey/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Title/).fill('Quarterly pulse');
  await dialog.getByLabel(/^Type/).selectOption('PULSE');
  await dialog.getByLabel(/^Minimum group size/).fill('1');
  await dialog.getByLabel(/^Opens/).fill('2026-01-01T09:00');
  await dialog.getByLabel(/^Closes/).fill('2030-01-01T09:00');
  await dialog.getByLabel('Question 1', { exact: true }).fill('Would you recommend us?');
  await dialog.getByLabel('Question 1 type').selectOption('ENPS');
  await dialog.getByRole('button', { name: 'Save draft' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('button', { name: 'Respond' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/stored without your name/)).toBeVisible();
  await dialog
    .getByRole('group', { name: 'Would you recommend us?' })
    .getByRole('button', { name: '9' })
    .click();
  await dialog.getByRole('button', { name: 'Submit' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('responded', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Results' }).click();
  await expect(page.getByLabel('Survey results')).toContainText('eNPS 100');
});

test('run a client project on a board and bill a milestone to paid', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(120_000);
  await registerViaUi(page);

  await page.goto('/clients');
  await page.getByRole('button', { name: /New client/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('ACME');
  await dialog.getByLabel(/^Name/).fill('Acme Ltd');
  await dialog.getByLabel(/^Billing currency/).fill('INR');
  await dialog.getByLabel(/^Payment terms/).fill('30');
  await dialog.getByRole('button', { name: 'Create client' }).click();
  await expect(dialog).toBeHidden();

  await page.goto('/projects');
  await page.getByRole('button', { name: /New project/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Key/).fill('WEB');
  await dialog.getByLabel(/^Name/).fill('Website');
  await dialog.getByLabel(/^Client/).selectOption({ label: 'Acme Ltd (ACME)' });
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('list', { name: 'Projects' }).getByRole('link', { name: 'Website' }).click();

  // A story on the board moves between the project's columns.
  await page
    .getByRole('button', { name: /New item/ })
    .first()
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Title/).fill('Pay by card');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  const todo = page.getByRole('region', { name: 'Column To do' });
  await expect(todo.getByText('Pay by card')).toBeVisible();
  await todo.getByLabel('Move WEB-1').selectOption({ label: 'In progress' });
  await expect(
    page.getByRole('region', { name: 'Column In progress' }).getByText('Pay by card'),
  ).toBeVisible();

  // A fixed-fee milestone: draft → issued (numbered) → paid.
  await page.goto('/billing');
  await page.getByRole('button', { name: /New invoice/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Client/).selectOption({ label: 'Acme Ltd (INR)' });
  await dialog.getByRole('button', { name: /Manual line/ }).click();
  const line = dialog.getByRole('group', { name: 'Line 1' });
  await line.getByLabel('Description').fill('Milestone 1');
  await line.getByLabel('Unit price').fill('50000');
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
  await expect(page.getByLabel('Invoice total')).toHaveText('50000.00');
  await page.getByRole('button', { name: 'Issue' }).click();
  await expect(page.getByRole('heading', { name: /^INV-\d{4}-0001$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Record' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('paid', { exact: true })).toBeVisible();
});

test('design an approval workflow, generate a letter and accept it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(120_000);
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
  await dialog.getByLabel(/^First name/).fill('Esha');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Esha/ })).toBeVisible();
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Link login account' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Member').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // A two-step leave workflow: manager, then a skip-level manager from 3 days.
  await page.goto('/admin/workflows');
  await page.getByRole('button', { name: /New workflow/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name/).fill('Leave approval');
  await dialog.getByRole('button', { name: /Add step/ }).click();
  const step2 = dialog.getByRole('group', { name: 'Step 2' });
  await step2.getByLabel(/^Step name/).fill('Skip level');
  await step2.getByLabel(/^Approver/).selectOption('MANAGER_LEVEL');
  await step2.getByLabel(/^Only from/).fill('3');
  await dialog.getByRole('button', { name: 'Save (inactive)' }).click();
  await expect(dialog).toBeHidden();
  const workflows = page.getByLabel('Workflows');
  await expect(workflows).toContainText('Skip level: manager level 2 · from 3 days');
  await workflows.getByRole('button', { name: 'Activate' }).click();
  await expect(workflows.getByText('active', { exact: true })).toBeVisible();

  // A letter in the organization's own words, accepted by the employee it is for.
  await page.goto('/documents/templates');
  await page.getByRole('button', { name: /New template/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Name/).fill('Appointment');
  await dialog.getByLabel(/^Title/).fill('Appointment letter');
  await dialog.getByLabel(/^Text/).fill('Welcome to {{organization.name}}, ');
  await dialog.getByRole('button', { name: '{{employee.firstName}}' }).click();
  await dialog.getByRole('button', { name: 'Create template' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/documents');
  await page.getByRole('button', { name: /Generate/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Template/).selectOption({ label: 'Appointment (Appointment letter)' });
  await expect(dialog.getByRole('option', { name: /^Esha/ }).first()).toBeAttached();
  await dialog.getByLabel(/^Employee/).selectOption({ index: 1 });
  await dialog.getByLabel('Add signer').selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Generate PDF' }).click();
  await expect(dialog).toBeHidden();
  const docs = page.getByRole('list', { name: 'Documents' });
  await expect(docs.getByText('awaiting acceptance')).toBeVisible();
  await docs.getByRole('button', { name: 'Accept' }).click();
  await expect(docs.getByText('accepted', { exact: true })).toBeVisible();
  await expect(docs.getByRole('button', { name: /With certificate/ })).toBeVisible();
});

test('run a helpdesk ticket to closure and roll a compliance task forward', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Covered on desktop');
  test.setTimeout(120_000);
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
  await dialog.getByLabel(/^First name/).fill('Esha');
  await dialog.getByLabel(/^Date of joining/).fill('2025-01-06');
  await dialog.getByLabel(/^Company/).selectOption({ label: 'Acme India (ACME)' });
  await dialog.getByLabel(/^Employment type/).selectOption('FULL_TIME');
  await dialog.getByRole('button', { name: 'Add employee' }).click();
  await expect(page.getByRole('heading', { name: /Esha/ })).toBeVisible();
  await page.getByRole('button', { name: /Actions/ }).click();
  await page.getByRole('menuitem', { name: 'Link login account' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Member').selectOption({ index: 2 });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // An IT category worked by the owner, with an urgent-ticket SLA.
  await page.goto('/helpdesk/setup');
  await page.getByRole('button', { name: /New category/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Code/).fill('IT');
  await dialog.getByLabel(/^Name/).fill('IT support');
  await expect(dialog.getByRole('option', { name: /^Esha/ }).first()).toBeAttached();
  await dialog.getByLabel(/^Agents/).selectOption({ index: 1 });
  await dialog.getByLabel('URGENT resolution hours').fill('8');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Categories')).toContainText('urgent 8 h resolution');

  await page.goto('/helpdesk');
  await page.getByRole('button', { name: /New ticket/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Category/).selectOption({ label: 'IT support' });
  await dialog.getByLabel(/^Priority/).selectOption('URGENT');
  await dialog.getByLabel(/^Subject/).fill('Laptop will not boot');
  await dialog.getByLabel(/^Description/).fill('Black screen after update');
  await dialog.getByRole('button', { name: 'Raise ticket' }).click();
  await expect(
    page.getByRole('heading', { name: /^HD-\d{4}-0001 Laptop will not boot$/ }),
  ).toBeVisible();
  await page.getByLabel('Reply').fill('Hold the power button for 30 seconds');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('list', { name: 'Conversation' })).toContainText(
    'Hold the power button',
  );
  await page.getByLabel('Resolution').fill('Reset the BIOS');
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Resolution: Reset the BIOS')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('closed', { exact: true })).toBeVisible();

  // A monthly obligation: completing it schedules the next month.
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Obligations' }).click();
  await page.getByRole('button', { name: /New obligation/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Title/).fill('Monthly contribution filing');
  await expect(dialog.getByRole('option', { name: /^Esha/ }).first()).toBeAttached();
  await dialog.getByLabel(/^Owner/).selectOption({ index: 1 });
  await dialog.getByLabel(/^First due on/).fill('2026-01-15');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('tab', { name: 'My tasks' }).click();
  const tasks = page.getByRole('table', { name: 'My compliance tasks' });
  await expect(tasks.getByText('2026-01-15')).toBeVisible();
  await tasks.getByRole('button', { name: 'Complete' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^What was done/).fill('Filed on time');
  await dialog.getByRole('button', { name: 'Complete' }).click();
  await expect(dialog).toBeHidden();
  await expect(tasks.getByText('2026-02-15')).toBeVisible();
  await expect(tasks.getByText('done', { exact: true })).toBeVisible();
});
