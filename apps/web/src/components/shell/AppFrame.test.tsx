import { BRAND } from '@fieldline/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  ORG_A,
  ORG_B,
  json,
  makeMe,
  problem,
  renderWithApp,
  scriptedFetch,
} from '../../test/helpers';
import { navigation } from '../../test/navigation';
import { AreaPage } from '../AreaPage';
import { AppFrame } from './AppFrame';

const twoCompanies = (activeOrgId: string | null) =>
  makeMe({
    activeOrgId,
    activeRole: activeOrgId ? 'owner' : null,
    memberships: [
      {
        membershipId: '55555555-5555-4555-8555-555555555551',
        orgId: ORG_A,
        orgDisplayName: 'Alder Roofing',
        role: 'owner',
        status: 'active',
      },
      {
        membershipId: '55555555-5555-4555-8555-555555555552',
        orgId: ORG_B,
        orgDisplayName: 'Birch Concrete',
        role: 'estimator',
        status: 'active',
      },
    ],
  });

describe('AppFrame shell (PLT-011)', () => {
  it('PLT-011-FE: renders skip link, desktop sidebar, phone bottom nav and breadcrumbs', async () => {
    navigation.pathname = '/curb';
    const { fetch } = scriptedFetch({ 'GET /v1/me': json(makeMe()) });
    renderWithApp(
      <AppFrame>
        <AreaPage routeId="curb" />
      </AppFrame>,
      { fetch },
    );
    const main = await screen.findByRole('main');
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      `#${main.id}`,
    );

    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    const sideLinks = within(sidebar)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(sideLinks.slice(0, 3)).toEqual(['Home', BRAND.products.roof, BRAND.products.curb]);
    expect(
      within(sidebar).getByRole('link', { name: BRAND.products.curb }).getAttribute('aria-current'),
    ).toBe('page');

    const bottom = screen.getByRole('navigation', { name: 'Main (phone)' });
    expect(within(bottom).getAllByRole('link').length).toBeLessThanOrEqual(5);
    expect(within(bottom).getByRole('link', { name: BRAND.products.roof })).toBeTruthy();

    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText(BRAND.products.curb).getAttribute('aria-current')).toBe('page');

    expect(screen.getByRole('heading', { level: 1, name: BRAND.products.curb })).toBeTruthy();
    expect(screen.getByText(/coming in a later slice/)).toBeTruthy();
    expect(screen.getByRole('search')).toBeTruthy();
  });

  it('PLT-015-FE: a direct link to an area the role cannot open explains why', async () => {
    navigation.pathname = '/billing';
    const { fetch } = scriptedFetch({ 'GET /v1/me': json(makeMe({ role: 'crew_manager' })) });
    renderWithApp(
      <AppFrame>
        <AreaPage routeId="billing" />
      </AppFrame>,
      { fetch },
    );
    expect(await screen.findByText('You cannot open Billing')).toBeTruthy();
    expect(screen.getByText(/Crew manager role cannot do this/)).toBeTruthy();
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).queryByRole('link', { name: 'Billing' })).toBeNull();
  });

  it('PLT-011-FE: client-side navigation for shell links, browser default for modified clicks', async () => {
    const { fetch } = scriptedFetch({ 'GET /v1/me': json(makeMe()) });
    renderWithApp(
      <AppFrame>
        <p>content</p>
      </AppFrame>,
      { fetch },
    );
    const sidebar = await screen.findByRole('navigation', { name: 'Main' });
    fireEvent.click(within(sidebar).getByRole('link', { name: 'Team' }));
    expect(navigation.push).toHaveBeenCalledWith('/team');
    navigation.push.mockReset();
    fireEvent.click(within(sidebar).getByRole('link', { name: 'Jobs' }), { ctrlKey: true });
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it('PLT-011-FE: an expired session goes to the recovery page and renders no shell content', async () => {
    navigation.pathname = '/team';
    const { fetch } = scriptedFetch({ 'GET /v1/me': problem('session_expired') });
    renderWithApp(
      <AppFrame>
        <p>secret team list</p>
      </AppFrame>,
      { fetch },
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/access?returnTo=%2Fteam&reason=expired'),
    );
    expect(screen.queryByText('secret team list')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('PLT-013-FE: a signed-out visitor is sent to sign-in with a return path', async () => {
    navigation.pathname = '/settings';
    const { fetch } = scriptedFetch({ 'GET /v1/me': problem('unauthenticated') });
    renderWithApp(
      <AppFrame>
        <p>x</p>
      </AppFrame>,
      { fetch },
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/sign-in?returnTo=%2Fsettings'),
    );
  });
});

describe('workspace switcher (PLT-004 S)', () => {
  it('PLT-004-FE: a member of several companies without an active one must choose explicitly', async () => {
    navigation.pathname = '/jobs';
    const { fetch } = scriptedFetch({ 'GET /v1/me': json(twoCompanies(null)) });
    renderWithApp(
      <AppFrame>
        <p>jobs content</p>
      </AppFrame>,
      { fetch },
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('/select-workspace?returnTo=%2Fjobs'),
    );
    expect(screen.queryByText('jobs content')).toBeNull();
  });

  it('PLT-014-FE: a signed-in user with no company goes to first-run setup', async () => {
    const { fetch } = scriptedFetch({
      'GET /v1/me': json(
        makeMe({ activeOrgId: null, activeRole: null, memberships: [], permissions: [] }),
      ),
    });
    renderWithApp(
      <AppFrame>
        <p>x</p>
      </AppFrame>,
      { fetch },
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/onboarding'));
  });

  it('PLT-004-FE: switching asks the API, then drops every cached record of the previous company', async () => {
    const { fetch, calls } = scriptedFetch({
      'GET /v1/me': json(twoCompanies(ORG_A)),
      'POST /v1/session/active-org': json(twoCompanies(ORG_B)),
    });
    const { queryClient } = renderWithApp(
      <AppFrame>
        <p>home</p>
      </AppFrame>,
      { fetch },
    );
    queryClient.setQueryData(['org', ORG_A, 'team', 'members'], { items: ['cached A member'] });

    const trigger = await screen.findByRole('button', { name: /Switch company workspace/ });
    expect(trigger.textContent).toContain('Alder Roofing');
    fireEvent.click(trigger);
    const option = screen.getByRole('button', { name: /Birch Concrete/ });
    fireEvent.click(option);

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/'));
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({ orgId: ORG_B });
    expect(queryClient.getQueryData(['org', ORG_A, 'team', 'members'])).toBeUndefined();
    expect(queryClient.getQueryData<{ activeOrgId: string }>(['me'])?.activeOrgId).toBe(ORG_B);
  });

  it('PLT-004-FE: suspended or revoked memberships are never offered', async () => {
    const me = twoCompanies(ORG_A);
    me.memberships[1]!.status = 'revoked';
    const { fetch } = scriptedFetch({ 'GET /v1/me': json(me) });
    renderWithApp(
      <AppFrame>
        <p>home</p>
      </AppFrame>,
      { fetch },
    );
    fireEvent.click(await screen.findByRole('button', { name: /Switch company workspace/ }));
    expect(screen.queryByRole('button', { name: /Birch Concrete/ })).toBeNull();
  });
});
