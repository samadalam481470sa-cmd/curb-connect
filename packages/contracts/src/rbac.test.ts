import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  can,
  canWithOverrides,
  MEMBER_ROLES,
  permissionsFor,
  POLICY,
  PRIMARY_ROUTES,
  ROUTES,
  visibleNavigation,
  isAction,
  BRAND_NAME,
  FEATURE_FLAG_KEYS,
  isFeatureFlagKey,
  resolveFlag,
  requirementId,
  parseRequirementId,
  baseRequirementId,
} from './index';

describe('RBAC policy matrix', () => {
  it('lists only known roles for every action', () => {
    for (const action of ACTIONS) {
      for (const role of POLICY[action]) expect(MEMBER_ROLES).toContain(role);
    }
  });

  it('owner can do everything; read_only cannot write', () => {
    for (const action of ACTIONS) expect(can('owner', action)).toBe(true);
    for (const action of permissionsFor('read_only')) {
      expect(action).toMatch(/:read(_own)?$|:update_preferences$/);
    }
  });

  it('can() is a pure lookup', () => {
    expect(can('finance', 'dashboard:read')).toBe(true);
    expect(can('read_only', 'team:invite')).toBe(false);
    expect(isAction('nope:nothing')).toBe(false);
  });

  it('deny overrides win, except owner-protected actions', () => {
    expect(canWithOverrides('admin', 'team:invite', [{ action: 'team:invite', effect: 'deny' }])).toBe(false);
    expect(canWithOverrides('owner', 'team:invite', [{ action: 'team:invite', effect: 'deny' }])).toBe(true);
    expect(
      canWithOverrides('read_only', 'team:invite', [{ action: 'team:invite', effect: 'grant', expiresAt: '2000-01-01T00:00:00Z' }]),
    ).toBe(false);
  });
});

describe('route registry (PLT-011)', () => {
  it('has the ten primary areas with permissions and analytics names', () => {
    expect(PRIMARY_ROUTES.map((r) => r.label)).toEqual([
      'Home',
      'Roof Measurements',
      'Curb Cutting',
      'Leads',
      'Jobs',
      'Proposals',
      'Billing',
      'Reports',
      'Team',
      'Settings',
    ]);
    const paths = new Set<string>();
    for (const r of ROUTES) {
      expect(isAction(r.permission)).toBe(true);
      expect(r.analyticsEvent).toMatch(/^[a-z_]+$/);
      expect(paths.has(r.path)).toBe(false);
      paths.add(r.path);
    }
  });

  it('navigation hides routes the role cannot open', () => {
    const nav = visibleNavigation((a) => can('read_only', a));
    expect(nav.every((n) => can('read_only', n.route.permission))).toBe(true);
  });
});

describe('brand, flags, requirement ids', () => {
  it('BRAND_NAME is Field Pro', () => expect(BRAND_NAME).toBe('Field Pro'));

  it('flag resolution prefers the most specific override', () => {
    expect(FEATURE_FLAG_KEYS.length).toBeGreaterThan(5);
    expect(isFeatureFlagKey('curb.ai_measurement')).toBe(true);
    const overrides = [
      { key: 'curb.ai_measurement' as const, enabled: true },
      { key: 'curb.ai_measurement' as const, enabled: false, orgId: 'o1' },
      { key: 'curb.ai_measurement' as const, enabled: true, orgId: 'o1', jurisdictionId: 'j1' },
    ];
    expect(resolveFlag('curb.ai_measurement', [])).toBe(false);
    expect(resolveFlag('curb.ai_measurement', overrides, { orgId: 'o2' })).toBe(true);
    expect(resolveFlag('curb.ai_measurement', overrides, { orgId: 'o1' })).toBe(false);
    expect(resolveFlag('curb.ai_measurement', overrides, { orgId: 'o1', jurisdictionId: 'j1' })).toBe(true);
  });

  it('builds and parses requirement ids', () => {
    expect(requirementId('CP', 52, 'API')).toBe('CP-052-API');
    expect(parseRequirementId('CV-045-FE')).toEqual({ area: 'CV', page: 45, layer: 'FE' });
    expect(parseRequirementId('XX-1')).toBeNull();
    expect(baseRequirementId('RR-037-DB')).toBe('RR-037');
  });
});
