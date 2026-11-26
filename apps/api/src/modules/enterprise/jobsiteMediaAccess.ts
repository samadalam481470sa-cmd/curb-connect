import { createHash } from 'node:crypto';
import { JobsiteMediaGrant, SetJobsiteMediaGrant } from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseMediaProjectGrants as grants } from '../../db/schema/enterpriseMedia';
import { memberships } from '../../db/schema/team';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { flagsFor } from '../../services/flags';
import { checkEnabled, checkProject } from './access';

export const mediaPath = '/enterprise/projects/:projectId/media';
export const MediaProjectParams = z.object({ projectId: z.uuid() });

export async function latestMediaProjectGrant(
  tx: Tx,
  orgId: string,
  projectId: string,
  membershipId: string,
) {
  const [grant] = await tx
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.orgId, orgId),
        eq(grants.projectId, projectId),
        eq(grants.membershipId, membershipId),
      ),
    )
    .orderBy(desc(grants.revision))
    .limit(1);
  return grant;
}

export async function requireMediaProject(
  request: FastifyRequest,
  tx: Tx,
  projectId: string,
  lock: boolean | 'share' = false,
) {
  const org = requireOrg(request);
  await checkEnabled(tx, org.orgId);
  const flags = await flagsFor(tx, org.orgId);
  if (!flags['enterprise.jobsite_media'])
    throw problem('feature_unavailable', 'Jobsite media is off for this company.');
  const project = await checkProject(tx, org.orgId, projectId, lock);
  if (
    !org.permissions.has('enterprise_media:manage_grants') &&
    !(await latestMediaProjectGrant(tx, org.orgId, projectId, org.membershipId))?.active
  ) {
    throw problem('not_found');
  }
  return { org, project };
}

function grantDto(row: typeof grants.$inferSelect) {
  return {
    membershipId: row.membershipId,
    active: row.active,
    reason: row.reason,
    revision: row.revision,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

const mediaGrantRoutes: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/grants/:membershipId';
  const params = MediaProjectParams.extend({ membershipId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:manage_grants' },
      schema: {
        tags: ['enterprise'],
        params,
        response: { 200: z.object({ grant: JobsiteMediaGrant.nullable() }) },
      },
    },
    async (request, reply) => {
      const { projectId, membershipId } = request.params;
      const grant = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId);
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.orgId, org.orgId), eq(memberships.id, membershipId)));
        if (!member) throw problem('not_found');
        return latestMediaProjectGrant(tx, org.orgId, projectId, membershipId);
      });
      setEtag(reply, grant?.revision ?? 0);
      return { grant: grant ? grantDto(grant) : null };
    },
  );

  app.put(
    path,
    {
      config: { permission: 'enterprise_media:manage_grants' },
      schema: {
        tags: ['enterprise'],
        params,
        body: SetJobsiteMediaGrant,
        response: { 200: JobsiteMediaGrant },
      },
    },
    async (request, reply) => {
      const { projectId, membershipId } = request.params;
      const { active, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const hash = createHash('sha256')
        .update(JSON.stringify({ membershipId, active, reason, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const [member] = await tx
          .select({ status: memberships.status })
          .from(memberships)
          .where(and(eq(memberships.orgId, org.orgId), eq(memberships.id, membershipId)));
        if (!member) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(grants)
          .where(
            and(
              eq(grants.orgId, org.orgId),
              eq(grants.projectId, projectId),
              eq(grants.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== hash)
            throw problem('conflict', 'This request already changed a different media grant.');
          return grantDto(receipt);
        }
        if (active && member.status !== 'active')
          throw problem('conflict', 'Only an active member can receive a media grant.');
        const current = await latestMediaProjectGrant(tx, org.orgId, projectId, membershipId);
        const revision = current?.revision ?? 0;
        assertRevision(revision, expected);
        const [row] = await tx
          .insert(grants)
          .values({
            orgId: org.orgId,
            projectId,
            membershipId,
            active,
            reason,
            clientRequestId,
            requestHash: hash,
            revision: revision + 1,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw problem('internal');
        const saved = grantDto(row);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_project_grant',
          resourceId: row.id,
          action: 'media.project_grant_changed',
          reason,
          before: current ? grantDto(current) : null,
          after: { ...saved, projectId },
        });
        return saved;
      });
      setEtag(reply, result.revision);
      return result;
    },
  );
};
export default mediaGrantRoutes;
