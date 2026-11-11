import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { json, makeMe, renderWithApp, scriptedFetch } from '../../test/helpers';
import { AppFrame } from '../../components/shell/AppFrame';
import { navigation } from '../../test/navigation';
import { PlumbingEstimatorView } from './PlumbingEstimatorView';

// PL-004/016/017/019/040 screen behaviour: the estimator panel is rendered with a fake signed-in
// owner, driven through real clicks/typing, and the save panel is asserted against the requests it
// makes (inputs only -- the server owns the totals).
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const REVISION_ID = '66666666-6666-4666-8666-666666666666';
const ESTIMATE_ID = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-11-01T00:00:00.000Z';

const project = {
  id: PROJECT_ID,
  name: 'Bathroom rough-in',
  jurisdiction: '',
  status: 'draft',
  revision: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const revision = {
  id: REVISION_ID,
  projectId: PROJECT_ID,
  revisionNumber: 1,
  fixtures: [{ id: 'fx-1', type: 'water_closet', quantity: 1 }],
  runs: [],
  note: null,
  approvedAt: null,
  createdAt: NOW,
};

const totals = {
  materialMinor: 41000,
  laborMinor: 25000,
  equipmentMinor: 0,
  contingencyMinor: 3300,
  overheadMinor: 6600,
  markupMinor: 11400,
  subtotalMinor: 87300,
  preTaxMinor: 87300,
  taxMinor: 6100,
  totalMinor: 93400,
};

function estimate(overrides: Record<string, unknown> = {}) {
  return {
    id: ESTIMATE_ID,
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    revisionNumber: 1,
    status: 'draft',
    totals,
    laborHours: 2.6,
    materialMinor: totals.materialMinor,
    unpricedLineKeys: [],
    prices: {},
    approvedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function setup() {
  window.localStorage.clear();
  navigation.pathname = '/plumbing';
  const script = scriptedFetch({
    'GET /v1/me': json(makeMe({ role: 'owner' })),
    'POST /v1/plumbing/projects': json(project, 201),
    [`POST /v1/plumbing/projects/${PROJECT_ID}/revisions`]: json(revision, 201),
    [`POST /v1/plumbing/projects/${PROJECT_ID}/estimates`]: json(estimate(), 201),
    [`POST /v1/plumbing/projects/${PROJECT_ID}/estimates/${ESTIMATE_ID}/approve`]: json(
      estimate({ status: 'approved', approvedAt: NOW }),
    ),
  });
  renderWithApp(
    <AppFrame>
      <PlumbingEstimatorView />
    </AppFrame>,
    { fetch: script.fetch },
  );
  return script;
}

const recordsSection = () =>
  screen.getByRole('heading', { name: 'Company records' }).closest('section') as HTMLElement;

describe('plumbing estimator panel', () => {
  it('PL-004: adding and removing fixtures updates the fixture-unit totals', async () => {
    setup();
    expect(await screen.findByText(/2 fixtures/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add fixture' }));
    await waitFor(() => expect(screen.getByText(/3 fixtures/)).toBeTruthy());

    const remove = screen.getAllByRole('button', { name: 'Remove' })[0]!;
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByText(/2 fixtures/)).toBeTruthy());
  });

  it('PL-017: the takeoff starts unpriced, and sample prices price every line', async () => {
    setup();
    expect(await screen.findByText(/still need a price/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use sample prices' }));
    await waitFor(() => expect(screen.queryByText(/still need a price/)).toBeNull());

    const priceInputs = screen.getAllByLabelText(/^Unit price for /) as HTMLInputElement[];
    expect(priceInputs.length).toBeGreaterThan(0);
    for (const input of priceInputs) expect(input.value).not.toBe('');
  });

  it('PL-010/040: saving sends inputs only and approval freezes the stored estimate', async () => {
    const { calls } = setup();
    expect(await screen.findByText(/2 fixtures/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add fixture' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use sample prices' }));

    fireEvent.click(
      screen.getByRole('button', { name: 'Save priced estimate to company records' }),
    );

    await within(recordsSection()).findByText(/Saved revision 1/);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.map((c) => new URL(c.url, 'http://x').pathname)).toEqual([
      '/v1/plumbing/projects',
      `/v1/plumbing/projects/${PROJECT_ID}/revisions`,
      `/v1/plumbing/projects/${PROJECT_ID}/estimates`,
    ]);

    const revisionBody = posts[1]!.body as { design: { fixtures: unknown[] } };
    expect(revisionBody.design.fixtures).toHaveLength(3);
    const estimateBody = posts[2]!.body as Record<string, unknown>;
    expect(estimateBody.revisionId).toBe(REVISION_ID);
    // The client may not send money: totals are always recomputed by the server engine.
    expect(Object.keys(estimateBody)).not.toContain('totals');
    expect(Object.keys(estimateBody)).not.toContain('totalMinor');

    fireEvent.click(screen.getByRole('button', { name: 'Approve estimate' }));
    await within(recordsSection()).findByText(/approved and frozen/);
    const approve = calls.find((c) => c.url.includes('/approve'))!;
    expect(approve.method).toBe('POST');
  });
});
