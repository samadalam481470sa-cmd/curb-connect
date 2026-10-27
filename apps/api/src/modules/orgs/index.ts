// `orgs` module (PLT-014, STR tenant model): create a tenant (creator becomes owner of record,
// onboarding defaults, idempotent), read/update the active organization with If-Match, and
// versioned settings sections with per-section permissions (billing = payment settings).
import { createHash } from 'node:crypto';
import {
  CreateOrganizationRequestSchema,
  OrganizationListSchema,
  OrganizationSchema,
  OrgSettingsSchema,
  UpdateOrganizationRequestSchema,
  type Organization,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idempotencyKeys, memberships, organizations, orgSettingsRevisions } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { assertCan, platformTx, requireOrg, requireUser, tenantTx, userTx } from '../../http/context';
import { readIdempotencyKey, requestFingerprint } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { setActiveOrg } from '../../services/sessions';
import {
  defaultSettings,
  SECTION_READ_PERMISSION,
  SECTION_WRITE_PERMISSION,
  SETTINGS_SECTION_KEYS,
  SETTINGS_SECTIONS,
  SettingsSectionSchema,
} from './settings';

type OrgRow = typeof organizations.$inferSelect;

export function organizationDto(row: OrgRow): Organization {
  return {
    id: row.id,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    slug: row.slug,
    legalName: row.legalName,
    displayName: row.displayName,
    status: row.status,
    productLines: row.productLines,
    timezone: row.timezone,
    locale: row.locale,
    currency: row.currency,
    measurementSystem: row.measurementSystem,
    isDemo: row.isDemo,
  };
}

/** Deterministic UUID (v5-shaped) for an idempotent create: same user + key -> same org id. */
export function deterministicUuid(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return base.length >= 3 ? base : `company-${base}`.replace(/-+$/, '');
}

async function uniqueSlug(tx: Tx, wanted: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? wanted : `${wanted}-${Math.random().toString(36).slice(2, 7)}`;
    const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, candidate));
    if (!taken) return candidate;
  }
  throw problem('duplicate', 'Could not find a free company handle. Choose one explicitly.');
}

export async function latestSettings(tx: Tx, orgId: string) {
  const [row] = await tx
    .select()
    .from(orgSettingsRevisions)
    .where(eq(orgSettingsRevisions.orgId, orgId))
    .orderBy(desc(orgSettingsRevisions.revisionNumber))
    .limit(1);
  return row ?? null;
}

const SettingsResponseSchema = OrgSettingsSchema;
const PutSettingsBodySchema = z.object({
  settings: z.record(z.string(), z.unknown()),
  changeReason: z.string().trim().min(1).max(500).optional(),
});

const orgsModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/orgs',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['orgs'],
        summary: 'Create a company (tenant); the caller becomes its owner. Idempotent with Idempotency-Key.',
        headers: z.object({ 'idempotency-key': z.string().optional() }).loose(),
        body: CreateOrganizationRequestSchema,
        response: { 200: OrganizationSchema, 201: OrganizationSchema },
      },
    },
    async (request, reply) => {
      const auth = requireUser(request);
      const key = readIdempotencyKey(request, false);
      const body = request.body;
      const hash = requestFingerprint('POST', '/v1/orgs', body);
      const orgId = key ? deterministicUuid('org.create', auth.userId, key) : crypto.randomUUID();

      // Platform operation 'org.create': the tenant row does not exist yet, so RLS context cannot
      // be set. Everything below is scoped to the new orgId explicitly.
      const result = await platformTx(
        request,
        'org.create',
        async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${orgId}))`);
          const [existing] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
          if (existing) {
            const [stored] = key
              ? await tx
                  .select()
                  .from(idempotencyKeys)
                  .where(and(eq(idempotencyKeys.orgId, orgId), eq(idempotencyKeys.key, key)))
              : [];
            if (!stored || stored.requestHash !== hash) throw problem('idempotency_key_reused');
            return { status: 200, org: stored.responseBody as Organization, replay: true };
          }
          const slug = await uniqueSlug(tx, body.slug ?? slugify(body.displayName));
          const [org] = await tx
            .insert(organizations)
            .values({
              id: orgId,
              slug,
              legalName: body.legalName,
              displayName: body.displayName,
              productLines: body.productLines,
              timezone: body.timezone,
              currency: body.currency,
              measurementSystem: body.measurementSystem,
            })
            .returning();
          const [membership] = await tx
            .insert(memberships)
            .values({ orgId, userId: auth.userId, role: 'owner', status: 'active' })
            .returning({ id: memberships.id });
          await tx.insert(orgSettingsRevisions).values({
            orgId,
            revisionNumber: 1,
            settings: defaultSettings(body.productLines),
            changeReason: 'Initial defaults (company created)',
            changedByUserId: auth.userId,
          });
          const dto = organizationDto(org!);
          await auditRequest(request, tx, {
            orgId,
            action: 'org.created',
            resourceType: 'organization',
            resourceId: orgId,
            after: dto,
          });
          await auditRequest(request, tx, {
            orgId,
            action: 'team.member_added',
            resourceType: 'membership',
            resourceId: membership!.id,
            after: { userId: auth.userId, role: 'owner', ownerOfRecord: true },
          });
          if (key) {
            await tx.insert(idempotencyKeys).values({
              orgId,
              key,
              method: 'POST',
              path: '/v1/orgs',
              requestHash: hash,
              status: 'completed',
              responseStatus: 201,
              responseBody: dto,
              actorUserId: auth.userId,
              expiresAt: new Date(Date.now() + 24 * 3_600_000),
            });
          }
          return { status: 201, org: dto, replay: false };
        },
        { orgId, userId: auth.userId },
      );
      if (!result.replay) await setActiveOrg(app.db, auth.sessionId, orgId);
      if (result.replay) reply.header('idempotent-replayed', 'true');
      reply.status(result.status as 200 | 201);
      return result.org;
    },
  );

  app.get(
    '/orgs',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['orgs'],
        summary: 'Companies the signed-in user belongs to (workspace switcher)',
        response: { 200: OrganizationListSchema },
      },
    },
    async (request) => {
      const auth = requireUser(request);
      const rows = await userTx(request, (tx) =>
        tx
          .select({ org: organizations })
          .from(organizations)
          .innerJoin(memberships, and(eq(memberships.orgId, organizations.id), eq(memberships.userId, auth.userId)))
          .where(eq(memberships.status, 'active'))
          .orderBy(organizations.displayName),
      );
      return { items: rows.map((r) => organizationDto(r.org)), nextCursor: null };
    },
  );

  app.get(
    '/orgs/current',
    {
      config: { permission: 'org:read' },
      schema: { tags: ['orgs'], summary: 'The active company', response: { 200: OrganizationSchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const [row] = await tenantTx(request, (tx) => tx.select().from(organizations).where(eq(organizations.id, org.orgId)));
      if (!row) throw problem('not_found');
      setEtag(reply, row.revision);
      return organizationDto(row);
    },
  );

  app.patch(
    '/orgs/current',
    {
      config: { permission: 'org:update' },
      schema: {
        tags: ['orgs'],
        summary: 'Update the active company profile (If-Match: current revision)',
        headers: z.object({ 'if-match': z.string().optional() }).loose(),
        body: UpdateOrganizationRequestSchema,
        response: { 200: OrganizationSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const updated = await tenantTx(request, async (tx) => {
        const [current] = await tx.select().from(organizations).where(eq(organizations.id, org.orgId)).for('update');
        if (!current) throw problem('not_found');
        assertRevision(current.revision, expected);
        const patch = request.body;
        // Slug uniqueness spans tenants; a clash surfaces as 23505 -> 409 duplicate.
        const [row] = await tx
          .update(organizations)
          .set({
            ...(patch.legalName !== undefined && { legalName: patch.legalName }),
            ...(patch.displayName !== undefined && { displayName: patch.displayName }),
            ...(patch.slug !== undefined && { slug: patch.slug }),
            ...(patch.productLines !== undefined && { productLines: patch.productLines }),
            ...(patch.timezone !== undefined && { timezone: patch.timezone }),
            ...(patch.currency !== undefined && { currency: patch.currency }),
            ...(patch.measurementSystem !== undefined && { measurementSystem: patch.measurementSystem }),
            revision: current.revision + 1,
          })
          .where(eq(organizations.id, org.orgId))
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'org.updated',
          resourceType: 'organization',
          resourceId: org.orgId,
          before: organizationDto(current),
          after: organizationDto(row!),
        });
        return row!;
      });
      setEtag(reply, updated.revision);
      return organizationDto(updated);
    },
  );

  app.get(
    '/orgs/current/settings',
    {
      config: { permission: 'org:read' },
      schema: {
        tags: ['orgs'],
        summary: 'Current settings revision (sections you may not read are omitted)',
        response: { 200: SettingsResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, (tx) => latestSettings(tx, org.orgId));
      if (!row) throw problem('not_found', 'Settings have not been initialized.');
      const settings = { ...(row.settings as Record<string, unknown>) };
      for (const section of SETTINGS_SECTION_KEYS) {
        const needed = SECTION_READ_PERMISSION[section];
        if (needed && !org.permissions.has(needed)) delete settings[section];
      }
      setEtag(reply, row.revisionNumber);
      return {
        revisionNumber: row.revisionNumber,
        settings,
        changeReason: row.changeReason,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  app.put(
    '/orgs/current/settings/:section',
    {
      config: { permission: 'org:read' },
      schema: {
        tags: ['orgs'],
        summary: 'Change one settings section: writes a new immutable revision (If-Match: revisionNumber)',
        params: z.object({ section: SettingsSectionSchema }),
        headers: z.object({ 'if-match': z.string().optional() }).loose(),
        body: PutSettingsBodySchema,
        response: { 200: SettingsResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { section } = request.params;
      // PLT-015 G: billing ("payment settings") needs billing_settings:update; estimators lack it.
      assertCan(request, SECTION_WRITE_PERMISSION[section]);
      const expected = parseIfMatch(request);
      const parsed = SETTINGS_SECTIONS[section].parse(request.body.settings);
      const row = await tenantTx(request, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`settings:${org.orgId}`}))`);
        const current = await latestSettings(tx, org.orgId);
        const currentNumber = current?.revisionNumber ?? 0;
        assertRevision(currentNumber, expected);
        const before = (current?.settings ?? {}) as Record<string, Record<string, unknown>>;
        const next = { ...before, [section]: { ...(before[section] ?? {}), ...parsed } };
        const [inserted] = await tx
          .insert(orgSettingsRevisions)
          .values({
            orgId: org.orgId,
            revisionNumber: currentNumber + 1,
            settings: next,
            changeReason: request.body.changeReason ?? null,
            changedByUserId: org.userId,
          })
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: `org.settings_updated`,
          resourceType: 'org_settings',
          resourceId: inserted!.id,
          before: { section, revisionNumber: currentNumber, value: before[section] ?? null },
          after: { section, revisionNumber: currentNumber + 1, value: next[section] },
          reason: request.body.changeReason ?? null,
        });
        return inserted!;
      });
      setEtag(reply, row.revisionNumber);
      const settings = { ...(row.settings as Record<string, unknown>) };
      for (const s of SETTINGS_SECTION_KEYS) {
        const needed = SECTION_READ_PERMISSION[s];
        if (needed && !org.permissions.has(needed)) delete settings[s];
      }
      return {
        revisionNumber: row.revisionNumber,
        settings,
        changeReason: row.changeReason,
        createdAt: row.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/orgs/current/settings/revisions',
    {
      config: { permission: 'org:settings_update' },
      schema: {
        tags: ['orgs'],
        summary: 'Settings revision history (newest first)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
        response: {
          200: z.object({
            items: z.array(OrgSettingsSchema.extend({ changedByUserId: z.uuid().nullable() })),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(orgSettingsRevisions)
          .where(eq(orgSettingsRevisions.orgId, org.orgId))
          .orderBy(desc(orgSettingsRevisions.revisionNumber))
          .limit(request.query.limit),
      );
      const canBilling = org.permissions.has('billing_settings:read');
      return {
        items: rows.map((r) => {
          const settings = { ...(r.settings as Record<string, unknown>) };
          if (!canBilling) delete settings.billing;
          return {
            revisionNumber: r.revisionNumber,
            settings,
            changeReason: r.changeReason,
            createdAt: r.createdAt.toISOString(),
            changedByUserId: r.changedByUserId,
          };
        }),
        nextCursor: null,
      };
    },
  );
};

export default orgsModule;
