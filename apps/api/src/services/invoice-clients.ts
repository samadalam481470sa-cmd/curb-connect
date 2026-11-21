// Saved invoice clients. Every Bill To client and every imported client is kept in the customers
// table, so the Bill To picker, Billing and other tools all see the same list.
import type { InvoiceParty } from '@fieldline/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/runtime';
import { customers } from '../db/schema';

/** Finds the client by name (any letter case) or adds it. Fills in details it did not have. */
export async function upsertInvoiceClient(
  tx: Tx,
  orgId: string,
  party: InvoiceParty,
): Promise<string> {
  const name = party.name.trim().slice(0, 200);
  const [existing] = await tx
    .select({ id: customers.id, billingAddress: customers.billingAddress })
    .from(customers)
    .where(
      and(
        eq(customers.orgId, orgId),
        isNull(customers.deletedAt),
        eq(customers.status, 'active'),
        sql`lower(${customers.displayName}) = lower(${name})`,
      ),
    )
    .limit(1);
  const clean = Object.fromEntries(
    Object.entries(party).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
  ) as InvoiceParty;
  if (existing) {
    const before = (existing.billingAddress ?? {}) as Record<string, unknown>;
    await tx
      .update(customers)
      .set({ billingAddress: { ...before, ...clean, name }, updatedAt: new Date() })
      .where(eq(customers.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(customers)
    .values({ orgId, kind: 'person', displayName: name, billingAddress: { ...clean, name } })
    .returning({ id: customers.id });
  return created!.id;
}
