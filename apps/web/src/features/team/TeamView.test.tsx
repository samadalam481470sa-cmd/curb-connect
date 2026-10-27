import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppFrame } from '../../components/shell/AppFrame';
import { ORG_A, USER_ID, json, makeMe, renderWithApp, scriptedFetch } from '../../test/helpers';
import { navigation } from '../../test/navigation';
import { TeamView } from './TeamView';

const meta = (id: string) => ({
  id,
  orgId: ORG_A,
  revision: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const members = {
  items: [
    {
      ...meta('66666666-6666-4666-8666-666666666661'),
      userId: USER_ID,
      displayName: 'Dana Field',
      email: null,
      role: 'owner',
      status: 'active',
      title: null,
      joinedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      ...meta('66666666-6666-4666-8666-666666666662'),
      userId: '77777777-7777-4777-8777-777777777772',
      displayName: 'Ravi Reviewer',
      email: null,
      role: 'reviewer',
      status: 'active',
      title: null,
      joinedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
  nextCursor: null,
};

function setup(role: 'owner' | 'estimator') {
  navigation.pathname = '/team';
  const script = scriptedFetch({
    'GET /v1/me': json(makeMe({ role })),
    'GET /v1/team/members': json(members),
    'GET /v1/team/invitations': json({ items: [], nextCursor: null }),
    'PATCH /v1/team/members/66666666-6666-4666-8666-666666666662': json({
      ...members.items[1],
      role: 'estimator',
      revision: 4,
    }),
  });
  renderWithApp(
    <AppFrame>
      <TeamView />
    </AppFrame>,
    { fetch: script.fetch },
  );
  return script;
}

describe('team management (PLT-015)', () => {
  it('PLT-015-FE: an estimator sees team actions with an explanation instead of working buttons', async () => {
    setup('estimator');
    expect(await screen.findByText('Ravi Reviewer')).toBeTruthy();
    expect(screen.getAllByText(/Estimator role cannot do this/).length).toBeGreaterThan(0);
    const deactivate = screen.getAllByRole('button', { name: /Deactivate/ })[0]!;
    expect(deactivate.getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
    expect(screen.getByText(/Only the owner can transfer ownership/)).toBeTruthy();
  });

  it('PLT-015-FE: an owner changes a role with If-Match and the owner row is protected', async () => {
    const { calls } = setup('owner');
    await screen.findByText('Ravi Reviewer');
    expect(
      screen.getByText('The owner role changes only through ownership transfer.'),
    ).toBeTruthy();
    const select = screen.getByLabelText('Role for Ravi Reviewer') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain('owner');
    fireEvent.change(select, { target: { value: 'estimator' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ role: 'estimator' });
    expect(patch.headers.get('If-Match')).toBe('"3"');
  });

  it('PLT-015-FE: deactivation asks for confirmation and explains the consequence', async () => {
    setup('owner');
    await screen.findByText('Ravi Reviewer');
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/lose access on their next request/)).toBeTruthy();
  });
});
