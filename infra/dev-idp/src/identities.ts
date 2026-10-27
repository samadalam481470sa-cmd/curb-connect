// Seeded, FICTIONAL test identities for the stand-in provider. DEVELOPMENT ONLY.
//
// Subjects and emails match the demo seed in apps/api/src/db/seeds/demo.ts
// (`demo-<org>-<role>`, `<subject>@example.test`), so signing in as one of these lands on the
// seeded demo user with its membership. The provider only authenticates; companies and roles live
// in the API's database, never in token claims (PLT-013 D).

export interface DevIdentity {
  /** OIDC `sub`. Stable: the API keys users on (issuer, sub). */
  sub: string;
  email: string;
  name: string;
  /** Shown on the login screen only, to help pick the right test person. */
  companyLabel: string;
  roleLabel: string;
}

export const DEV_IDENTITIES: readonly DevIdentity[] = [
  {
    sub: 'demo-roof-owner',
    email: 'demo-roof-owner@example.test',
    name: 'Demo Roof owner',
    companyLabel: 'Company A: Summit Ridge Roofing (Demo)',
    roleLabel: 'Owner',
  },
  {
    sub: 'demo-roof-reviewer',
    email: 'demo-roof-reviewer@example.test',
    name: 'Demo Roof reviewer',
    companyLabel: 'Company A: Summit Ridge Roofing (Demo)',
    roleLabel: 'Reviewer',
  },
  {
    sub: 'demo-roof-estimator',
    email: 'demo-roof-estimator@example.test',
    name: 'Demo Roof estimator',
    companyLabel: 'Company A: Summit Ridge Roofing (Demo)',
    roleLabel: 'Estimator',
  },
  {
    sub: 'demo-curb-owner',
    email: 'demo-curb-owner@example.test',
    name: 'Demo Curb owner',
    companyLabel: 'Company B: Bluestone Curb Works (Demo)',
    roleLabel: 'Owner',
  },
];

export function findIdentity(sub: string): DevIdentity | undefined {
  return DEV_IDENTITIES.find((identity) => identity.sub === sub);
}
