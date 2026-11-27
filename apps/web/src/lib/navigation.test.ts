import {
  BRAND,
  MEMBER_ROLES,
  permissionsFor,
  type Action,
  type MemberRole,
} from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import {
  FLAG_OFF_REASON,
  bottomNavEntries,
  buildNavigation,
  buildNavigationTree,
} from './navigation';
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
    expect(ids).toContain('lawn');
    expect(navFor('owner').map((e) => e.id)).toEqual([
      'home',
      'roof',
      'curb',
      'attention',
      'build',
      'plumbing',
      'lawn',
      'hvac',
      'electrical',
      'leads',
      'crewBoard',
      'projectManagement',
      'landScout',
      'gisWorkbench',
      'planToBid',
      'govOpportunities',
      'customers',
      'jobs',
      'warranty',
      'homeSales',
      'designCenter',
      'landManagement',
      'bidding',
      'manualOrders',
      'permitJobs',
      'field',
      'timeTracking',
      'fieldInspections',
      'proposals',
      'estimateTemplates',
      'network',
      'networkOrders',
      'assignments',
      'billing',
      'analysis',
      'jobCost',
      'payables',
      'reports',
      'team',
      'supplierOrders',
      'settings',
      'integrations',
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

function treeFor(role: MemberRole, flags: Record<string, boolean> = {}) {
  const allowed = new Set<Action>(permissionsFor(role));
  return buildNavigationTree({
    can: (a) => allowed.has(a),
    flag: (f) => flags[f] ?? true,
    currentPrimaryId: 'home',
  });
}

describe('navigation tree (PLT-011)', () => {
  it('PLT-011-FE-TREE: the tree holds exactly the flat items, grouped under labeled sections', () => {
    for (const role of MEMBER_ROLES) {
      const flat = navFor(role).map((e) => e.id).sort();
      const inTree = treeFor(role)
        .flatMap((s) => [...s.entries, ...s.groups.flatMap((g) => g.entries)])
        .map((e) => e.id)
        .sort();
      expect(inTree).toEqual(flat);
    }
  });

  it('PLT-011-FE-TREE: top-level group is Home + both products; sections carry their labels', () => {
    const tree = treeFor('owner');
    expect(tree[0]?.label).toBeNull();
    expect(tree[0]?.entries.map((e) => e.id)).toEqual(['home', 'roof', 'curb']);
    expect(tree.slice(1).map((s) => s.label)).toEqual([
      'Operations',
      'Sales',
      'Build & Estimate',
      'Finance',
      'Land',
      'Service & Field',
      'Company',
    ]);
  });

  it('PLT-015-FE-TREE: empty sections are dropped for roles that cannot use them', () => {
    const tree = treeFor('crew_manager');
    expect(tree.map((s) => s.id)).not.toContain('finance');
    for (const section of tree) {
      const count =
        section.entries.length + section.groups.reduce((n, g) => n + g.entries.length, 0);
      expect(count).toBeGreaterThan(0);
    }
  });

  it('PLT-011-FE-TREE: current + unavailable markers survive grouping', () => {
    const tree = treeFor('owner', { 'billing.invoices': false });
    const finance = tree.find((s) => s.id === 'finance');
    const billing = finance?.groups
      .flatMap((g) => g.entries)
      .find((e) => e.id === 'billing');
    expect(billing?.unavailableReason).toBe(FLAG_OFF_REASON);
    expect(tree[0]?.entries.find((e) => e.id === 'home')?.current).toBe(true);
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

  it('resolves the Enterprise Blueprint registry entry and its breadcrumbs', () => {
    const route = matchRoute('/enterprise/blueprint');
    expect(route?.id).toBe('enterprise.blueprint');
    expect(route?.permission).toBe('org:read');
    expect(breadcrumbTrail(route!)).toEqual([
      { label: 'Home', href: '/' },
      { label: 'Enterprise Blueprint', href: '/enterprise/blueprint' },
    ]);
  });

  it('matches /home as an alias, specific routes before parameterised ones, and unknown sub-paths to their area', () => {
    expect(matchRoute('/home')?.id).toBe('home');
    expect(matchRoute('/roof/new')?.id).toBe('roof.new');
    expect(matchRoute('/roof/orders/123')?.id).toBe('roof.order');
    expect(matchRoute('/settings/notifications/')?.id).toBe('settings.notifications');
    expect(matchRoute('/jobs/board/extra/deep')?.id).toBe('jobs');
    expect(matchRoute('/bidding')?.id).toBe('bidding');
    expect(matchRoute('/lawn')?.id).toBe('lawn');
    expect(matchRoute('/settings/connectors')?.id).toBe('settings.connectors');
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
