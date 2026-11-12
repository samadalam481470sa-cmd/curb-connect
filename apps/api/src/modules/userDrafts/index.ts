// Cross-device per-person workspace drafts. Existing business records still use their own APIs.
// The active user/org is taken from the authenticated cookie, not request JSON, URL or email.
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { userWorkspaceDrafts } from '../../db/schema/userDrafts';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';

const Key = z.enum(['house-builder', 'curb-workspace', 'roof-workspace', 'invoice-contacts']);
const Params = z.object({ key: Key });
const Write = z.object({
  value: z.record(z.string(), z.unknown()),
  /** 0 = create a new draft, positive = replace ONLY the version last loaded. */
  expectedRevision: z.number().int().min(0).max(2147483646),
});
const Result = z.object({
  key: Key,
  value: z.record(z.string(), z.unknown()),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
const MAX_BYTES = 256 * 1024;

const userDraftsModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/me/drafts/:key', {
    config: { auth: 'org' },
    schema: {
      tags: ['user drafts'],
      summary: 'Read your own workspace draft from the active company',
      params: Params,
      response: { 200: Result.nullable() },
    },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const { orgId, userId } = requireOrg(request);
    const [draft] = await tenantTx(request, (tx) => tx.select()
      .from(userWorkspaceDrafts)
      .where(and(eq(userWorkspaceDrafts.orgId, orgId),
        eq(userWorkspaceDrafts.userId, userId),
        eq(userWorkspaceDrafts.draftKey, request.params.key)))
      .limit(1));
    return draft ? {
      key: request.params.key,
      value: draft.value as Record<string, unknown>,
      revision: draft.revision,
      updatedAt: draft.updatedAt.toISOString(),
    } : null;
  });

  app.put('/me/drafts/:key', {
    config: { auth: 'org', rateLimit: { max: 100, timeWindow: '1 minute' } },
    bodyLimit: MAX_BYTES,
    schema: {
      tags: ['user drafts'],
      summary: 'Create or autosave your private workspace draft using revision checks',
      params: Params,
      body: Write,
      response: { 200: Result },
    },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const { orgId, userId } = requireOrg(request);
    const data = JSON.stringify(request.body.value);
    if (Buffer.byteLength(data, 'utf8') > MAX_BYTES - 2048) {
      throw problem('payload_too_large', 'Draft exceeds the 254 KB workspace limit.');
    }
    // One SQL statement protects even simultaneous first saves. When a second device
    // writes based on an old revision, it receives a conflict rather than deleting edits.
    const rows = await tenantTx(request, (tx) => tx.execute(sql<{
      revision: number; updated_at: Date;
    }>`
      INSERT INTO public.user_workspace_drafts
        (org_id, user_id, draft_key, value)
      VALUES (${orgId}::uuid, ${userId}::uuid, ${request.params.key}, ${data}::jsonb)
      ON CONFLICT (org_id, user_id, draft_key)
      DO UPDATE SET
        value = EXCLUDED.value,
        revision = public.user_workspace_drafts.revision + 1,
        updated_at = clock_timestamp()
      WHERE public.user_workspace_drafts.revision = ${request.body.expectedRevision}
      RETURNING revision, updated_at
    `));
    const updated = rows[0] as { revision: number; updated_at: Date } | undefined;
    if (!updated) {
      throw problem('conflict',
        'This draft changed in another session. Reload it before saving to prevent data loss.');
    }
    return {
      key: request.params.key,
      value: request.body.value,
      revision: updated.revision,
      updatedAt: new Date(updated.updated_at).toISOString(),
    };
  });
};

export default userDraftsModule;
