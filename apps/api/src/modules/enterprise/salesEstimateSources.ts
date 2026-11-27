import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { studioHouses } from '../../db/schema/homeBuilder';
import { salesOptions } from '../../db/schema/homeSales';
import { landLots } from '../../db/schema/landManagement';
import { organizations } from '../../db/schema/orgs';
import { priceBookRevisions, priceBooks } from '../../db/schema/pricebooks';
import { problem } from '../../http/problem';

export async function companyPricing(tx: Tx, orgId: string) {
  const [profile] = await tx
    .select({
      currency: organizations.currency,
      effectiveOn: sql<string>`(now() at time zone case when exists (
      select 1 from pg_catalog.pg_timezone_names where name = ${organizations.timezone}
    ) then ${organizations.timezone} else 'UTC' end)::date::text`,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!profile) throw problem('not_found');
  return profile;
}

export function pickPlans(tx: Tx, orgId: string) {
  return tx
    .select({ id: studioHouses.id, name: studioHouses.name, revision: studioHouses.revision })
    .from(studioHouses)
    .where(and(eq(studioHouses.orgId, orgId), isNull(studioHouses.deletedAt)))
    .orderBy(asc(studioHouses.name), asc(studioHouses.id));
}

export async function pickLots(tx: Tx, orgId: string, communityId: string | null) {
  const found = await tx
    .select({
      id: landLots.id,
      communityId: landLots.communityId,
      lotNumber: landLots.lotNumber,
      status: landLots.status,
      contractId: landLots.contractId,
      priceMinor: landLots.priceMinor,
      currency: landLots.currency,
    })
    .from(landLots)
    .where(
      and(
        eq(landLots.orgId, orgId),
        communityId ? eq(landLots.communityId, communityId) : undefined,
      ),
    )
    .orderBy(asc(landLots.lotNumber), asc(landLots.id));
  return found.map(({ priceMinor, currency, ...lot }) => ({
    ...lot,
    listedPrice: { currency, amountMinor: priceMinor },
  }));
}

export async function pickOptions(tx: Tx, orgId: string) {
  const found = await tx
    .select({
      id: salesOptions.id,
      name: salesOptions.name,
      category: salesOptions.category,
      priceMinor: salesOptions.priceMinor,
      currency: salesOptions.currency,
    })
    .from(salesOptions)
    .where(and(eq(salesOptions.orgId, orgId), eq(salesOptions.active, true)))
    .orderBy(asc(salesOptions.name), asc(salesOptions.id));
  return found.map(({ priceMinor, currency, ...option }) => ({
    ...option,
    price: { currency, amountMinor: priceMinor },
  }));
}

export function pickCatalogs(tx: Tx, orgId: string, effectiveOn: string) {
  return tx
    .select({
      id: priceBooks.id,
      name: priceBooks.name,
      revisionId: priceBookRevisions.id,
      revisionNumber: priceBookRevisions.revisionNumber,
      effectiveFrom: priceBookRevisions.effectiveFrom,
      currency: priceBooks.currency,
    })
    .from(priceBookRevisions)
    .innerJoin(
      priceBooks,
      and(
        eq(priceBooks.orgId, priceBookRevisions.orgId),
        eq(priceBooks.id, priceBookRevisions.priceBookId),
        eq(priceBooks.status, 'active'),
        eq(priceBooks.isSynthetic, false),
      ),
    )
    .where(
      and(
        eq(priceBookRevisions.orgId, orgId),
        eq(priceBookRevisions.status, 'approved'),
        sql`(${priceBookRevisions.effectiveFrom} is null or ${priceBookRevisions.effectiveFrom} <= ${effectiveOn}::date)`,
        sql`(${priceBookRevisions.effectiveTo} is null or ${priceBookRevisions.effectiveTo} >= ${effectiveOn}::date)`,
      ),
    )
    .orderBy(asc(priceBooks.name), desc(priceBookRevisions.revisionNumber));
}
