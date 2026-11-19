/**
 * `crm` module: customers, contacts and leads (OPS-061). Org-scoped via RLS + requireOrg.
 */
import {
  ContactListSchema,
  ContactSchema,
  CreateContactRequestSchema,
  CreateCustomerRequestSchema,
  CreateLeadRequestSchema,
  CustomerListSchema,
  CustomerSchema,
  LeadListSchema,
  LeadSchema,
  PageQuerySchema,
  PostalAddressSchema,
  UpdateCustomerRequestSchema,
  UpdateLeadRequestSchema,
  UuidSchema,
  type PostalAddress,
} from '@fieldline/contracts';
import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contacts, customers, leads } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';

const IdParams = z.object({ id: UuidSchema });
const IfMatchHeaders = z.object({ 'if-match': z.string().optional() }).loose();
const SearchQuery = PageQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
});

type CustomerRow = typeof customers.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type LeadRow = typeof leads.$inferSelect;

function parseBillingAddress(raw: unknown): PostalAddress | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = PostalAddressSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function customerDto(row: CustomerRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    kind: row.kind,
    displayName: row.displayName,
    companyName: row.companyName,
    status: row.status,
    billingAddress: parseBillingAddress(row.billingAddress),
    tags: row.tags ?? [],
  };
}

function contactDto(row: ContactRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerId: row.customerId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isPrimary: row.isPrimary,
  };
}

function leadDto(row: LeadRow) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source,
    status: row.status,
    productLine: row.productLine,
    customerId: row.customerId,
    contactId: row.contactId,
    propertyId: row.propertyId,
    assignedMembershipId: row.assignedMembershipId,
    summary: row.summary,
    estimatedValue:
      row.estimatedValueMinor != null
        ? { amountMinor: row.estimatedValueMinor, currency: 'USD' }
        : null,
    possibleDuplicateOf: [] as string[],
  };
}

async function getCustomer(tx: Tx, orgId: string, id: string) {
  const [row] = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), eq(customers.id, id), isNull(customers.deletedAt)));
  return row ?? null;
}

