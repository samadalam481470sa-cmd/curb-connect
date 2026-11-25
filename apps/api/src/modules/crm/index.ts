// `crm` module: manual customers and contacts (SupplyPro GM core).
//
// The `customers`/`contacts` tables already exist in src/db/schema/crm.ts, but this
// module was a stub with no routes: a customer could only appear via invoice
// auto-creation. These routes let a contractor create a real customer and its contacts
// by hand, so a manually created job can attach to a real customer (jobs.customerId /
// jobs.contactId). Tenant-scoped, soft-delete aware, audited. No fake data: a customer
// only exists because someone in the company created it.
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contacts, customers } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  CreateContactSchema,
  CreateCustomerSchema,
  UpdateContactSchema,
  UpdateCustomerSchema,
  contactDto,
  customerDto,
} from './customers';

const UUID = z.uuid();
const Id = z.object({ id: UUID });

const notDeleted = (table: typeof customers | typeof contacts) =>
  sql`${table.deletedAt} IS NULL`;

async function clearOtherPrimaries(
  tx: Tx,
  orgId: string,
  customerId: string,
  exceptId?: string,
): Promise<void> {
  await tx
    .update(contacts)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(contacts.orgId, orgId),
        eq(contacts.customerId, customerId),
        sql`${contacts.deletedAt} IS NULL`,
        exceptId ? sql`${contacts.id} <> ${exceptId}` : sql`TRUE`,
      ),
    );
}

const crmModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/customers',
    {
      config: { permission: 'customer:read' },
      schema: { tags: ['customers'], summary: 'Customers created by this company' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(customers)
          .where(and(eq(customers.orgId, orgId), notDeleted(customers)))
          .orderBy(desc(customers.createdAt))
          .limit(200),
      );
      return { items: rows.map(customerDto) };
    },
  );

  app.post(
    '/customers',
    {
      config: { permission: 'customer:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['customers'], body: CreateCustomerSchema, summary: 'Create a customer by hand' },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [created] = await tx
          .insert(customers)
          .values({
            orgId,
            kind: request.body.kind,
            displayName: request.body.displayName,
            companyName: request.body.companyName ?? null,
            billingAddress: request.body.billingAddress ?? null,
            tags: request.body.tags ?? [],
            externalRef: request.body.externalRef ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'customer.created',
          resourceType: 'customer',
          resourceId: created.id,
          after: { displayName: created.displayName, kind: created.kind },
        });
        return created;
      });
      reply.code(201);
      return customerDto(row);
    },
  );

  app.get(
    '/customers/:id',
    {
      config: { permission: 'customer:read' },
      schema: { tags: ['customers'], params: Id, summary: 'One customer with its contacts' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(customers)
          .where(
            and(eq(customers.orgId, orgId), eq(customers.id, request.params.id), notDeleted(customers)),
          );
        if (!row) throw problem('not_found');
        const contactRows = await tx
          .select()
          .from(contacts)
          .where(
            and(eq(contacts.orgId, orgId), eq(contacts.customerId, row.id), notDeleted(contacts)),
          )
          .orderBy(desc(contacts.isPrimary), desc(contacts.createdAt));
        return { customer: customerDto(row), contacts: contactRows.map(contactDto) };
      });
      return result;
    },
  );

  app.patch(
    '/customers/:id',
    {
      config: { permission: 'customer:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['customers'], params: Id, body: UpdateCustomerSchema, summary: 'Update a customer' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(customers)
          .where(
            and(eq(customers.orgId, orgId), eq(customers.id, request.params.id), notDeleted(customers)),
          );
        if (!current) throw problem('not_found');
        const [updated] = await tx
          .update(customers)
          .set({
            ...request.body,
            revision: sql`${customers.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, current.id))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'customer.updated',
          resourceType: 'customer',
          resourceId: updated.id,
        });
        return updated;
      });
      return customerDto(row);
    },
  );

  app.post(
    '/customers/:id/contacts',
    {
      config: { permission: 'customer:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['customers'], params: Id, body: CreateContactSchema, summary: 'Add a contact to a customer' },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [owner] = await tx
          .select()
          .from(customers)
          .where(
            and(eq(customers.orgId, orgId), eq(customers.id, request.params.id), notDeleted(customers)),
          );
        if (!owner) throw problem('not_found');
        if (request.body.isPrimary) {
          await clearOtherPrimaries(tx, orgId, owner.id);
        }
        const [created] = await tx
          .insert(contacts)
          .values({
            orgId,
            customerId: owner.id,
            firstName: request.body.firstName ?? null,
            lastName: request.body.lastName ?? null,
            displayName: request.body.displayName,
            email: request.body.email ?? null,
            phone: request.body.phone ?? null,
            role: request.body.role ?? null,
            isPrimary: request.body.isPrimary,
            preferredChannel: request.body.preferredChannel ?? null,
          })
          .returning();
        if (!created) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'customer.contact_created',
          resourceType: 'contact',
          resourceId: created.id,
          after: { customerId: owner.id, displayName: created.displayName },
        });
        return created;
      });
      reply.code(201);
      return contactDto(row);
    },
  );

  app.get(
    '/contacts/:id',
    {
      config: { permission: 'customer:read' },
      schema: { tags: ['customers'], params: Id, summary: 'One contact' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const [row] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(contacts)
          .where(
            and(eq(contacts.orgId, orgId), eq(contacts.id, request.params.id), notDeleted(contacts)),
          ),
      );
      if (!row) throw problem('not_found');
      return contactDto(row);
    },
  );

  app.patch(
    '/contacts/:id',
    {
      config: { permission: 'customer:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['customers'], params: Id, body: UpdateContactSchema, summary: 'Update a contact' },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(contacts)
          .where(
            and(eq(contacts.orgId, orgId), eq(contacts.id, request.params.id), notDeleted(contacts)),
          );
        if (!current) throw problem('not_found');
        if (request.body.isPrimary && current.customerId) {
          await clearOtherPrimaries(tx, orgId, current.customerId, current.id);
        }
        const [updated] = await tx
          .update(contacts)
          .set({
            ...request.body,
            revision: sql`${contacts.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(contacts.id, current.id))
          .returning();
        if (!updated) throw problem('internal');
        await auditRequest(request, tx, {
          orgId,
          action: 'customer.contact_updated',
          resourceType: 'contact',
          resourceId: updated.id,
        });
        return updated;
      });
      return contactDto(row);
    },
  );
};

export default crmModule;
