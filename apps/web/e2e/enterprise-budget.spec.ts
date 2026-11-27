import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

test('opens a project budget from Costing, drills into saved lines, and reopens its approved baseline', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded local identity provider.');
  test.setTimeout(100_000);
  page.setDefaultTimeout(15_000);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  const modules = page.getByRole('navigation', { name: 'Enterprise Suite modules' });
  await expect(modules).toBeVisible({ timeout: 15_000 });
  const me = await page.request.get('/v1/me');
  expect(me.status(), await me.text()).toBe(200);
  const identity = await me.json();
  expect(identity.user.email).toBe('demo-roof-owner@example.test');
  const companyId = identity.activeOrgId;
  const reviewerId = identity.memberships.find(
    (member: { orgId: string }) => member.orgId === companyId,
  )?.membershipId as string;
  expect(reviewerId).toBeTruthy();
  const suitePath = '/v1/enterprise/status';
  const prior = await page.request.get(suitePath);
  expect(prior.status(), await prior.text()).toBe(200);
  const wasEnabled = (await prior.json()).enabled === true;

  async function enable(enabled: boolean) {
    const response = await page.request.put(suitePath, { headers, data: { enabled } });
    expect(response.status(), await response.text()).toBe(200);
  }

  try {
    if (!wasEnabled) {
      await page.getByRole('button', { name: 'Enable isolated Enterprise Suite' }).click();
      await expect(page.getByText('Enterprise workspace enabled')).toBeVisible();
    }
    await modules.getByRole('link', { name: 'Job Costing', exact: true }).click();
    await expect(page).toHaveURL(/\/enterprise\/costing$/);
    const projectName = 'Budget browser project ' + randomUUID();
    await page.getByLabel('New commercial project name').fill(projectName);
    await page.getByLabel('Original contract amount in dollars').fill('1490.00');
    await page.getByRole('button', { name: 'Add project' }).click();
    const projectPicker = page.getByRole('combobox', { name: 'Commercial project' });
    const projectId = await projectPicker
      .getByRole('option', { name: projectName, exact: true })
      .getAttribute('value');
    if (!projectId) throw new Error('Project creation returned no selectable record.');
    const path = '/enterprise/projects/' + projectId + '/budget';
    await projectPicker.selectOption(projectId);
    await expect(
      page.getByRole('heading', { name: 'Schedule of Values · preliminary progress billing' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open project budget' }).click();
    await expect(page).toHaveURL(new RegExp(path + '$'));
    await expect(page.getByRole('heading', { name: 'Project budget', exact: true })).toBeVisible();
    await expect(page.getByText(projectName, { exact: true })).toBeVisible();
    await expect(page.getByText('This project has no budget baseline.')).toBeVisible();
    const baseline = page.getByRole('region', { name: 'Budget baseline' });
    await baseline.getByRole('button', { name: 'Create baseline' }).click();
    const initial = baseline.getByRole('form', { name: 'Create draft baseline' });
    await initial.getByLabel('Currency').fill('USD');
    await initial.getByRole('button', { name: 'Create draft baseline' }).click();
    await expect(baseline.getByText('Draft · Revision 1')).toBeVisible();

    async function code(value: string, label: string) {
      await baseline.getByRole('button', { name: 'Add project cost code' }).click();
      const form = baseline.getByRole('form', { name: 'Save cost code' });
      await form.getByLabel('Cost code', { exact: true }).fill(value);
      await form.getByLabel('Cost code label').fill(label);
      await form.getByRole('button', { name: 'Save cost code' }).click();
      await expect(form).toHaveCount(0);
      await expect(
        page
          .getByRole('combobox', { name: 'Filter cost code' })
          .getByRole('option', { name: value + ' · ' + label }),
      ).toHaveCount(1);
    }

    await code('03-30', 'Concrete');
    await code('06-10', 'Framing');

    async function addLine(category: string, description: string, amount: string) {
      await baseline.getByRole('button', { name: 'Add budget line' }).click();
      const form = baseline.getByRole('form', { name: 'Save budget line' });
      await form.getByLabel('Cost code').selectOption({ label: category });
      await form.getByLabel('Description').fill(description);
      await form.getByLabel('Amount (USD)').fill(amount);
      await form.getByLabel('Project phase').fill('Structure');
      await form.getByLabel('Funding source').fill('Base contract');
      await form.getByRole('button', { name: 'Save budget line' }).click();
      await expect(form).toHaveCount(0);
    }

    await addLine('03-30 · Concrete', 'Concrete cover', '1234.56');
    await expect(baseline.getByText('Draft · Revision 2')).toBeVisible();
    await addLine('06-10 · Framing', 'Framing materials', '200.50');
    await expect(baseline.getByText('$1,435.06', { exact: true })).toBeVisible();
    await baseline.getByRole('link', { name: 'View budget source lines' }).click();
    const source = page.getByRole('region', { name: 'Budget source lines' });
    const concrete = source.getByRole('listitem').filter({ hasText: 'Concrete cover' });
    await concrete.getByText('Source details', { exact: true }).click();
    await expect(concrete.getByText('Base contract', { exact: true })).toBeVisible();
    await expect(concrete.getByText('$1,234.56', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Filter cost code' })
      .selectOption({ label: '03-30 · Concrete' });
    await expect(source.getByRole('listitem')).toHaveCount(1);
    await expect(source.getByText('Framing materials', { exact: true })).toHaveCount(0);
    await expect(baseline.getByText('$1,435.06', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter cost code' }).selectOption('');

    await baseline.getByRole('button', { name: 'Review baseline approval' }).click();
    const approval = baseline.getByRole('form', { name: 'Approve baseline' });
    await approval.getByLabel('Approval reason').fill('Checked the cost-code allowances.');
    await approval.getByRole('button', { name: 'Approve baseline', exact: true }).click();
    await expect(baseline.getByText('Approved · Revision 4')).toBeVisible();
    await expect(baseline.getByRole('button', { name: 'Add budget line' })).toHaveCount(0);

    await test.step('proposes, previews and approves a balanced transfer without changing baseline lines', async () => {
      const journal = page.getByRole('region', { name: 'Budget revisions' });
      const allocation = page.getByRole('region', { name: 'Budget allocation' });
      await expect(allocation.getByText('$1,435.06', { exact: true })).toBeVisible();
      await journal.getByRole('button', { name: 'Propose budget revision' }).click();
      let proposal = journal.getByRole('form', { name: 'Propose a budget revision' });
      await proposal.getByLabel('Revision reason').fill('Unsaved reason');
      await proposal.getByRole('button', { name: 'Cancel' }).click();
      await expect(journal.getByText('No budget revisions have been proposed.')).toBeVisible();

      await journal.getByRole('button', { name: 'Propose budget revision' }).click();
      proposal = journal.getByRole('form', { name: 'Propose a budget revision' });
      await proposal.getByLabel('Revision type').selectOption('transfer');
      const reviewers = proposal.getByLabel('Assigned reviewer');
      await expect(reviewers.locator('option[value="' + reviewerId + '"]')).toHaveCount(1);
      await reviewers.selectOption(reviewerId);
      await proposal.getByLabel('Revision reason').fill('Move the allowance to framing.');
      const first = proposal.getByRole('group', { name: 'Adjustment 1' });
      await first.getByLabel('Cost code').selectOption({ label: '03-30 · Concrete' });
      await first.getByLabel('Signed change (USD)').fill('-35.06');
      await proposal.getByRole('button', { name: 'Add adjustment' }).click();
      const second = proposal.getByRole('group', { name: 'Adjustment 2' });
      await second.getByLabel('Cost code').selectOption({ label: '06-10 · Framing' });
      await second.getByLabel('Signed change (USD)').fill('30.00');
      await proposal.getByRole('button', { name: 'Submit for review' }).click();
      await expect(proposal.getByRole('alert')).toHaveText(
        'A transfer must add and subtract the same amount.',
      );
      await expect(proposal.getByLabel('Revision reason')).toHaveValue(
        'Move the allowance to framing.',
      );
      await second.getByLabel('Signed change (USD)').fill('35.06');
      await expect(
        first.getByText('Current $1,234.56 · Change -$35.06 · Proposed $1,199.50'),
      ).toBeVisible();
      await expect(
        second.getByText('Current $200.50 · Change $35.06 · Proposed $235.56'),
      ).toBeVisible();
      await proposal.getByRole('button', { name: 'Submit for review' }).click();
      await expect(journal.getByText('Transfer · Awaiting approval')).toBeVisible();
      await journal.getByRole('button', { name: 'Record revision decision' }).click();
      await expect(journal.getByText('Proposed $1,199.50', { exact: true })).toBeVisible();
      const decision = journal.getByRole('form', { name: 'Decide budget revision' });
      await decision
        .getByRole('combobox', { name: 'Decision', exact: true })
        .selectOption('approved');
      await decision.getByLabel('Decision reason').fill('Reviewed each cost-code adjustment.');
      await decision.getByRole('button', { name: 'Save revision decision' }).click();
      await expect(journal.getByText('Transfer · Approved', { exact: true })).toBeVisible();
      await expect(journal.getByText(/Activated allocation version 5/)).toBeVisible();
      await page.getByRole('combobox', { name: 'Filter cost code' }).selectOption({
        label: '03-30 · Concrete',
      });
      await expect(allocation.getByText('$1,199.50', { exact: true })).toBeVisible();
      await expect(concrete.getByText('$1,234.56', { exact: true })).toBeVisible();
      await page.getByRole('combobox', { name: 'Filter cost code' }).selectOption('');
    });

    await test.step('preserves a proposal when a competing decision changes the allocation', async () => {
      const budgetPath = '/v1/enterprise/projects/' + projectId + '/budget';
      const summary = await page.request.get(budgetPath);
      expect(summary.status(), await summary.text()).toBe(200);
      const saved = await summary.json();
      const costCodeId = saved.availableCostCodes.find(
        (item: { code: string }) => item.code === '03-30',
      ).id as string;
      const revisionPath = budgetPath + '/' + saved.baseline.id + '/revisions';
      const versionHeaders = { ...headers, 'if-match': '5' };
      const journal = page.getByRole('region', { name: 'Budget revisions' });
      await journal.getByRole('button', { name: 'Propose budget revision' }).click();
      const proposal = journal.getByRole('form', { name: 'Propose a budget revision' });
      await proposal.getByLabel('Assigned reviewer').selectOption(reviewerId);
      await proposal.getByLabel('Cost code').selectOption(costCodeId);
      await proposal.getByLabel('Signed change (USD)').fill('7.25');
      await proposal.getByLabel('Revision reason').fill('Hold this draft through the conflict.');
      const competing = await page.request.post(revisionPath, {
        headers: versionHeaders,
        data: {
          kind: 'allocation_change',
          reviewerMembershipId: reviewerId,
          deltas: [{ costCodeId, deltaMinor: 100 }],
          reason: 'Competing scope change.',
          clientRequestId: randomUUID(),
        },
      });
      expect(competing.status(), await competing.text()).toBe(201);
      const competingId = (await competing.json()).id as string;
      const approved = await page.request.post(revisionPath + '/' + competingId + '/decision', {
        headers: versionHeaders,
        data: { outcome: 'approved', reason: 'Review complete.', clientRequestId: randomUUID() },
      });
      expect(approved.status(), await approved.text()).toBe(201);
      await proposal.getByRole('button', { name: 'Submit for review' }).click();
      const rebase = proposal.getByRole('button', { name: 'Use allocation version 6' });
      await expect(rebase).toBeEnabled();
      await expect(proposal.getByLabel('Revision reason')).toHaveValue(
        'Hold this draft through the conflict.',
      );
      await expect(proposal.getByLabel('Signed change (USD)')).toHaveValue('7.25');
      await expect(proposal.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
      await expect(
        proposal.getByText('Current $1,200.50 · Change $7.25 · Proposed $1,207.75'),
      ).toBeVisible();
      await rebase.click();
      await expect(proposal.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
      await proposal.getByRole('button', { name: 'Cancel' }).click();
      await expect(journal.getByText('Hold this draft through the conflict.')).toHaveCount(0);
    });

    const date = page.getByLabel('As of', { exact: true });
    const today = await date.inputValue();
    const priorDate = new Date(today + 'T00:00:00.000Z');
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
    await date.fill(priorDate.toISOString().slice(0, 10));
    await expect(baseline.getByText('There is no baseline for this date.')).toBeVisible();
    await page.getByRole('button', { name: 'Show current budget' }).click();
    await expect(baseline.getByText('Approved · Revision 4')).toBeVisible();
    await expect(baseline.getByText('Checked the cost-code allowances.')).toBeVisible();
    await expect(source.getByRole('listitem')).toHaveCount(2);
  } finally {
    if (!wasEnabled) await enable(false);
  }
});

test('requires a second manager to approve a purchase amendment and posts only the delta', async ({
  browser,
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1',
    'Requires two seeded local identities.',
  );
  test.setTimeout(80_000);
  page.setDefaultTimeout(15_000);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  await expect(page.getByRole('heading', { name: 'Commercial Construction Suite' })).toBeVisible();

  async function command<T>(
    method: string,
    url: string,
    status: number,
    data?: object,
    revision?: number,
  ): Promise<T> {
    const response = await page.request.fetch('/v1' + url, {
      method,
      data,
      headers: revision === undefined ? headers : { ...headers, 'if-match': String(revision) },
    });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }

  const original = await command<{ enabled: boolean }>('GET', '/enterprise/status', 200);
  const roster = await command<{
    items: { id: string; email: string; revision: number; role: string }[];
  }>('GET', '/team/members?limit=100&status=active', 200);
  const previousReviewer = roster.items.find(
    (item) => item.email === 'demo-roof-estimator@example.test',
  );
  if (!previousReviewer) throw new Error('The seeded reviewer is missing.');
  let reviewerChanged = false;
  const mobile = testInfo.project.name === 'mobile-chromium';
  const reviewer = await browser.newContext({
    baseURL,
    viewport: page.viewportSize() ?? undefined,
    isMobile: mobile,
    hasTouch: mobile,
  });
  try {
    if (!original.enabled) await command('PUT', '/enterprise/status', 200, { enabled: true });
    if (previousReviewer.role !== 'admin') {
      await command(
        'PATCH',
        '/team/members/' + previousReviewer.id,
        200,
        { role: 'admin' },
        previousReviewer.revision,
      );
      reviewerChanged = true;
    }
    const name = 'Purchase commitment browser ' + randomUUID();
    const project = await command<{ id: string }>('POST', '/enterprise/projects', 201, {
      name,
      originalContractMinor: 1500000,
    });
    const path = '/enterprise/projects/' + project.id;
    await command('POST', path + '/purchase-cost-codes', 201, { code: '03-30', label: 'Concrete' });
    await command('POST', path + '/purchase-cost-codes', 201, { code: '06-10', label: 'Framing' });
    const bid = await command<{ id: string }>('POST', path + '/bid-packages', 201, {
      title: 'Foundation allowance',
      scope: 'Initial foundation work',
      dueOn: '2099-08-09',
      clientRequestId: randomUUID(),
    });
    const bidPath = path + '/bid-packages/' + bid.id;
    const quote = await command<{ id: string }>(
      'POST',
      bidPath + '/quotes',
      201,
      {
        vendorName: 'Synthetic vendor',
        amountMinor: 1_000_000,
        validThrough: '2099-09-01',
        qualifications: '',
        leadDays: 4,
        clientRequestId: randomUUID(),
      },
      1,
    );
    await test.step('remembers the opt-in view for pending quotes without changing the approved total', async () => {
      let reads = 0;
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1' + path + '/budget/pending-bids') reads += 1;
      });
      await page.goto(path + '/financials');
      const section = page.getByRole('region', { name: 'View pending bid commitments' });
      const toggle = section.getByRole('checkbox', { name: 'Include pending commitments' });
      const approved = page.getByRole('region', { name: 'Approved purchase commitments' });
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();
      await expect(approved.getByText('$0.00', { exact: true })).toBeVisible();
      expect(reads).toBe(0);
      await toggle.check();
      await expect(section.getByText('Foundation allowance · Synthetic vendor')).toBeVisible();
      await expect(section.getByText('$10,000.00')).toBeVisible();
      await expect(approved.getByText('$0.00', { exact: true })).toBeVisible();
      expect(reads).toBeGreaterThan(0);
      await page.reload();
      await expect(toggle).toBeChecked();
      await expect(section.getByText('Foundation allowance · Synthetic vendor')).toBeVisible();
      await toggle.uncheck();
      await expect(section.getByRole('heading', { name: 'Pending bids' })).toHaveCount(0);
      await page.reload();
      await expect(toggle).toBeEnabled();
      await expect(toggle).not.toBeChecked();
      await expect(section.getByRole('heading', { name: 'Pending bids' })).toHaveCount(0);
    });
    await command(
      'POST',
      bidPath + '/decision',
      200,
      { quoteId: quote.id, note: 'Award confirmed' },
      2,
    );
    const order = await command<{ id: string }>(
      'POST',
      bidPath + '/purchase-order',
      201,
      {
        deliveryAddress: '101 Synthetic Way',
        requestedDeliveryOn: null,
        costCode: '03-30',
      },
      3,
    );
    const reviewerPage = await reviewer.newPage();
    reviewerPage.setDefaultTimeout(15_000);
    await reviewerPage.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
    await chooseDevIdentity(reviewerPage, 'demo-roof-estimator');
    await reviewerPage.waitForURL('**/enterprise');
    await expect(
      reviewerPage.getByRole('heading', { name: 'Commercial Construction Suite' }),
    ).toBeVisible();

    await test.step('keeps issuing blocked after owner rejection and releases a matching waiver', async () => {
      const budgetPath = path + '/budget';
      const details = await command<{
        asOf: string;
        availableCostCodes: { code: string; id: string }[];
      }>('GET', budgetPath, 200);
      const concrete = details.availableCostCodes.find(({ code }) => code === '03-30');
      if (!concrete) throw new Error('The initial cost code is missing.');
      const created = await command<{ id: string }>(
        'POST',
        budgetPath,
        201,
        {
          currency: 'USD',
          effectiveOn: details.asOf,
          clientRequestId: randomUUID(),
        },
        0,
      );
      const baselinePath = budgetPath + '/' + created.id;
      await command(
        'POST',
        baselinePath + '/lines',
        201,
        {
          costCodeId: concrete.id,
          amountMinor: 800_000,
          currency: 'USD',
          description: 'Concrete baseline allowance',
          unit: 'lump_sum',
          phase: 'Structure',
          fundingSource: 'Approved contract',
          clientRequestId: randomUUID(),
        },
        1,
      );
      await command(
        'POST',
        baselinePath + '/approval',
        201,
        {
          reason: 'Approved original concrete budget.',
          clientRequestId: randomUUID(),
        },
        2,
      );
      const original = await command<{ baseline: unknown }>('GET', budgetPath, 200);
      const orderPath = path + '/purchase-orders/' + order.id;
      const variancePath = orderPath + '/variance';
      const requester = reviewerPage.getByRole('region', { name: 'Purchase overrun review' });
      const review = page.getByRole('region', { name: 'Purchase overrun review' });

      async function submit(reason: string) {
        await requester.getByRole('button', { name: 'Request owner review' }).click();
        const form = requester.getByRole('form', { name: 'Request owner review' });
        await form.getByLabel('Reason').fill(reason);
        await form.getByRole('button', { name: 'Submit overrun for review' }).click();
        await expect(requester.getByText('Awaiting owner review', { exact: true })).toBeVisible();
      }

      async function decide(outcome: 'approved' | 'rejected', reason: string) {
        await review.getByRole('button', { name: 'Decide purchase overrun' }).click();
        const form = review.getByRole('form', { name: 'Decide purchase overrun' });
        await form.getByRole('combobox', { name: 'Decision', exact: true }).selectOption(outcome);
        if (outcome === 'approved')
          await expect(form.getByLabel('Authorized overrun (USD)')).toHaveValue('2000.00');
        await form.getByLabel('Reason').fill(reason);
        await form.getByRole('button', { name: 'Save owner decision' }).click();
      }

      await reviewerPage.goto(variancePath);
      await expect(reviewerPage).toHaveURL(new RegExp(variancePath + '$'));
      await expect(requester.getByText('$2,000.00', { exact: true })).toBeVisible();
      await submit('Please review the delivery overrun.');
      await page.goto(path + '/financials');
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
      await activity.getByRole('link', { name: 'Review owner decision' }).click();
      await expect(
        page.getByRole('heading', { name: 'Purchase overrun', exact: true }),
      ).toBeVisible();
      await decide('rejected', 'Correct the delivery address first.');
      await expect(
        review.getByText('Issuance requires a waiver for the current overrun.'),
      ).toBeVisible();
      await expect(review.getByText('Rejected', { exact: true })).toBeVisible();
      await command('POST', orderPath + '/issue', 409, {}, 1);

      await command(
        'PATCH',
        orderPath,
        200,
        {
          deliveryAddress: '102 Synthetic Way',
          requestedDeliveryOn: null,
          costCode: '03-30',
        },
        1,
      );
      await command('POST', orderPath + '/issue', 409, {}, 2);
      await test.step('finds the current owner review in Compliance and removes resolved exceptions', async () => {
        await page.goto(path + '/financials');
        await page.getByRole('link', { name: 'Compliance', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Finance compliance' })).toBeVisible();
        const queue = page.getByRole('region', { name: 'Current purchase exceptions' });
        await expect(queue.getByText('No purchase overruns awaiting owner review.')).toBeVisible();
        await reviewerPage.reload();
        await submit('The delivery address is now confirmed.');
        await reviewerPage.goto('/enterprise/finance/compliance?projectId=' + project.id);
        const reviewerQueue = reviewerPage.getByRole('region', {
          name: 'Current purchase exceptions',
        });
        await reviewerQueue.getByRole('button', { name: 'View exception' }).click();
        await expect(reviewerPage.getByRole('link', { name: 'View review history' })).toBeVisible();
        await expect(reviewerPage.getByRole('link', { name: 'Review owner decision' })).toHaveCount(
          0,
        );
        await page.reload();
        await expect(queue.getByText('$2,000.00 purchase overrun', { exact: true })).toBeVisible();
        await queue.getByRole('button', { name: 'View exception' }).click();
        const dialog = page.getByRole('dialog', { name: 'Purchase exception' });
        const detail = (await dialog.isVisible())
          ? dialog
          : page.getByRole('complementary', { name: 'Purchase exception detail' });
        await expect(detail.getByText('Order version 2 · Allocation version 3')).toBeVisible();
        await detail.getByRole('link', { name: 'Review owner decision' }).click();
        await expect(page).toHaveURL(new RegExp(variancePath + '$'));
      });
      await decide('approved', 'Approve the reviewed two thousand dollar overrun.');
      await expect(review.getByText('The owner waiver covers the current overrun.')).toBeVisible();
      await command('POST', orderPath + '/issue', 200, {}, 2);
      await page.goto('/enterprise/finance/compliance?projectId=' + project.id);
      await expect(page.getByText('No purchase overruns awaiting owner review.')).toBeVisible();
      const after = await command<{ baseline: unknown }>('GET', budgetPath, 200);
      expect(after.baseline).toEqual(original.baseline);
    });

    async function history(target: typeof page) {
      await target.goto(path + '/budget');
      const commitments = target.getByRole('region', { name: 'Approved purchase commitments' });
      await expect(commitments.getByText('$10,000.00', { exact: true }).first()).toBeVisible();
      await commitments.getByRole('button', { name: 'View source purchase orders' }).click();
      await commitments.getByText(/Foundation allowance · Synthetic vendor/).click();
      const orders = commitments.getByRole('region', { name: 'Purchase order commitment history' });
      await orders.getByRole('button', { name: 'View commitment history' }).click();
      await expect(orders.getByText('Original issue · Approved', { exact: true })).toBeVisible();
      return { commitments, orders };
    }

    const owner = await history(page);
    await owner.orders.getByRole('button', { name: 'Propose purchase order amendment' }).click();
    const form = owner.orders.getByRole('form', { name: 'Propose purchase order amendment' });
    await form
      .getByRole('group', { name: 'Allocation 1' })
      .getByLabel('Revised amount (USD)')
      .fill('7000');
    await form.getByRole('button', { name: 'Add allocation' }).click();
    const second = form.getByRole('group', { name: 'Allocation 2' });
    await second.getByLabel('Purchase cost code').selectOption({ label: '06-10 · Framing' });
    await second.getByLabel('Revised amount (USD)').fill('5000.00');
    await form.getByLabel('Amendment reason').fill('Add the framing allowance.');
    await expect(form.getByText('Proposed commitment $12,000.00')).toBeVisible();
    await form.getByRole('button', { name: 'Submit amendment for review' }).click();
    await expect(
      owner.orders.getByText('Amendment · Awaiting approval', { exact: true }),
    ).toBeVisible();
    await expect(owner.orders.getByRole('button', { name: 'Review amendment' })).toHaveCount(0);

    const activeReview = await history(reviewerPage);
    await activeReview.orders.getByRole('button', { name: 'Review amendment' }).click();
    await expect(
      activeReview.orders.getByText('Prior $10,000.00 · Change -$3,000.00 · Revised $7,000.00'),
    ).toBeVisible();
    await expect(
      activeReview.orders.getByText('Prior $0.00 · Change $5,000.00 · Revised $5,000.00'),
    ).toBeVisible();
    const decision = activeReview.orders.getByRole('form', {
      name: 'Decide purchase order amendment',
    });
    await decision
      .getByRole('combobox', { name: 'Decision', exact: true })
      .selectOption('approved');
    await decision.getByLabel('Decision reason').fill('Checked both cost-code changes.');
    await decision.getByRole('button', { name: 'Save amendment decision' }).click();
    await expect(
      activeReview.orders.getByText('Amendment · Approved', { exact: true }),
    ).toBeVisible();
    await expect(
      activeReview.commitments.getByText('$12,000.00', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      activeReview.orders.getByText('Original issue · Approved', { exact: true }),
    ).toBeVisible();
    await reviewerPage
      .getByRole('combobox', { name: 'Filter cost code' })
      .selectOption({ label: '06-10 · Framing' });
    await expect(
      activeReview.commitments.getByText('$5,000.00', { exact: true }).first(),
    ).toBeVisible();
    const saved = await command<{ order: { amountMinor: number } }>(
      'GET',
      bidPath + '/purchase-order',
      200,
    );
    expect(saved.order.amountMinor).toBe(1_000_000);
  } finally {
    await reviewer.close();
    try {
      if (reviewerChanged) {
        const current = await command<{ revision: number }>(
          'GET',
          '/team/members/' + previousReviewer.id,
          200,
        );
        await command(
          'PATCH',
          '/team/members/' + previousReviewer.id,
          200,
          {
            role: previousReviewer.role,
          },
          current.revision,
        );
      }
    } finally {
      if (!original.enabled) await command('PUT', '/enterprise/status', 200, { enabled: false });
    }
  }
});
