// PLT-011 navigation tree: the collapsible section grouping over the same visible items as
// visibleNavigation. Grouping must never hide, reorder (within navOrder) or invent items, and
// sections a role cannot use at all must not render as empty headers.
import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import { MEMBER_ROLES, type MemberRole } from './enums';
import { permissionsFor, type Action } from './rbac';
import { NAV_SECTIONS, navigationTree, visibleNavigation } from './routes';

function treeFor(role: MemberRole, flags: Record<string, boolean> = {}) {
  const allowed = new Set<Action>(permissionsFor(role));
  return navigationTree(
    (a) => allowed.has(a),
    (f) => flags[f] ?? true,
  );
}

function flatIds(role: MemberRole, flags: Record<string, boolean> = {}): string[] {
  const allowed = new Set<Action>(permissionsFor(role));
  return visibleNavigation(
    (a) => allowed.has(a),
    (f) => flags[f] ?? true,
  ).map((i) => i.route.id);
}

describe('navigation tree (PLT-011)', () => {
  it('PLT-011-TREE: top-level group keeps Home, Roof Measurements and Curb Cutting adjacent, in order, for every role', () => {
    for (const role of MEMBER_ROLES) {
      const tree = treeFor(role);
      expect(tree[0]?.id).toBe('top');
      expect(tree[0]?.label).toBeNull();
      expect(tree[0]?.items.map((i) => i.route.label)).toEqual([
        'Home',
        BRAND.products.roof,
        BRAND.products.curb,
      ]);
    }
  });

  it('PLT-011-TREE: the tree contains exactly the visible items (grouping hides and invents nothing)', () => {
    for (const role of MEMBER_ROLES) {
      const inTree = treeFor(role).flatMap((s) => [
        ...s.items.map((i) => i.route.id),
        ...s.groups.flatMap((g) => g.items.map((i) => i.route.id)),
      ]);
      expect([...inTree].sort()).toEqual([...flatIds(role)].sort());
    }
  });

  it('PLT-011-TREE: sections render in NAV_SECTIONS order and never empty', () => {
    const tree = treeFor('owner');
    const sectionIds = tree.filter((s) => s.label !== null).map((s) => s.id);
    expect(sectionIds).toEqual(NAV_SECTIONS.map((s) => s.id));
    for (const section of tree) {
      const count =
        section.items.length + section.groups.reduce((n, g) => n + g.items.length, 0);
      expect(count).toBeGreaterThan(0);
      for (const group of section.groups) expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it('PLT-015-TREE: sections a role cannot open are dropped, not shown empty (crew manager has no Finance)', () => {
    const tree = treeFor('crew_manager');
    expect(tree.map((s) => s.id)).not.toContain('finance');
    const allIds = tree.flatMap((s) => [
      ...s.items.map((i) => i.route.id),
      ...s.groups.flatMap((g) => g.items.map((i) => i.route.id)),
    ]);
    expect(allIds).not.toContain('billing');
    expect(allIds).not.toContain('reports');
    expect(allIds).toContain('jobs');
  });

  it('PLT-011-TREE: subsections group their routes (Operations → Scheduling holds Crew Board + Project Management)', () => {
    const tree = treeFor('owner');
    const operations = tree.find((s) => s.id === 'operations');
    const scheduling = operations?.groups.find((g) => g.id === 'scheduling');
    expect(scheduling?.items.map((i) => i.route.id)).toEqual(['crewBoard', 'projectManagement']);
    const finance = tree.find((s) => s.id === 'finance');
    expect(finance?.groups.find((g) => g.id === 'money-out')?.items.map((i) => i.route.id)).toEqual(
      ['jobCost', 'payables'],
    );
  });

  it('PLT-020-TREE: a flag-off route stays in its section as unavailable', () => {
    const tree = treeFor('owner', { 'billing.invoices': false });
    const finance = tree.find((s) => s.id === 'finance');
    const billing = finance?.groups
      .flatMap((g) => g.items)
      .find((i) => i.route.id === 'billing');
    expect(billing?.availability).toBe('unavailable');
  });
});
