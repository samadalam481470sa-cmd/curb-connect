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
  await expect(modules).toBeVisible();
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