const crmModule: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ customers
  app.post(
    '/customers',
    {
      config: { permission: 'customer:write' },
      schema: {
        tags: ['crm'],
        summary: 'Create a customer',
        body: CreateCustomerRequestSchema,
        response: { 201: CustomerSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(customers)
          .values({
            orgId: org.orgId,
            kind: body.kind,
            displayName: body.displayName,
            companyName: body.companyName ?? null,
            billingAddress: body.billingAddress ?? null,
            tags: body.tags ?? [],
          })
          .returning();
        const out = customerDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'customer.created',
          resourceType: 'customer',
          resourceId: row!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/customers',
    {
      config: { permission: 'customer:read' },
      schema: {
        tags: ['crm'],
        summary: 'List customers (optional displayName search)',
        querystring: SearchQuery,
        response: { 200: CustomerListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor, q } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(customers)
          .where(
            and(
              eq(customers.orgId, org.orgId),
              isNull(customers.deletedAt),
              q ? ilike(customers.displayName, `%${q.replace(/[%_]/g, '\\$&')}%`) : undefined,
              afterCursor(customers.createdAt, customers.id, after),
            ),
          )
          .orderBy(asc(msTrunc(customers.createdAt)), asc(customers.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.createdAt, id: r.id }),
        customerDto,
      );
    },
  );

  app.get(
    '/customers/:id',
    {
      config: { permission: 'customer:read' },
      schema: {
        tags: ['crm'],
        summary: 'Get a customer',
        params: IdParams,
        response: { 200: CustomerSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, (tx) => getCustomer(tx, org.orgId, request.params.id));
      if (!row) throw problem('not_found');
      setEtag(reply, row.revision);
      return customerDto(row);
    },
  );

  app.patch(
    '/customers/:id',
    {
      config: { permission: 'customer:write' },
      schema: {
        tags: ['crm'],
        summary: 'Update a customer (If-Match)',
        params: IdParams,
        headers: IfMatchHeaders,
        body: UpdateCustomerRequestSchema,
        response: { 200: CustomerSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const current = await getCustomer(tx, org.orgId, request.params.id);
        if (!current) throw problem('not_found');
        assertRevision(current.revision, expected);
        const [row] = await tx
          .update(customers)
          .set({
            ...(body.kind !== undefined && { kind: body.kind }),
            ...(body.displayName !== undefined && { displayName: body.displayName }),
            ...(body.companyName !== undefined && { companyName: body.companyName ?? null }),
            ...(body.billingAddress !== undefined && { billingAddress: body.billingAddress ?? null }),
            ...(body.tags !== undefined && { tags: body.tags }),
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, current.id))
          .returning();
        const before = customerDto(current);
        const after = customerDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'customer.updated',
          resourceType: 'customer',
          resourceId: row!.id,
          before,
          after,
        });
        return after;
      });
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  // ------------------------------------------------------------------ contacts
  app.post(
    '/customers/:id/contacts',
    {
      config: { permission: 'customer:write' },
      schema: {
        tags: ['crm'],
        summary: 'Create a contact under a customer',
        params: IdParams,
        body: CreateContactRequestSchema.omit({ customerId: true }),
        response: { 201: ContactSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const customer = await getCustomer(tx, org.orgId, request.params.id);
        if (!customer) throw problem('not_found');
        if (body.isPrimary) {
          await tx
            .update(contacts)
            .set({ isPrimary: false })
            .where(
              and(
                eq(contacts.orgId, org.orgId),
                eq(contacts.customerId, customer.id),
                eq(contacts.isPrimary, true),
              ),
            );
        }
        const [row] = await tx
          .insert(contacts)
          .values({
            orgId: org.orgId,
            customerId: customer.id,
            firstName: body.firstName ?? null,
            lastName: body.lastName ?? null,
            displayName: body.displayName,
            email: body.email ?? null,
            phone: body.phone ?? null,
            role: body.role ?? null,
            isPrimary: body.isPrimary ?? false,
          })
          .returning();
        const out = contactDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'contact.created',
          resourceType: 'contact',
          resourceId: row!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/customers/:id/contacts',
    {
      config: { permission: 'customer:read' },
      schema: {
        tags: ['crm'],
        summary: 'List contacts for a customer',
        params: IdParams,
        querystring: PageQuerySchema,
        response: { 200: ContactListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, async (tx) => {
        const customer = await getCustomer(tx, org.orgId, request.params.id);
        if (!customer) throw problem('not_found');
        return tx
          .select()
          .from(contacts)
          .where(
            and(
              eq(contacts.orgId, org.orgId),
              eq(contacts.customerId, customer.id),
              isNull(contacts.deletedAt),
              afterCursor(contacts.createdAt, contacts.id, after),
            ),
          )
          .orderBy(asc(msTrunc(contacts.createdAt)), asc(contacts.id))
          .limit(limit + 1);
      });
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.createdAt, id: r.id }),
        contactDto,
      );
    },
  );

  // ------------------------------------------------------------------ leads
  app.post(
    '/leads',
    {
      config: { permission: 'lead:write' },
      schema: {
        tags: ['crm'],
        summary: 'Create a lead',
        body: CreateLeadRequestSchema,
        response: { 201: LeadSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        let contactId = body.contactId ?? null;
        if (!contactId && body.contact) {
          const [c] = await tx
            .insert(contacts)
            .values({
              orgId: org.orgId,
              customerId: body.customerId ?? null,
              firstName: body.contact.firstName ?? null,
              lastName: body.contact.lastName ?? null,
              displayName: body.contact.displayName,
              email: body.contact.email ?? null,
              phone: body.contact.phone ?? null,
              role: body.contact.role ?? null,
              isPrimary: body.contact.isPrimary ?? false,
            })
            .returning({ id: contacts.id });
          contactId = c!.id;
        }
        const [row] = await tx
          .insert(leads)
          .values({
            orgId: org.orgId,
            source: body.source,
            productLine: body.productLine ?? null,
            customerId: body.customerId ?? null,
            contactId,
            propertyId: body.propertyId ?? null,
            summary: body.summary ?? (body.address ? `Address: ${body.address}` : null),
            rawSubmission: body.address ? { address: body.address } : null,
          })
          .returning();
        const out = leadDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'lead.created',
          resourceType: 'lead',
          resourceId: row!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/leads',
    {
      config: { permission: 'lead:read' },
      schema: {
        tags: ['crm'],
        summary: 'List leads (optional summary search)',
        querystring: SearchQuery,
        response: { 200: LeadListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor, q } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(leads)
          .where(
            and(
              eq(leads.orgId, org.orgId),
              isNull(leads.deletedAt),
              q
                ? sql`coalesce(${leads.summary}, '') ilike ${`%${q.replace(/[%_]/g, '\\$&')}%`}`
                : undefined,
              afterCursor(leads.createdAt, leads.id, after),
            ),
          )
          .orderBy(asc(msTrunc(leads.createdAt)), asc(leads.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.createdAt, id: r.id }),
        leadDto,
      );
    },
  );

  app.get(
    '/leads/:id',
    {
      config: { permission: 'lead:read' },
      schema: {
        tags: ['crm'],
        summary: 'Get a lead',
        params: IdParams,
        response: { 200: LeadSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const [row] = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(leads)
          .where(
            and(eq(leads.orgId, org.orgId), eq(leads.id, request.params.id), isNull(leads.deletedAt)),
          ),
      );
      if (!row) throw problem('not_found');
      setEtag(reply, row.revision);
      return leadDto(row);
    },
  );

  app.patch(
    '/leads/:id',
    {
      config: { permission: 'lead:write' },
      schema: {
        tags: ['crm'],
        summary: 'Update a lead (If-Match)',
        params: IdParams,
        headers: IfMatchHeaders,
        body: UpdateLeadRequestSchema,
        response: { 200: LeadSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const [current] = await tx
          .select()
          .from(leads)
          .where(
            and(eq(leads.orgId, org.orgId), eq(leads.id, request.params.id), isNull(leads.deletedAt)),
          )
          .for('update');
        if (!current) throw problem('not_found');
        assertRevision(current.revision, expected);
        const [row] = await tx
          .update(leads)
          .set({
            ...(body.status !== undefined && { status: body.status }),
            ...(body.assignedMembershipId !== undefined && {
              assignedMembershipId: body.assignedMembershipId,
            }),
            ...(body.summary !== undefined && { summary: body.summary }),
            ...(body.disqualifiedReason !== undefined && {
              disqualifiedReason: body.disqualifiedReason,
            }),
            revision: current.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, current.id))
          .returning();
        const before = leadDto(current);
        const after = leadDto(row!);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'lead.updated',
          resourceType: 'lead',
          resourceId: row!.id,
          before,
          after,
        });
        return after;
      });
      setEtag(reply, dto.revision);
      return dto;
    },
  );
};

export default crmModule;
