// `network` module (workstream 06 "Contractor directory and company network", 10 shared projects).
//
// A connection is created as two mirrored rows, one in each company, under a shared pair key. Both
// sides must exist and be active before an invoice or a project can cross. The directory is opt-in
// and shows only public company fields: no contact records, no financial data, no rankings.
import {
  CompanyDirectoryResponseSchema,
  ConnectionListSchema,
  ConnectionSchema,
  CreateConnectionRequestSchema,
  CreateNetworkProjectRequestSchema,
  NetworkProjectListSchema,
  NetworkProjectSchema,
  UuidSchema,
  UpdateDirectoryListingRequestSchema,
} from '@fieldline/contracts';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { companyConnections, networkProjects, organizations } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { notifyCompany } from '../../services/invoice-exchange';

const ConnectionParams = z.object({ connectionId: UuidSchema });

const networkModule: FastifyPluginAsyncZod = async (app) => {
  /**
   * Opt-in directory search. This is the only cross-tenant read in the platform, and it returns a
   * deliberately small card so it can never leak another company's records.
   */
  app.get(
    '/network/directory',
    {
      config: { permission: 'network:read' },
      schema: {
        tags: ['network'],
        summary: 'Search companies that opted in to the contractor directory',
        querystring: z.object({
          q: z.string().trim().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        }),
        response: { 200: CompanyDirectoryResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const q = request.query.q;
      return platformTx(
        request,
        'network.directory',
        async (tx) => {
          const filters = [
            eq(organizations.directoryOptIn, true),
            eq(organizations.status, 'active'),
            ne(organizations.id, org.orgId),
          ];
          const search = q
            ? or(ilike(organizations.displayName, `%${q}%`), ilike(organizations.slug, `%${q}%`))
            : undefined;
          const rows = await tx
            .select({
              orgId: organizations.id,
              displayName: organizations.displayName,
              slug: organizations.slug,
              productLines: organizations.productLines,
              serviceArea: organizations.serviceAreaLabel,
              directoryOptIn: organizations.directoryOptIn,
            })
            .from(organizations)
            .where(and(...filters, ...(search ? [search] : [])))
            .orderBy(organizations.displayName)
            .limit(request.query.limit);
          const mine = await tx
            .select({
              partnerOrgId: companyConnections.partnerOrgId,
              status: companyConnections.status,
            })
            .from(companyConnections)
            .where(eq(companyConnections.orgId, org.orgId));
          const statusByPartner = new Map(mine.map((c) => [c.partnerOrgId, c.status]));
          return {
            items: rows.map((row) => ({
              ...row,
              connectionStatus: statusByPartner.get(row.orgId) ?? null,
            })),
            nextCursor: null,
          };
        },
        { orgId: org.orgId, userId: org.userId },
      );
    },
  );

  /** Turns the company's own listing on or off. Off by default: never listed implicitly. */
  app.patch(
    '/network/listing',
    {
      config: {
        permission: 'network:listing_update',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['network'],
        summary: 'Opt this company in or out of the public contractor directory',
        body: UpdateDirectoryListingRequestSchema,
        response: {
          200: z.object({ directoryOptIn: z.boolean(), serviceArea: z.string().nullable() }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [row] = await tx
          .update(organizations)
          .set({
            directoryOptIn: request.body.directoryOptIn,
            ...(request.body.serviceArea !== undefined && {
              serviceAreaLabel: request.body.serviceArea,
            }),
            revision: sql`${organizations.revision} + 1`,
          })
          .where(eq(organizations.id, org.orgId))
          .returning({
            directoryOptIn: organizations.directoryOptIn,
            serviceArea: organizations.serviceAreaLabel,
          });
        if (!row) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'network.listing_updated',
          resourceType: 'organization',
          resourceId: org.orgId,
          after: row,
        });
        return row;
      });
    },
  );

  app.get(
    '/network/connections',
    {
      config: { permission: 'network:read' },
      schema: {
        tags: ['network'],
        summary: 'This company’s connections, both directions',
        querystring: z.object({
          status: z.enum(['pending', 'active', 'declined', 'revoked']).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: ConnectionListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(companyConnections)
          .where(
            and(
              eq(companyConnections.orgId, org.orgId),
              ...(request.query.status
                ? [eq(companyConnections.status, request.query.status)]
                : []),
            ),
          )
          .orderBy(desc(companyConnections.createdAt))
          .limit(request.query.limit),
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          orgId: row.orgId,
          revision: row.revision,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          partnerOrgId: row.partnerOrgId,
          partnerDisplayName: row.partnerDisplayName,
          partnerSlug: row.partnerSlug,
          direction: row.direction,
          status: row.status,
          scopes: row.scopes,
          message: row.message,
          respondedAt: row.respondedAt?.toISOString() ?? null,
          revokedAt: row.revokedAt?.toISOString() ?? null,
        })),
        nextCursor: null,
      };
    },
  );

  /**
   * Requests a connection by writing both sides. Duplicate requests are rejected: the pair key and
   * the (org, partner) uniqueness make the intent unambiguous.
   */
  app.post(
    '/network/connections',
    {
      config: { permission: 'network:connect', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['network'],
        summary: 'Request a connection with a company you found in the directory',
        body: CreateConnectionRequestSchema,
        response: { 201: ConnectionSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const partnerOrgId = request.body.partnerOrgId;
      if (partnerOrgId === org.orgId) {
        throw problem('validation_failed', 'A company cannot connect to itself.');
      }
      const created = await platformTx(
        request,
        'network.connect',
        async (tx) => {
          const [partner] = await tx
            .select({
              id: organizations.id,
              name: organizations.displayName,
              slug: organizations.slug,
              status: organizations.status,
              directoryOptIn: organizations.directoryOptIn,
            })
            .from(organizations)
            .where(eq(organizations.id, partnerOrgId))
            .limit(1);
          if (!partner) throw problem('not_found', 'That company was not found.');
          if (partner.status !== 'active' || !partner.directoryOptIn) {
            throw problem(
              'forbidden',
              'That company is not accepting connection requests. Ask them to enable their directory listing.',
            );
          }
          const [me] = await tx
            .select({ name: organizations.displayName, slug: organizations.slug })
            .from(organizations)
            .where(eq(organizations.id, org.orgId))
            .limit(1);
          if (!me) throw problem('not_found');

          const [existing] = await tx
            .select({ status: companyConnections.status })
            .from(companyConnections)
            .where(
              or(
                and(
                  eq(companyConnections.orgId, org.orgId),
                  eq(companyConnections.partnerOrgId, partnerOrgId),
                ),
                and(
                  eq(companyConnections.orgId, partnerOrgId),
                  eq(companyConnections.partnerOrgId, org.orgId),
                ),
              ),
            )
            .limit(1);
          if (existing && existing.status !== 'revoked' && existing.status !== 'declined') {
            throw problem(
              'duplicate',
              'There is already a connection or a pending request with this company.',
            );
          }

          const pairKey = randomUUID();
          const scopes = request.body.scopes;
          if (existing) {
            // A declined or revoked pair can be re-requested: replace both sides in place.
            await tx
              .delete(companyConnections)
              .where(
                or(
                  and(
                    eq(companyConnections.orgId, org.orgId),
                    eq(companyConnections.partnerOrgId, partnerOrgId),
                  ),
                  and(
                    eq(companyConnections.orgId, partnerOrgId),
                    eq(companyConnections.partnerOrgId, org.orgId),
                  ),
                ),
              );
          }
          const [mine] = await tx
            .insert(companyConnections)
            .values({
              orgId: org.orgId,
              pairKey,
              partnerOrgId,
              partnerDisplayName: partner.name,
              partnerSlug: partner.slug,
              direction: 'outgoing',
              status: 'pending',
              scopes,
              message: request.body.message ?? null,
              requestedByUserId: org.userId,
            })
            .returning();
          await tx.insert(companyConnections).values({
            orgId: partnerOrgId,
            pairKey,
            partnerOrgId: org.orgId,
            partnerDisplayName: me.name,
            partnerSlug: me.slug,
            direction: 'incoming',
            status: 'pending',
            scopes,
            message: request.body.message ?? null,
            requestedByUserId: org.userId,
          });
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'network.connection_requested',
            resourceType: 'company_connection',
            resourceId: mine!.id,
            after: { partnerOrgId, scopes },
          });
          await notifyCompany(tx, {
            orgId: partnerOrgId,
            category: 'system',
            title: `${me.name} wants to connect`,
            body: request.body.message ?? 'Open Network to review the request.',
            link: '/network',
            dedupeKey: `connection-request:${pairKey}`,
            correlationId: request.id,
          });
          return mine!;
        },
        { orgId: org.orgId, userId: org.userId },
      );
      reply.status(201);
      return toConnectionDto(created);
    },
  );

  app.post(
    '/network/connections/:connectionId/accept',
    {
      config: { permission: 'network:connect', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['network'],
        summary: 'Accept a pending connection request (both companies become active)',
        params: ConnectionParams,
        response: { 200: ConnectionSchema },
      },
    },
    async (request) => decideConnection(request, 'active'),
  );

  app.post(
    '/network/connections/:connectionId/decline',
    {
      config: { permission: 'network:connect', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['network'],
        summary: 'Decline a pending connection request',
        params: ConnectionParams,
        response: { 200: ConnectionSchema },
      },
    },
    async (request) => decideConnection(request, 'declined'),
  );

  app.post(
    '/network/connections/:connectionId/revoke',
    {
      config: { permission: 'network:connect', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['network'],
        summary: 'Revoke an active or pending connection (both sides stop immediately)',
        params: ConnectionParams,
        response: { 200: ConnectionSchema },
      },
    },
    async (request) => decideConnection(request, 'revoked'),
  );

  app.get(
    '/network/projects',
    {
      config: { permission: 'network:read' },
      schema: {
        tags: ['network'],
        summary: 'Projects shared with connected companies',
        response: { 200: NetworkProjectListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(networkProjects)
          .where(eq(networkProjects.orgId, org.orgId))
          .orderBy(desc(networkProjects.createdAt))
          .limit(100),
      );
      return { items: rows.map(toProjectDto), nextCursor: null };
    },
  );

  app.post(
    '/network/projects',
    {
      config: { permission: 'network:connect', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['network'],
        summary: 'Share a project with a connected company',
        body: CreateNetworkProjectRequestSchema,
        response: { 201: NetworkProjectSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const created = await platformTx(
        request,
        'network.share',
        async (tx) => {
          const [connection] = await tx
            .select()
            .from(companyConnections)
            .where(
              and(
                eq(companyConnections.orgId, org.orgId),
                eq(companyConnections.id, body.connectionId),
                eq(companyConnections.status, 'active'),
              ),
            )
            .limit(1);
          if (!connection) throw problem('not_found', 'That active connection was not found.');
          if (!connection.scopes.includes('projects')) {
            throw problem('forbidden', 'The connection does not include the projects scope.');
          }
          const [theirs] = await tx
            .select({ id: companyConnections.id })
            .from(companyConnections)
            .where(
              and(
                eq(companyConnections.orgId, connection.partnerOrgId),
                eq(companyConnections.partnerOrgId, org.orgId),
                eq(companyConnections.status, 'active'),
              ),
            )
            .limit(1);
          if (!theirs) {
            throw problem('conflict', 'The connection is not active on the partner side.');
          }
          const [me] = await tx
            .select({ name: organizations.displayName, currency: organizations.currency })
            .from(organizations)
            .where(eq(organizations.id, org.orgId))
            .limit(1);
          if (!me) throw problem('not_found');
          const networkKey = randomUUID();
          const reference = `PRJ-${networkKey.slice(0, 6).toUpperCase()}`;
          const shared = {
            networkKey,
            reference,
            name: body.name,
            clientName: body.clientName ?? null,
            siteAddress: body.siteAddress ?? null,
            status: 'active' as const,
            contractValueMinor: body.contractValueMinor ?? null,
            currency: body.currency ?? me.currency,
          };
          const [mine] = await tx
            .insert(networkProjects)
            .values({
              orgId: org.orgId,
              ...shared,
              side: 'lead',
              partnerOrgId: connection.partnerOrgId,
              partnerDisplayName: connection.partnerDisplayName,
              connectionId: connection.id,
            })
            .returning();
          await tx.insert(networkProjects).values({
            orgId: connection.partnerOrgId,
            ...shared,
            side: 'partner',
            partnerOrgId: org.orgId,
            partnerDisplayName: me.name,
            connectionId: theirs.id,
          });
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'network.project_shared',
            resourceType: 'network_project',
            resourceId: mine!.id,
            after: { partnerOrgId: connection.partnerOrgId, reference },
          });
          await notifyCompany(tx, {
            orgId: connection.partnerOrgId,
            category: 'system',
            title: `${me.name} shared a project: ${body.name}`,
            body: `${reference} is now visible in Network → Shared projects.`,
            link: '/network/projects',
            dedupeKey: `project-shared:${networkKey}`,
            correlationId: request.id,
          });
          return mine!;
        },
        { orgId: org.orgId, userId: org.userId },
      );
      reply.status(201);
      return toProjectDto(created);
    },
  );
};

function toConnectionDto(row: typeof companyConnections.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    partnerOrgId: row.partnerOrgId,
    partnerDisplayName: row.partnerDisplayName,
    partnerSlug: row.partnerSlug,
    direction: row.direction,
    status: row.status,
    scopes: row.scopes,
    message: row.message,
    respondedAt: row.respondedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function toProjectDto(row: typeof networkProjects.$inferSelect) {
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reference: row.reference,
    name: row.name,
    clientName: row.clientName,
    siteAddress: row.siteAddress,
    status: row.status,
    side: row.side as 'lead' | 'partner',
    partnerOrgId: row.partnerOrgId,
    partnerDisplayName: row.partnerDisplayName,
    contractValue:
      row.contractValueMinor === null
        ? null
        : { amountMinor: row.contractValueMinor, currency: row.currency },
  };
}

type DecideTarget = 'active' | 'declined' | 'revoked';

/** Shared accept/decline/revoke: one decision, written to both mirrored rows atomically. */
async function decideConnection(request: FastifyRequest, target: DecideTarget) {
  const org = requireOrg(request);
  const connectionId = (request.params as { connectionId: string }).connectionId;
  const result = await platformTx(
    request,
    'network.connect',
    async (tx) => {
      const [mine] = await tx
        .select()
        .from(companyConnections)
        .where(
          and(eq(companyConnections.orgId, org.orgId), eq(companyConnections.id, connectionId)),
        )
        .for('update');
      if (!mine) throw problem('not_found');
      if (target === 'active' && mine.direction !== 'incoming') {
        throw problem('forbidden', 'Only the company that received the request can accept it.');
      }
      if (target === 'active' && mine.status !== 'pending') {
        throw problem('invalid_transition', `A ${mine.status} connection cannot be accepted.`);
      }
      if (target === 'declined' && (mine.status !== 'pending' || mine.direction !== 'incoming')) {
        throw problem('invalid_transition', 'Only a pending incoming request can be declined.');
      }
      if (target === 'revoked' && mine.status !== 'active' && mine.status !== 'pending') {
        throw problem('invalid_transition', `A ${mine.status} connection cannot be revoked.`);
      }
      const now = new Date();
      const [updated] = await tx
        .update(companyConnections)
        .set({
          status: target,
          respondedAt: target === 'revoked' ? mine.respondedAt : now,
          revokedAt: target === 'revoked' ? now : null,
          revision: mine.revision + 1,
        })
        .where(and(eq(companyConnections.orgId, org.orgId), eq(companyConnections.id, mine.id)))
        .returning();
      await tx
        .update(companyConnections)
        .set({
          status: target,
          respondedAt: target === 'revoked' ? sql`responded_at` : now,
          revokedAt: target === 'revoked' ? now : null,
          revision: sql`${companyConnections.revision} + 1`,
        })
        .where(
          and(
            eq(companyConnections.orgId, mine.partnerOrgId),
            eq(companyConnections.pairKey, mine.pairKey),
          ),
        );
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: `network.connection_${target}`,
        resourceType: 'company_connection',
        resourceId: mine.id,
        before: { status: mine.status },
        after: { status: target },
      });
      const [me] = await tx
        .select({ name: organizations.displayName })
        .from(organizations)
        .where(eq(organizations.id, org.orgId))
        .limit(1);
      if (target !== 'declined') {
        await notifyCompany(tx, {
          orgId: mine.partnerOrgId,
          category: 'system',
          title:
            target === 'active'
              ? `${me?.name ?? 'A company'} accepted your connection request`
              : `${me?.name ?? 'A company'} revoked the connection`,
          body:
            target === 'active'
              ? 'You can now exchange invoices and share projects with them.'
              : 'Invoices and projects can no longer cross between your companies.',
          link: '/network',
          dedupeKey: `connection-${target}:${mine.pairKey}:${mine.revision + 1}`,
          correlationId: request.id,
        });
      }
      return updated!;
    },
    { orgId: org.orgId, userId: org.userId },
  );
  return toConnectionDto(result);
}

export default networkModule;
