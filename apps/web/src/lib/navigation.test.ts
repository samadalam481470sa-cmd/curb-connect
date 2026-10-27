import {
  BRAND,
  MEMBER_ROLES,
  permissionsFor,
  type Action,
  type MemberRole,
} from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import { FLAG_OFF_REASON, bottomNavEntries, buildNavigation } from './navigation';
import { breadcrumbTrail, matchRoute, primaryAncestor, safeReturnTo } from './routing';

function navFor(role: MemberRole, flags: Record<string, boolean> = {}) {
  const allowed = new Set<Action>(permissionsFor(role));
  return buildNavigation({
    can: (a) => allowed.has(a),
    flag: (f) => flags[f] ?? true,
    currentPrimaryId: 'home',
  });
}

describe('navigation (PLT-011)', () => {
  it('PLT-011-FE: Roof Measurements and Curb Cutting are adjacent peers right after Home for every role', () => {
    for (const role of MEMBER_ROLES) {
      const labels = navFor(role).map((e) => e.label);
      expect(labels.slice(0, 3)).toEqual(['Home', BRAND.products.roof, BRAND.products.curb]);
    }
  });

  it('PLT-015-FE: hides areas the role cannot open (crew manager has no billing or reports)', () => {
    const ids = navFor('crew_manager').map((e) => e.id);
    expect(ids).not.toContain('billing');
    expect(ids).not.toContain('reports');
    expect(ids).toContain('jobs');
    expect(navFor('owner').map((e) => e.id)).toEqual([
      'home',
      'roof',
      'curb',
      'leads',
      'jobs',
      'proposals',
      'billing',
      'reports',
      'team',
      'settings',
    ]);
  });

  it('PLT-020-FE: a disabled feature flag shows the area as unavailable instead of hiding or faking it', () => {
    const entries = navFor('owner', { 'billing.invoices': false });
    const billing = entries.find((e) => e.id === 'billing');
    expect(billing?.unavailableReason).toBe(FLAG_OFF_REASON);
    expect(entries.find((e) => e.id === 'roof')?.unavailableReason).toBeUndefined();
  });

  it('PLT-011-FE: phone bottom bar has at most five entries and always includes both products', () => {
    for (const role of MEMBER_ROLES) {
      const bottom = bottomNavEntries(navFor(role));
      expect(bottom.length).toBeLessThanOrEqual(5);
      expect(bottom.map((e) => e.id)).toEqual(expect.arrayContaining(['roof', 'curb']));
    }
  });
});

describe('route matching', () => {
  it('PLT-011-FE: deep links resolve to registry routes with breadcrumbs', () => {
    const route = matchRoute('/curb/projects/abc/estimates/def');
    expect(route?.id).toBe('curb.estimate');
    expect(breadcrumbTrail(route!).map((c) => c.label)).toEqual([
      'Home',
      BRAND.products.curb,
      'Curb project',
      'Curb estimate',
    ]);
    // Parameterised ancestors are not linked (their ids are unknown here).
    expect(breadcrumbTrail(route!)[2]?.href).toBeUndefined();
    expect(primaryAncestor(route!).id).toBe('curb');
  });

  it('matches /home as an alias, specific routes before parameterised ones, and unknown sub-paths to their area', () => {
    expect(matchRoute('/home')?.id).toBe('home');
    expect(matchRoute('/roof/new')?.id).toBe('roof.new');
    expect(matchRoute('/roof/orders/123')?.id).toBe('roof.order');
    expect(matchRoute('/settings/notifications/')?.id).toBe('settings.notifications');
    expect(matchRoute('/jobs/board/extra/deep')?.id).toBe('jobs');
    expect(matchRoute('/nowhere')).toBeNull();
  });

  it('PLT-013-FE: returnTo only accepts same-origin relative paths', () => {
    expect(safeReturnTo('/team?x=1')).toBe('/team?x=1');
    expect(safeReturnTo('https://evil.example')).toBe('/');
    expect(safeReturnTo('//evil.example')).toBe('/');
    expect(safeReturnTo('/\\evil.example')).toBe('/');
    expect(safeReturnTo('/sign-in?returnTo=/x')).toBe('/');
    expect(safeReturnTo(null)).toBe('/');
  });
});
