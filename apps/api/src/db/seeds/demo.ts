// Demo seed: two FICTIONAL companies (a roofer and a curb cutter), one member per role in each,
// fictional properties (no real homeowner address), a synthetic roof order, a synthetic curb
// project, an approved SYNTHETIC price book revision using the page-60 calculator rates, and the
// default pipeline stages. Every id is derived from a stable name, so re-running is a no-op.
import { createHash } from 'node:crypto';
import { DEFAULT_JOB_STAGES, MEMBER_ROLES, type MemberRole } from '@fieldline/contracts';
import { eq, sql } from 'drizzle-orm';
import type { Database } from '../client';
import {
  contacts,
  curbObservations,
  curbProjects,
  customers,
  externalIdentities,
  jobs,
  jobStageDefinitions,
  jurisdictions,
  memberships,
  organizations,
  plans,
  priceBookRevisions,
  priceBooks,
  priceItems,
  properties,
  roofOrderEvents,
  roofOrders,
  roofReports,
  roofReportVersions,
  structures,
  users,
} from '../schema';

/** Deterministic UUID (v5-shaped) from a seed name. */
export function seedId(name: string): string {
  const h = createHash('sha1').update(`fieldline-seed:${name}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const DEMO_ORGS = {
  roof: {
    id: seedId('org:roof'),
    slug: 'demo-summit-ridge-roofing',
    legalName: 'Summit Ridge Roofing Demo Co. (fictional)',
    displayName: 'Summit Ridge Roofing (Demo)',
    productLines: ['roof'] as const,
  },
  curb: {
    id: seedId('org:curb'),
    slug: 'demo-bluestone-curb-works',
    legalName: 'Bluestone Curb Works Demo LLC (fictional)',
    displayName: 'Bluestone Curb Works (Demo)',
    productLines: ['curb'] as const,
  },
} as const;

export const DEV_IDP_ISSUER = process.env.DEV_IDP_ISSUER ?? 'http://localhost:4100';
type OrgKey = keyof typeof DEMO_ORGS;

export function demoUserId(org: OrgKey, role: MemberRole): string {
  return seedId(`user:${org}:${role}`);
}

async function seedOrganizations(db: Database) {
  for (const o of Object.values(DEMO_ORGS)) {
    await db
      .insert(organizations)
      .values({ ...o, productLines: [...o.productLines], isDemo: true })
      .onConflictDoNothing();
  }
}

async function seedPeople(db: Database) {
  for (const org of Object.keys(DEMO_ORGS) as OrgKey[]) {
    for (const role of MEMBER_ROLES) {
      const id = demoUserId(org, role);
      const subject = `demo-${org}-${role}`;
      await db
        .insert(users)
        .values({
          id,
          displayName: `Demo ${org === 'roof' ? 'Roof' : 'Curb'} ${role.replace('_', ' ')}`,
          email: `${subject}@example.test`,
        })
        .onConflictDoNothing();
      await db
        .insert(externalIdentities)
        .values({ id: seedId(`identity:${subject}`), userId: id, provider: 'dev_idp', issuer: DEV_IDP_ISSUER, subject })
        .onConflictDoNothing();
      await db
        .insert(memberships)
        .values({ id: seedId(`membership:${org}:${role}`), orgId: DEMO_ORGS[org].id, userId: id, role })
        .onConflictDoNothing();
    }
  }
}

async function seedStages(db: Database) {
  for (const org of Object.values(DEMO_ORGS)) {
    for (const s of DEFAULT_JOB_STAGES) {
      await db
        .insert(jobStageDefinitions)
        .values({
          id: seedId(`stage:${org.id}:${s.key}`),
          orgId: org.id,
          key: s.key,
          label: s.label,
          category: s.category,
          sortOrder: s.position,
          allowedNext: [...s.allowedNext],
        })
        .onConflictDoNothing();
    }
  }
}

const FICTIONAL_JURISDICTION_ID = seedId('jurisdiction:fictional');

async function seedReference(db: Database) {
  await db
    .insert(jurisdictions)
    .values({
      id: FICTIONAL_JURISDICTION_ID,
      code: 'SYN-FICTIONVILLE',
      name: 'City of Fictionville (synthetic)',
      kind: 'city',
      status: 'draft',
      region: 'ZZ',
      rulesVersion: 'synthetic-1',
      rules: { note: 'Synthetic test rules. Not a real municipal requirement.', curbCutPermit: 'required' },
      isSynthetic: true,
    })
    .onConflictDoNothing();
  await db
    .insert(plans)
    .values({
      id: seedId('plan:demo'),
      code: 'demo_monthly',
      name: 'Demo plan (synthetic)',
      interval: 'month',
      priceMinor: 0,
      includedUsage: { roof_report: 25, curb_ai_analysis: 50, pdf_export: 100 },
    })
    .onConflictDoNothing();
}

async function seedCustomerAndProperty(db: Database, org: OrgKey, n: number) {
  const orgId = DEMO_ORGS[org].id;
  const customerId = seedId(`customer:${org}`);
  const contactId = seedId(`contact:${org}`);
  const propertyId = seedId(`property:${org}`);
  await db
    .insert(customers)
    .values({ id: customerId, orgId, displayName: `Pat Example (fictional ${org} customer)` })
    .onConflictDoNothing();
  await db
    .insert(contacts)
    .values({
      id: contactId,
      orgId,
      customerId,
      firstName: 'Pat',
      lastName: 'Example',
      displayName: 'Pat Example',
      email: `pat.example.${org}@example.test`,
      phone: '+1-555-0100',
      isPrimary: true,
    })
    .onConflictDoNothing();
  // Clearly fictional address in a fictional city; coordinates are near 0,0 on purpose.
  await db
    .insert(properties)
    .values({
      id: propertyId,
      orgId,
      label: 'Demo property (fictional)',
      originalQuery: `${n} Example Lane, Fictionville, ZZ 00000`,
      line1: `${n} Example Lane`,
      locality: 'Fictionville',
      region: 'ZZ',
      postalCode: '00000',
      normalizedAddress: `${n} EXAMPLE LN, FICTIONVILLE, ZZ 00000`,
      geocoderProvider: 'fixture',
      geocoderPlaceId: `fixture:${org}:${n}`,
      geocodeConfidence: '0.950',
      location: `SRID=4326;POINT(0.00${n} 0.00${n})`,
      jurisdictionId: FICTIONAL_JURISDICTION_ID,
      isFictional: true,
    })
    .onConflictDoNothing();
  return { orgId, customerId, contactId, propertyId };
}

async function seedRoof(db: Database) {
  const { orgId, customerId, contactId, propertyId } = await seedCustomerAndProperty(db, 'roof', 100);
  const structureId = seedId('structure:roof:main');
  const jobId = seedId('job:roof');
  const orderId = seedId('roof-order:1');
  const reportId = seedId('roof-report:1');
  await db
    .insert(structures)
    .values({ id: structureId, orgId, propertyId, label: 'Main house', kind: 'main_house' })
    .onConflictDoNothing();
  await db
    .insert(jobs)
    .values({
      id: jobId,
      orgId,
      number: 'J-DEMO-0001',
      title: 'Synthetic roof replacement (demo)',
      productLine: 'roof',
      stageKey: 'measuring',
      customerId,
      contactId,
      propertyId,
      ownerMembershipId: seedId('membership:roof:salesperson'),
    })
    .onConflictDoNothing();
  const inserted = await db
    .insert(roofOrders)
    .values({
      id: orderId,
      orgId,
      number: 'RO-DEMO-0001',
      propertyId,
      jobId,
      mode: 'assisted',
      deliverySpeed: 'standard',
      status: 'ordered',
      structureIds: [structureId],
      requestedByMembershipId: seedId('membership:roof:estimator'),
      instructions: 'Synthetic demo order. Main house only.',
    })
    .onConflictDoNothing()
    .returning({ id: roofOrders.id });
  if (inserted.length > 0) {
    await db.insert(roofOrderEvents).values([
      { orgId, roofOrderId: orderId, fromStatus: null, toStatus: 'draft', actorType: 'system', reason: 'seed' },
      { orgId, roofOrderId: orderId, fromStatus: 'draft', toStatus: 'ordered', actorType: 'system', reason: 'seed' },
    ]);
  }
  await db
    .insert(roofReports)
    .values({ id: reportId, orgId, roofOrderId: orderId, structureId })
    .onConflictDoNothing();
  await db
    .insert(roofReportVersions)
    .values({ id: seedId('roof-report-version:1:1'), orgId, roofReportId: reportId, versionNumber: 1 })
    .onConflictDoNothing();
}

async function seedCurb(db: Database) {
  const { orgId, customerId, contactId, propertyId } = await seedCustomerAndProperty(db, 'curb', 200);
  const jobId = seedId('job:curb');
  const projectId = seedId('curb-project:1');
  await db
    .insert(jobs)
    .values({
      id: jobId,
      orgId,
      number: 'J-DEMO-0001',
      title: 'Synthetic driveway opening (demo)',
      productLine: 'curb',
      stageKey: 'estimating',
      customerId,
      contactId,
      propertyId,
    })
    .onConflictDoNothing();
  await db
    .insert(curbProjects)
    .values({
      id: projectId,
      orgId,
      number: 'CP-DEMO-0001',
      propertyId,
      jobId,
      customerId,
      contactId,
      serviceCode: 'driveway_opening',
      status: 'intake',
      jurisdictionId: FICTIONAL_JURISDICTION_ID,
      jurisdictionRulesVersion: 'synthetic-1',
      curbProfile: 'curb_and_gutter',
      description: 'Page-60 synthetic example: 18 ft cut line, two saw passes.',
    })
    .onConflictDoNothing();
  const answers = [
    { questionKey: 'cut_length', state: 'known', valueNumber: '5.486400', unit: 'm', source: 'user_entered' },
    { questionKey: 'saw_pass_count', state: 'known', valueNumber: '2', unit: 'count', source: 'user_entered' },
    { questionKey: 'utility_locations', state: 'unknown', unknownReason: 'not_provided' },
  ] as const;
  for (const a of answers) {
    await db
      .insert(curbObservations)
      .values({ id: seedId(`curb-obs:1:${a.questionKey}`), orgId, curbProjectId: projectId, ...a })
      .onConflictDoNothing();
  }
}

/** Page 060 synthetic calculator fixture. NOT market pricing. */
export const PAGE_60_PRICE_ITEMS = [
  { code: 'CUT_LF', label: 'Saw cutting', category: 'labor', costComponent: 'cutting', unit: 'linear_ft', unitRate: '20.000000' },
  { code: 'MOBILIZATION', label: 'Mobilization', category: 'mobilization', costComponent: 'mobilization', unit: 'lump_sum', fixedAmountMinor: 40000 },
  { code: 'BREAKOUT_LF', label: 'Breakout', category: 'labor', costComponent: 'demolition', unit: 'linear_ft', unitRate: '28.000000' },
  { code: 'DISPOSAL', label: 'Haul-off and disposal', category: 'disposal', costComponent: 'disposal', unit: 'lump_sum', fixedAmountMinor: 22000 },
  { code: 'REPLACE_LF', label: 'Concrete replacement', category: 'material', costComponent: 'restoration', unit: 'linear_ft', unitRate: '95.000000' },
  { code: 'TRAFFIC', label: 'Traffic control', category: 'traffic_control', costComponent: 'traffic', unit: 'lump_sum', fixedAmountMinor: 35000 },
  { code: 'PERMIT_ALLOWANCE', label: 'Permit allowance', category: 'allowance', costComponent: 'permits', unit: 'lump_sum', fixedAmountMinor: 20000 },
] as const;

async function seedPriceBook(db: Database) {
  const orgId = DEMO_ORGS.curb.id;
  const bookId = seedId('price-book:curb');
  const revisionId = seedId('price-book-revision:curb:1');
  await db
    .insert(priceBooks)
    .values({ id: bookId, orgId, name: 'Synthetic curb rates (page 60)', productLine: 'curb', isSynthetic: true })
    .onConflictDoNothing();
  const existing = await db
    .select({ id: priceBookRevisions.id })
    .from(priceBookRevisions)
    .where(eq(priceBookRevisions.id, revisionId));
  if (existing.length > 0) return; // already seeded (and approved revisions are immutable)
  await db.transaction(async (tx) => {
    await tx.insert(priceBookRevisions).values({
      id: revisionId,
      orgId,
      priceBookId: bookId,
      revisionNumber: 1,
      status: 'draft',
      effectiveFrom: '2026-01-01',
      overheadRate: '0.100000',
      contingencyRate: '0',
      marginStrategy: 'target_margin',
      marginRate: '0.250000',
      taxRate: '0',
      notes: 'Synthetic test inputs from blueprint page 60. Never a regional market quote.',
    });
    await tx.insert(priceItems).values(
      PAGE_60_PRICE_ITEMS.map((item, i) => ({
        id: seedId(`price-item:curb:1:${item.code}`),
        orgId,
        priceBookRevisionId: revisionId,
        sortOrder: i,
        taxable: false,
        ...item,
      })),
    );
    await tx
      .update(priceBookRevisions)
      .set({ status: 'approved', approvedAt: sql`now()`, approvedByUserId: demoUserId('curb', 'owner') })
      .where(eq(priceBookRevisions.id, revisionId));
  });
}

export const demoSeedSteps = [
  { name: 'demo organizations', run: seedOrganizations },
  { name: 'demo users, identities and memberships (every role)', run: seedPeople },
  { name: 'default pipeline stages', run: seedStages },
  { name: 'synthetic jurisdiction and plan', run: seedReference },
  { name: 'synthetic roof order', run: seedRoof },
  { name: 'synthetic curb project', run: seedCurb },
  { name: 'approved synthetic price book (page 60 rates)', run: seedPriceBook },
];
