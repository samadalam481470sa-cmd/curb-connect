// `flags` module (PLT-020, BE-080 R): server-evaluated feature flags per tenant and jurisdiction.
// Tenants may toggle product features for themselves; flags that gate capabilities which need a
// platform decision (a validated model, a licensed adapter, SMS consent tooling) can only be
// enabled by the platform, so an admin cannot switch on something that does not really exist.
import {
  FEATURE_FLAGS,
  type FeatureFlagKey,
  FeatureFlagKeySchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { featureFlags } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { flagsFor } from '../../services/flags';

export const PLATFORM_CONTROLLED_FLAGS: readonly FeatureFlagKey[] = [
  'roof.auto_facets',
  'curb.ai_measurement',
  'roof.esx_export',
  'billing.online_payments',
  'notifications.sms',
  'curb.permit_rules',
];

const FlagMapSchema = z.record(FeatureFlagKeySchema, z.boolean());

const flagsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flags',
    {
      config: { permission: 'flags:read' },
      schema: {
        tags: ['flags'],
        summary: 'Evaluated feature flags for the active company (optionally for one jurisdiction)',
        querystring: z.object({ jurisdictionId: UuidSchema.optional() }),
        response: {
          200: z.object({
            flags: FlagMapSchema,
            definitions: z.array(
              z.object({
                key: FeatureFlagKeySchema,
                description: z.string(),
                jurisdictionScoped: z.boolean(),
                platformControlled: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const flags = await tenantTx(request, (tx) => flagsFor(tx, org.orgId, request.query.jurisdictionId));
      return {
        flags,
        definitions: (Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]).map((key) => ({
          key,
          description: FEATURE_FLAGS[key].description,
          jurisdictionScoped: FEATURE_FLAGS[key].jurisdictionScoped,
          platformControlled: PLATFORM_CONTROLLED_FLAGS.includes(key),
        })),
      };
    },
  );

  app.put(
    '/flags/:key',
    {
      config: { permission: 'flags:manage' },
      schema: {
        tags: ['flags'],
        summary: 'Set a company-level (optionally jurisdiction-level) override',
        params: z.object({ key: FeatureFlagKeySchema }),
        body: z.object({
          enabled: z.boolean(),
          jurisdictionId: UuidSchema.nullable().optional(),
          rolloutNote: z.string().max(500).optional(),
        }),
        response: { 200: z.object({ flags: FlagMapSchema }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { key } = request.params;
      const { enabled, jurisdictionId, rolloutNote } = request.body;
      if (PLATFORM_CONTROLLED_FLAGS.includes(key) && enabled) {
        throw problem('feature_unavailable', 'This capability is enabled by the platform once it is validated.');
      }
      if (jurisdictionId && !FEATURE_FLAGS[key].jurisdictionScoped) {
        throw problem('validation_failed', 'This flag is not jurisdiction-scoped.');
      }
      const flags = await tenantTx(request, async (tx) => {
        const scope = and(
          eq(featureFlags.orgId, org.orgId),
          eq(featureFlags.key, key),
          jurisdictionId ? eq(featureFlags.jurisdictionId, jurisdictionId) : isNull(featureFlags.jurisdictionId),
        );
        const [before] = await tx.select().from(featureFlags).where(scope);
        if (before) {
          await tx
            .update(featureFlags)
            .set({ enabled, rolloutNote: rolloutNote ?? before.rolloutNote, revision: sql`${featureFlags.revision} + 1` })
            .where(eq(featureFlags.id, before.id));
        } else {
          await tx.insert(featureFlags).values({
            orgId: org.orgId,
            jurisdictionId: jurisdictionId ?? null,
            key,
            enabled,
            rolloutNote: rolloutNote ?? null,
          });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'flags.override_set',
          resourceType: 'feature_flag',
          resourceId: before?.id ?? null,
          before: before ? { key, enabled: before.enabled, jurisdictionId: before.jurisdictionId } : null,
          after: { key, enabled, jurisdictionId: jurisdictionId ?? null },
        });
        return flagsFor(tx, org.orgId);
      });
      return { flags };
    },
  );
};

export default flagsModule;
