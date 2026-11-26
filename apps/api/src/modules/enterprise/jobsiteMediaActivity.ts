import {
  JOBSITE_MEDIA_ACTIVITY_ACTIONS,
  JobsiteMediaActivity,
  type JobsiteMediaActivityAction,
  type JobsiteMediaIssue,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { auditEvents } from '../../db/schema/audit';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { tenantTx } from '../../http/context';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';

const jobsiteMediaActivity: FastifyPluginAsyncZod = async (app) => {
  app.get(
    mediaPath + '/activity',
    {
      config: {
        permission: 'enterprise_media:read',
        rateLimit: { max: 45, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        response: { 200: JobsiteMediaActivity },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = and(eq(uploads.orgId, org.orgId), eq(uploads.projectId, projectId));
        const activity = await tx
          .select({
            id: auditEvents.id,
            mediaId: uploads.id,
            filename: uploads.filename,
            action: auditEvents.action,
            createdAt: auditEvents.createdAt,
          })
          .from(uploads)
          .innerJoin(
            auditEvents,
            and(
              eq(auditEvents.orgId, uploads.orgId),
              eq(auditEvents.resourceId, uploads.id),
              inArray(auditEvents.resourceType, [
                'enterprise_media_asset',
                'enterprise_media_upload_session',
              ]),
            ),
          )
          .where(
            and(
              scope,
              inArray(auditEvents.action, JOBSITE_MEDIA_ACTIVITY_ACTIONS),
              or(isNotNull(uploads.finalizedAt), eq(uploads.uploaderUserId, org.userId)),
            ),
          )
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(30);

        const impaired = await tx
          .select({
            mediaId: assets.id,
            filename: uploads.filename,
            scanState: assets.scanState,
            videoState: assets.videoState,
            revision: assets.revision,
          })
          .from(uploads)
          .innerJoin(
            assets,
            and(
              eq(assets.orgId, uploads.orgId),
              eq(assets.projectId, uploads.projectId),
              eq(assets.id, uploads.id),
            ),
          )
          .where(
            and(
              scope,
              or(
                inArray(assets.scanState, ['infected', 'unsupported', 'scan_failed']),
                inArray(assets.videoState, ['rejected', 'failed']),
              ),
            ),
          )
          .orderBy(desc(assets.createdAt), desc(assets.id))
          .limit(30);

        return {
          events: activity.map((event) => ({
            ...event,
            action: event.action as JobsiteMediaActivityAction,
            createdAt: event.createdAt.toISOString(),
          })),
          exceptions: impaired.map(({ mediaId, filename, scanState, videoState, revision }) => {
            const reason: JobsiteMediaIssue =
              scanState === 'infected' || scanState === 'unsupported' || scanState === 'scan_failed'
                ? scanState
                : videoState === 'rejected'
                  ? 'video_rejected'
                  : 'video_failed';
            return { mediaId, filename, revision, reason };
          }),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default jobsiteMediaActivity;
