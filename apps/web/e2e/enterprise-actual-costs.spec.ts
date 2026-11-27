import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

type Preference = { category: string; channel: string; enabled: boolean };
type Connection = { id: string; partnerOrgId: string; status: string; scopes: string[] };
type Member = { id: string; email: string; role: string; revision: number };

test('posts an approved bill once from the project screen and keeps actuals when it is paid', async ({
  browser,
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1',
    'Requires the two seeded Development companies.',
  );
  test.setTimeout(125_000);
  page.setDefaultTimeout(15_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const headers = { origin };
  const vendorContext = await browser.newContext({ baseURL });
  const vendor = await vendorContext.newPage();

  async function signIn(target: Page, identity: string) {
    await target.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
    await chooseDevIdentity(target, identity);
    await target.waitForURL('**/enterprise');
    const me = await api<{ activeOrgId: string; user: { email: string } }>(
      target,
      'GET',
      '/me',
      200,
    );
    expect(me.user.email).toBe(identity + '@example.test');
    return me.activeOrgId;
  }

  async function api<T>(
    target: Page,
    method: string,
    path: string,
    status: number,
    data?: object,
    revision?: number,
  ): Promise<T> {
    const response = await target.request.fetch('/v1' + path, {
      method,
      data,
      headers: revision === undefined ? headers : { ...headers, 'if-match': String(revision) },
    });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }

  async function preferInbox(target: Page) {
    const previous = await api<{ preferences: Preference[] }>(
      target,
      'GET',
      '/notifications/preferences',
      200,
    );
    const categories = ['system', 'invoice_received', 'invoice_approved', 'invoice_paid'];
    const restore = previous.preferences.filter(
      (item) => item.channel === 'email' && categories.includes(item.category),
    );
    await api(target, 'PUT', '/notifications/preferences', 200, {
      preferences: categories.map((category) => ({ category, channel: 'email', enabled: false })),
    });
    return async () => {
      await api(target, 'PUT', '/notifications/preferences', 200, { preferences: restore });
    };
  }

  const restores: (() => Promise<void>)[] = [];
  const failures: unknown[] = [];

  async function limitFixtureRecipients(target: Page) {
    const team = await api<{ items: Member[] }>(
      target,
      'GET',
      '/team/members?status=active&limit=100',
      200,
    );
    for (const member of team.items.filter(({ role }) => ['admin', 'finance'].includes(role))) {
      // Every additional synthetic accounting member defaults to email notifications.
      // Limit the participating fixture accounts for this in-app-only test.
      expect(member.email).toMatch(/^demo-.*@example\.test$/);
      const path = '/team/members/' + member.id;
      await api<Member>(target, 'PATCH', path, 200, { role: 'read_only' }, member.revision);
      restores.push(async () => {
        const current = await api<Member>(target, 'GET', path, 200);
        await api(target, 'PATCH', path, 200, { role: member.role }, current.revision);
      });
    }
  }

  try {
    const buyerId = await signIn(page, 'demo-roof-owner');
    const vendorId = await signIn(vendor, 'demo-curb-owner');
    restores.push(await preferInbox(page));
    restores.push(await preferInbox(vendor));
    await limitFixtureRecipients(page);
    await limitFixtureRecipients(vendor);
    const enterprise = await api<{ enabled: boolean }>(page, 'GET', '/enterprise/status', 200);
    if (!enterprise.enabled) {
      await api(page, 'PUT', '/enterprise/status', 200, { enabled: true });
      restores.push(async () => {
        await api(page, 'PUT', '/enterprise/status', 200, { enabled: false });
      });
    }
    const network = await api<{ items: Connection[] }>(vendor, 'GET', '/network/connections', 200);
    const established = network.items.find((connection) => connection.partnerOrgId === buyerId);
    if (!established || established.status !== 'active') {
      if (established?.status !== 'pending') {
        const directory = await api<{ items: { orgId: string }[] }>(
          vendor,
          'GET',
          '/network/directory?q=Summit%20Ridge%20Roofing',
          200,
        );
        if (!directory.items.some((item) => item.orgId === buyerId)) {
          await api(page, 'PATCH', '/network/listing', 200, { directoryOptIn: true });
          restores.push(async () => {
            await api(page, 'PATCH', '/network/listing', 200, { directoryOptIn: false });
          });
        }
        await api(vendor, 'POST', '/network/connections', 201, {
          partnerOrgId: buyerId,
          scopes: ['invoices'],
        });
      }
      const incoming = await api<{ items: Connection[] }>(page, 'GET', '/network/connections', 200);
      const pending = incoming.items.find((item) => item.partnerOrgId === vendorId);
      if (!pending) throw new Error('The synthetic connection is missing.');
      await api(page, 'POST', '/network/connections/' + pending.id + '/accept', 200, {});
    } else {
      expect(established.scopes).toContain('invoices');
    }
    const name = 'Bill costs browser ' + randomUUID();
    const project = await api<{ id: string }>(page, 'POST', '/enterprise/projects', 201, {
      name,
      originalContractMinor: 2_000_000,
    });
    const projectPath = '/enterprise/projects/' + project.id;
    for (const [code, label] of [
      ['03-30', 'Concrete'],
      ['06-10', 'Framing'],
    ]) {
      await api(page, 'POST', projectPath + '/purchase-cost-codes', 201, { code, label });
    }
    const invoice = await api<{ id: string; number: string }>(vendor, 'POST', '/invoices', 201, {
      recipientOrgId: buyerId,
      dueOn: '2099-09-01',
      lines: [
        {
          description: 'Vendor materials and labor',
          quantity: '1',
          unit: 'each',
          unitPriceMinor: 500_002,
        },
      ],
    });
    await api(vendor, 'POST', '/invoices/' + invoice.id + '/send', 200, {});
    const payable = await api<{ items: { id: string; invoiceId: string }[] }>(
      page,
      'GET',
      '/bills?limit=100',
      200,
    );
    const bill = payable.items.find((item) => item.invoiceId === invoice.id);
    if (!bill) throw new Error('The delivered fixture bill is missing.');
    await api(page, 'POST', '/bills/' + bill.id + '/approve', 200, { comment: 'Checked invoice.' });

    let month = '';
    for (let index = 0; index < 36 && !month; index++) {
      const candidate = new Date(Date.UTC(2020, index, 1)).toISOString().slice(0, 10);
      const result = await api<{ period: unknown }>(
        page,
        'GET',
        projectPath + '/actual-costs/periods/' + candidate,
        200,
      );
      if (!result.period) month = candidate;
    }
    if (!month) throw new Error('No unused synthetic accounting month is available.');

    await page.goto(projectPath + '/budget');
    const actuals = page.getByRole('region', { name: 'Actual bill costs' });
    await expect(
      actuals.getByText('No bill costs have been posted through this date.'),
    ).toBeVisible({ timeout: 15_000 });
    await actuals.getByRole('button', { name: 'Manage bill postings' }).click();
    const postingDate = actuals.getByLabel('Posting date');
    await postingDate.fill(month.slice(0, -2) + '15');
    await actuals.getByRole('button', { name: 'Open accounting period', exact: true }).click();
    const open = actuals.getByRole('form', { name: 'Open accounting period' });
    await open.getByLabel('Period reason').fill('Open the synthetic accounting window.');
    await open.getByRole('button', { name: 'Open accounting period' }).click();
    await actuals.getByRole('button', { name: 'Post approved bill cost' }).click();
    const posting = actuals.getByRole('form', { name: 'Post approved bill cost' });
    await posting
      .getByRole('combobox', { name: 'Approved bill', exact: true })
      .selectOption(bill.id);
    const first = posting.getByRole('group', { name: 'Allocation 1' });
    await first.getByLabel('Cost code').selectOption({ label: '03-30 · Concrete' });
    await first.getByLabel('Bill amount (USD)').fill('3000');
    await posting.getByRole('button', { name: 'Add bill allocation' }).click();
    const second = posting.getByRole('group', { name: 'Allocation 2' });
    await second.getByLabel('Cost code').selectOption({ label: '06-10 · Framing' });
    await second.getByLabel('Bill amount (USD)').fill('2000');
    await posting.getByRole('button', { name: 'Post to job-cost ledger' }).click();
    await expect(posting.getByRole('alert')).toHaveText(
      'The cost-code allocations must equal the approved bill amount.',
    );
    await second.getByLabel('Bill amount (USD)').fill('2000.02');
    await posting.getByRole('button', { name: 'Post to job-cost ledger' }).click();
    await expect(actuals.getByText('Approved bill posted to the job-cost ledger.')).toBeVisible();
    const ledger = actuals.getByRole('list', { name: 'Job-cost ledger entries' });
    await expect(ledger.getByRole('listitem')).toHaveCount(1);
    await ledger.getByText('Source and ledger details', { exact: true }).click();
    await expect(ledger.getByText(bill.id, { exact: true })).toBeVisible();
    await expect(ledger.getByText('$2,000.02', { exact: true })).toBeVisible();

    const settled = await api<{ status: string }>(
      page,
      'POST',
      '/bills/' + bill.id + '/settle',
      200,
      {
        method: 'check',
        reference: 'BROWSER-SYNTHETIC-CHECK',
      },
    );
    expect(settled.status).toBe('paid');
    await page.reload();
    await expect(actuals.getByText('$5,000.02', { exact: true })).toBeVisible();
    await actuals.getByRole('button', { name: 'Manage bill postings' }).click();
    await expect(ledger.getByRole('listitem')).toHaveCount(1);
    await postingDate.fill(month.slice(0, -2) + '15');
    await actuals.getByRole('button', { name: 'Close accounting period' }).click();
    const close = actuals.getByRole('form', { name: 'Close accounting period' });
    await close.getByLabel('Period reason').fill('Close the reconciled synthetic period.');
    await close.getByRole('button', { name: 'Close accounting period' }).click();
    await expect(actuals.getByText('Accounting period closed', { exact: true })).toBeVisible();
    await expect(actuals.getByRole('button', { name: 'Post approved bill cost' })).toHaveCount(0);

    await test.step('saves incomplete and complete forecasts using both remaining-cost methods', async () => {
      const baseline = page.getByRole('region', { name: 'Budget baseline' });
      const forecasts = page.getByRole('region', { name: 'Cost forecasts' });
      await expect(
        forecasts.getByText('Approve a budget baseline to create a forecast.'),
      ).toBeVisible();
      await baseline.getByRole('button', { name: 'Create baseline' }).click();
      const create = baseline.getByRole('form', { name: 'Create draft baseline' });
      await create.getByLabel('Currency').fill('USD');
      await create.getByRole('button', { name: 'Create draft baseline' }).click();
      await expect(baseline.getByText('Draft · Revision 1')).toBeVisible();

      const budgetLines = [
        ['03-30 · Concrete', '6000'],
        ['06-10 · Framing', '2000'],
      ] as const;
      for (const [index, [code, amount]] of budgetLines.entries()) {
        await baseline.getByRole('button', { name: 'Add budget line' }).click();
        const line = baseline.getByRole('form', { name: 'Save budget line' });
        await line.getByLabel('Cost code').selectOption({ label: code });
        await line.getByLabel('Description').fill('Approved forecast allowance');
        await line.getByLabel('Amount (USD)').fill(amount);
        await line.getByLabel('Project phase').fill('Structure');
        await line.getByLabel('Funding source').fill('Original contract');
        await line.getByRole('button', { name: 'Save budget line' }).click();
        await expect(line).toHaveCount(0);
        await expect(baseline.getByText('Draft · Revision ' + (index + 2))).toBeVisible({
          timeout: 15_000,
        });
      }

      await baseline.getByRole('button', { name: 'Review baseline approval' }).click();
      const approve = baseline.getByRole('form', { name: 'Approve baseline' });
      await approve.getByLabel('Approval reason').fill('Verified scope and cost codes.');
      await approve.getByRole('button', { name: 'Approve baseline' }).click();
      await expect(baseline.getByText('Approved · Revision 4')).toBeVisible();

      async function forecast(includeFraming: boolean, assumption: string) {
        await forecasts.getByRole('button', { name: 'Create cost forecast' }).click();
        const form = forecasts.getByRole('form', { name: 'Create cost forecast' });
        const concrete = form.getByRole('group', { name: '03-30 · Concrete' });
        await concrete.getByLabel('Estimate method').selectOption('remaining_cost');
        await concrete.getByLabel('Remaining cost (USD)').fill('4500');
        if (includeFraming) {
          const framing = form.getByRole('group', { name: '06-10 · Framing' });
          await framing.getByLabel('Estimate method').selectOption('percent_complete');
          await framing.getByRole('spinbutton', { name: 'Percent complete' }).fill('25');
        }
        await form.getByLabel('Forecast assumptions').fill(assumption);
        await form
          .getByRole('checkbox', { name: 'I approve these assumptions for this forecast.' })
          .check();
        await form.getByRole('button', { name: 'Save cost forecast' }).click();
        await expect(form).toHaveCount(0);
      }

      await forecast(false, 'Waiting for the framing estimate.');
      const incomplete = forecasts
        .getByRole('listitem')
        .filter({ hasText: /^Incomplete forecast/ });
      await expect(incomplete.getByText('Awaiting required inputs')).toBeVisible();
      await incomplete.getByText('Forecast assumptions and cost codes').click();
      await expect(incomplete.getByText('Remaining estimate missing')).toBeVisible();

      await forecast(true, 'Verified supplier prices and framing progress.');
      const complete = forecasts.getByRole('listitem').filter({ hasText: /^Complete forecast/ });
      await expect(complete.getByText('$5,000.02', { exact: true })).toBeVisible();
      await expect(complete.getByText('$6,000.00', { exact: true })).toBeVisible();
      await expect(complete.getByText('$11,000.02', { exact: true })).toBeVisible();
      await expect(complete.getByText('$8,999.98', { exact: true })).toBeVisible();
      await complete.getByText('Forecast assumptions and cost codes').click();
      await expect(complete.getByText('25% complete', { exact: true })).toBeVisible();
      await expect(
        complete.getByText('Verified supplier prices and framing progress.'),
      ).toBeVisible();
      await expect(incomplete.getByText('Awaiting required inputs')).toBeVisible();
    });

    await test.step('runs a scenario in its workspace while leaving the saved forecast and ledger unchanged', async () => {
      const postedBefore = await api(page, 'GET', projectPath + '/actual-costs', 200);
      const accountsBefore = await api(vendor, 'GET', '/ledger', 200);
      await page.getByRole('link', { name: 'Open Scenarios workspace' }).click();
      await expect(page).toHaveURL(/\/enterprise\/finance\/scenarios\?projectId=/);
      await expect(
        page.getByRole('heading', { name: 'Cost scenarios', exact: true }),
      ).toBeVisible();
      const forecasts = page.getByRole('region', { name: 'Cost forecasts' });
      const complete = forecasts.getByRole('listitem').filter({ hasText: /^Complete forecast/ });
      await complete.getByText('Forecast assumptions and cost codes').click();
      const scenarios = complete.getByRole('region', { name: 'Cost scenarios' });
      await scenarios.getByRole('button', { name: 'View scenarios' }).click();
      await scenarios.getByRole('button', { name: 'Run cost scenario' }).click();
      const form = scenarios.getByRole('form', { name: 'Run cost scenario' });
      await form.getByLabel('Scenario name').fill('Higher concrete allowance');
      await form.getByRole('button', { name: 'Add override' }).click();
      const override = form.getByRole('group', { name: 'Override 1' });
      await override.getByLabel('Cost code').selectOption({ label: '03-30 · Concrete' });
      await override.getByLabel('Scenario remaining cost (USD)').fill('5250.00');
      await form.getByRole('button', { name: 'Save cost scenario' }).click();
      await expect(scenarios.getByText('Higher concrete allowance', { exact: true })).toBeVisible();
      await expect(scenarios.getByText('$11,000.02', { exact: true })).toBeVisible();
      await expect(scenarios.getByText('$11,750.02', { exact: true })).toBeVisible();
      await expect(scenarios.getByText('$750.00', { exact: true })).toBeVisible();
      await expect(scenarios.getByText('$8,249.98', { exact: true })).toBeVisible();
      expect(await api(page, 'GET', projectPath + '/actual-costs', 200)).toEqual(postedBefore);
      expect(await api(vendor, 'GET', '/ledger', 200)).toEqual(accountsBefore);

      await page.getByRole('link', { name: 'Project budget', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(projectPath + '/budget$'));
      await expect(actuals.getByText('$5,000.02', { exact: true })).toBeVisible();
      await expect(
        page
          .getByRole('region', { name: 'Cost forecasts' })
          .getByText('$11,000.02', { exact: true }),
      ).toBeVisible();
    });

    if (process.env.FIELDPRO_E2E_WIP_WORKER === '1') {
      await test.step('queues and downloads a period WIP export with a flagged project and its source bill', async () => {
        const period = await api<{ period: { id: string; revision: number } }>(
          page,
          'GET',
          projectPath + '/actual-costs/periods/' + month,
          200,
        );
        expect(period.period.revision).toBe(2);
        await page.getByRole('link', { name: 'Open WIP reports' }).click();
        await expect(page).toHaveURL(/\/enterprise\/finance\/wip\?projectId=/);
        await expect(
          page.getByRole('heading', { name: 'Work in progress', exact: true }),
        ).toBeVisible();
        const form = page.getByRole('form', { name: 'Queue WIP export' });
        await expect(form.getByRole('checkbox', { name, exact: true })).toBeChecked();
        await form.getByLabel('Accounting period').selectOption(period.period.id);
        await form.getByLabel('Reporting methodology').selectOption('bill-cost-to-cost-v1');
        await form.getByRole('button', { name: 'Queue WIP export' }).click();
        const reports = page.getByRole('region', { name: 'Saved WIP reports' });
        const selected = reports.getByRole('listitem').filter({ hasText: month + ' through' });
        const csv = selected.getByRole('link', { name: 'Download WIP CSV' });
        await expect(csv).toBeVisible({ timeout: 30_000 });
        await expect(selected.getByText('Ready to download', { exact: true })).toBeVisible();
        await selected.getByText('Period results and source bills', { exact: true }).click();
        await expect(selected.getByText('$5,000.02', { exact: true }).first()).toBeVisible();
        await expect(selected.getByText('A saved forecast is missing.')).toBeVisible();
        await selected.getByText('Source bill references', { exact: true }).click();
        await expect(selected.getByText('Bill ' + bill.id, { exact: true })).toBeVisible();
        const [file] = await Promise.all([page.waitForEvent('download'), csv.click()]);
        expect(file.suggestedFilename()).toBe('wip-' + month + '.csv');
        const savedPath = await file.path();
        if (!savedPath) throw new Error('The WIP CSV did not download.');
        const contents = await readFile(savedPath, 'utf8');
        expect(contents).toContain('report_currency_total');
        expect(contents).toContain('500002');
        expect(contents).toContain('missing_forecast');
        expect(contents).toContain(bill.id);
        expect(contents).toContain('bill-cost-to-cost-v1');
      });
    }
    await test.step('opens Finance Projects and Financials with the real posted bill in the activity panel', async () => {
      await page.goto('/enterprise/costing');
      await page.getByRole('link', { name: 'Open Finance Projects' }).click();
      await expect(
        page.getByRole('heading', { name: 'Finance projects', exact: true }),
      ).toBeVisible();
      const projectList = page.getByRole('region', { name: 'Finance project list' });
      const item = projectList.getByRole('link', { name, exact: true });
      await item.click();
      const selected = page.getByRole('region', { name: 'Selected finance project' });
      await expect(selected.getByRole('heading', { name })).toBeVisible();
      await expect(selected.getByText('Approved budget · Version 4')).toBeVisible();
      await expect(selected.getByText('Forecast at completion $11,000.02')).toBeVisible();
      await page.getByRole('link', { name: 'Open budget', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(projectPath + '/financials$'));
      await expect(page.getByRole('heading', { name: 'Project financials' })).toBeVisible();
      await expect(
        page.getByRole('region', { name: 'Budget baseline', exact: true }),
      ).toBeVisible();
      const trigger = page.getByRole('button', { name: 'Activity and exceptions' });
      let activity = page.getByRole('complementary', { name: 'Activity and exceptions' });
      if (await trigger.isVisible()) {
        await trigger.click();
        activity = page.getByRole('dialog', { name: 'Activity and exceptions' });
      }
      await expect(activity.getByRole('link', { name: 'Budget baseline approved' })).toBeVisible();
      await expect(activity.getByRole('link', { name: 'Approved bill posted' })).toHaveAttribute(
        'href',
        projectPath + '/financials#actual-costs',
      );
      await expect(activity.getByRole('link', { name: 'Cost scenario saved' })).toBeVisible();
      if (!(await trigger.isVisible())) {
        await page.setViewportSize({ width: 900, height: 850 });
        await trigger.click();
        await expect(page.getByRole('dialog', { name: 'Activity and exceptions' })).toBeVisible();
        await expect(
          page.getByRole('dialog', { name: 'Activity and exceptions' }).getByRole('link', {
            name: 'Approved bill posted',
          }),
        ).toBeVisible();
      }
    });
    await test.step('posts a separately approved bill adjustment and keeps the month closed', async () => {
      const late = await api<{ id: string; number: string }>(vendor, 'POST', '/invoices', 201, {
        recipientOrgId: buyerId,
        dueOn: '2099-09-01',
        lines: [
          {
            description: 'Late verified job expense',
            quantity: '1',
            unit: 'each',
            unitPriceMinor: 125_000,
          },
        ],
      });
      await api(vendor, 'POST', '/invoices/' + late.id + '/send', 200, {});
      const payable = await api<{ items: { id: string; invoiceId: string }[] }>(
        page,
        'GET',
        '/bills?limit=100',
        200,
      );
      const lateBill = payable.items.find((item) => item.invoiceId === late.id);
      if (!lateBill) throw new Error('The adjustment fixture bill is missing.');
      await api(page, 'POST', '/bills/' + lateBill.id + '/approve', 200, {
        comment: 'Approved late bill.',
      });

      const roster = await api<{ items: Member[] }>(
        page,
        'GET',
        '/team/members?limit=100&status=active',
        200,
      );
      const finance = roster.items.find(
        ({ email }) => email === 'demo-roof-estimator@example.test',
      );
      if (!finance) throw new Error('The synthetic finance reviewer is missing.');
      const memberPath = '/team/members/' + finance.id;
      const promoted = await api<Member>(
        page,
        'PATCH',
        memberPath,
        200,
        { role: 'finance' },
        finance.revision,
      );
      restores.push(async () => {
        await api(page, 'PATCH', memberPath, 200, { role: finance.role }, promoted.revision);
      });
      const grantPath = projectPath + '/budget/grants/' + finance.id;
      const grant = await api<{ revision: number }>(
        page,
        'PUT',
        grantPath,
        200,
        {
          active: true,
          reason: 'Review the synthetic closed-month adjustment.',
          clientRequestId: randomUUID(),
        },
        0,
      );
      restores.push(async () => {
        await api(
          page,
          'PUT',
          grantPath,
          200,
          {
            active: false,
            reason: 'Finished the synthetic adjustment check.',
            clientRequestId: randomUUID(),
          },
          grant.revision,
        );
      });
      await page.goto(projectPath + '/financials');
      await actuals.getByRole('button', { name: 'Manage bill postings' }).click();
      await actuals.getByLabel('Posting date').fill(month.slice(0, -2) + '15');
      await expect(actuals.getByText('Accounting period closed', { exact: true })).toBeVisible();
      await expect(actuals.getByRole('button', { name: 'Post approved bill cost' })).toHaveCount(0);
      await actuals.getByRole('button', { name: 'Request closed-period adjustment' }).click();
      const proposal = actuals.getByRole('form', { name: 'Request closed-period adjustment' });
      await proposal
        .getByRole('combobox', { name: 'Approved bill', exact: true })
        .selectOption(lateBill.id);
      await proposal.getByLabel('Cost code').selectOption({ label: '03-30 · Concrete' });
      await proposal
        .getByLabel('Adjustment reason')
        .fill('Apply the late bill to the month when the work occurred.');
      await proposal.getByRole('button', { name: 'Submit adjustment request' }).click();
      const myRequests = actuals.getByRole('region', { name: 'Closed-period bill adjustments' });
      await expect(myRequests.getByText('Awaiting a separate controller')).toBeVisible();
      await expect(myRequests.getByRole('button', { name: 'Review adjustment' })).toHaveCount(0);

      const reviewContext = await browser.newContext({
        baseURL,
        viewport: page.viewportSize() ?? undefined,
      });
      restores.push(async () => {
        await reviewContext.close();
      });
      const reviewer = await reviewContext.newPage();
      await signIn(reviewer, 'demo-roof-estimator');
      await expect(
        reviewer.getByRole('heading', { name: 'Commercial Construction Suite' }),
      ).toBeVisible();
      await reviewer.goto(projectPath + '/financials');
      const reviewActuals = reviewer.getByRole('region', { name: 'Actual bill costs' });
      await reviewActuals.getByRole('button', { name: 'Manage bill postings' }).click();
      await reviewActuals.getByLabel('Posting date').fill(month.slice(0, -2) + '15');
      await expect(
        reviewActuals.getByText('Accounting period closed', { exact: true }),
      ).toBeVisible();
      await reviewActuals.getByRole('button', { name: 'View bill adjustments' }).click();
      const queue = reviewActuals.getByRole('region', { name: 'Closed-period bill adjustments' });
      await queue.getByText('Adjustment source and allocations').click();
      await expect(queue.getByText(lateBill.id, { exact: true })).toBeVisible();
      await expect(queue.getByText('03-30 · Concrete · $1,250.00', { exact: true })).toBeVisible();
      await queue.getByRole('button', { name: 'Review adjustment' }).click();
      const decision = queue.getByRole('form', { name: 'Decide closed-period adjustment' });
      await decision.getByLabel('Adjustment decision').selectOption('approved');
      await decision
        .getByLabel('Decision reason')
        .fill('Reviewed and approved this exact locked-month posting.');
      await decision.getByRole('button', { name: 'Save adjustment decision' }).click();
      await expect(queue.getByText('Adjustment posted', { exact: true })).toBeVisible();
      await expect(reviewActuals.getByText('$6,250.02', { exact: true })).toBeVisible();
      await expect(
        reviewActuals.getByText('Accounting period closed', { exact: true }),
      ).toBeVisible();
      if (process.env.FIELDPRO_E2E_FORECAST_REFRESH === '1') {
        await test.step('refreshes an approved forecast after the posting and persists the off override', async () => {
          const posted = await api<{ items: { id: string; sourceId: string }[] }>(
            page,
            'GET',
            projectPath + '/actual-costs',
            200,
          );
          const adjustmentEntry = posted.items.find((item) => item.sourceId === lateBill.id);
          if (!adjustmentEntry) throw new Error('The adjustment ledger receipt is missing.');
          await page.goto(projectPath + '/financials');
          const forecasts = page.getByRole('region', { name: 'Cost forecasts', exact: true });
          const automatic = forecasts
            .getByRole('listitem')
            .filter({ hasText: 'Automatic refresh source' });
          await expect(automatic.getByText('$12,250.02', { exact: true })).toBeVisible({
            timeout: 25_000,
          });
          await automatic.getByText('Automatic refresh source', { exact: true }).click();
          await expect(automatic.getByText(adjustmentEntry.id, { exact: true })).toBeVisible();
          await expect(forecasts.getByText('$11,000.02', { exact: true })).toBeVisible();

          const settings = forecasts.getByRole('region', { name: 'Automatic forecast refresh' });
          await expect(
            settings.getByText('On after approved costs and changes · Project default'),
          ).toBeVisible();
          await settings.getByRole('combobox').selectOption('off');
          await settings
            .getByLabel('Reason')
            .fill('Freeze the test project forecast during review.');
          await settings.getByRole('button', { name: 'Save forecast refresh' }).click();
          await expect(settings.getByText('Forecast refresh setting saved.')).toBeVisible();
          await page.reload();
          await expect(settings.getByText('Off · Version 1')).toBeVisible();
          await settings.getByText('Forecast refresh history').click();
          await expect(
            settings.getByText('Freeze the test project forecast during review.'),
          ).toBeVisible();
        });
      }
    });
  } catch (error) {
    failures.push(error);
  } finally {
    for (const restore of restores.reverse()) {
      try {
        await restore();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await vendorContext.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Test or fixture cleanup failed.');
});
