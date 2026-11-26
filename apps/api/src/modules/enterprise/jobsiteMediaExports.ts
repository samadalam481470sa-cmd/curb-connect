import {
  CreateJobsiteMediaExport,
  JobsiteMediaExport,
  JobsiteMediaExportDownload,
  JobsiteMediaExports,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseMediaExports as mediaExports } from '../../db/schema/enterpriseMediaExports';
import { assertCan, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { sha256Hex } from '../media/processing';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';
import { packageMediaManifest } from './jobsiteMediaExportManifest';
import { jobsiteMediaExportKey } from './jobsiteMediaExportProcessing';
import {
  JOBSITE_EXPORT_LINK_SECONDS,
  signJobsiteExportLink,
  validJobsiteExportLink,
} from './jobsiteMediaExportSigning';

type ExportRow = typeof mediaExports.$inferSelect;
type Scope = { orgId: string; projectId: string; userId: string; membershipId: string };

function ownerScope(scope: Scope) {
  return and(
    eq(mediaExports.orgId, scope.orgId),
    eq(mediaExports.projectId, scope.projectId),
    eq(mediaExports.requesterUserId, scope.userId),
    eq(mediaExports.requesterMembershipId, scope.membershipId),
  );
}

function dto(row: ExportRow): z.infer<typeof JobsiteMediaExport> {
  return {
    id: row.id,
    format: row.format,
    selection: row.selection,
    status: row.status,
    manifest: row.manifest,
    failureCode: row.failureCode,
    sha256: row.sha256,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function findExport(tx: Tx, scope: Scope, id: string) {
  const [row] = await tx
    .select()
    .from(mediaExports)
    .where(and(ownerScope(scope), eq(mediaExports.id, id)));
  if (!row) throw problem('not_found');
  return row;
}

const jobsiteMediaExports: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/exports';
  const params = MediaProjectParams.extend({ exportId: z.uuid() });
  const signature = z.strictObject({
    until: z.coerce.number().int().positive(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  });

  app.get(
    path,
    {
      config: { permission: 'export:create' },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        response: { 200: JobsiteMediaExports },
      },
    },
    async (request, reply) => {
      assertCan(request, 'enterprise_media:read');
      const { projectId } = request.params;
      const items = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { ...org, projectId };
        const rows = await tx
          .select()
          .from(mediaExports)
          .where(ownerScope(scope))
          .orderBy(desc(mediaExports.createdAt), desc(mediaExports.id))
          .limit(50);
        return rows.map(dto);
      });
      return reply.header('cache-control', 'private, no-store').send({ items });
    },
  );

  app.post(
    path,
    {
      config: { permission: 'export:create', rateLimit: { max: 12, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        body: CreateJobsiteMediaExport,
        response: { 200: JobsiteMediaExport, 202: JobsiteMediaExport },
      },
    },
    async (request, reply) => {
      assertCan(request, 'enterprise_media:read');
      const { projectId } = request.params;
      const { mediaIds, format, selection, clientRequestId } = request.body;
      const ids = [...mediaIds].sort();
      const requestHash = sha256Hex(Buffer.from(JSON.stringify({ ids, format, selection })));
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { ...org, projectId };
        const [receipt] = await tx
          .select()
          .from(mediaExports)
          .where(and(ownerScope(scope), eq(mediaExports.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already queued a different package.');
          return { created: false, value: dto(receipt) };
        }
        const manifest = await packageMediaManifest(tx, scope, ids, selection);
        const [created] = await tx
          .insert(mediaExports)
          .values({
            orgId: org.orgId,
            projectId,
            requesterUserId: org.userId,
            requesterMembershipId: org.membershipId,
            format,
            selection,
            clientRequestId,
            requestHash,
            manifest,
          })
          .returning();
        if (!created) throw problem('internal');
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'enterprise_media.package_export',
          aggregateType: 'enterprise_media_export',
          aggregateId: created.id,
          payload: { projectId, exportId: created.id },
          jobKey: 'enterprise_media.package_export:' + created.id,
          correlationId: request.id,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: created.id,
          resourceType: 'enterprise_media_export',
          action: 'media.package_export_requested',
          after: { projectId, format, selection, mediaIds: ids },
        });
        return { created: true, value: dto(created) };
      });
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 202 : 200)
        .send(result.value);
    },
  );

  app.post(
    path + '/:exportId/download-link',
    {
      config: { permission: 'export:create', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params, response: { 200: JobsiteMediaExportDownload } },
    },
    async (request, reply) => {
      assertCan(request, 'enterprise_media:read');
      const { projectId, exportId } = request.params;
      const download = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const row = await findExport(tx, { ...org, projectId }, exportId);
        if (row.status !== 'ready')
          throw problem('conflict', 'The package is not ready to download.');
        const until = Math.floor(Date.now() / 1000) + JOBSITE_EXPORT_LINK_SECONDS;
        const token = signJobsiteExportLink(
          app.config.session.secret,
          { ...org, projectId, exportId },
          until,
        );
        const query = new URLSearchParams({ token, until: String(until) });
        return {
          href:
            '/v1/enterprise/projects/' +
            projectId +
            '/media/exports/' +
            exportId +
            '/file?' +
            query.toString(),
          expiresAt: new Date(until * 1000).toISOString(),
        };
      });
      return reply.header('cache-control', 'private, no-store').send(download);
    },
  );

  app.get(
    path + '/:exportId/file',
    {
      config: { permission: 'export:create', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params, querystring: signature },
    },
    async (request, reply) => {
      assertCan(request, 'enterprise_media:read');
      const { projectId, exportId } = request.params;
      const { token, until } = request.query;
      const output = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { ...org, projectId, exportId };
        if (!validJobsiteExportLink(app.config.session.secret, scope, until, token))
          throw problem('not_found');
        const row = await findExport(tx, scope, exportId);
        if (row.status !== 'ready' || !row.sha256 || row.byteSize === null)
          throw problem('not_found');
        const bytes = await app.storage.get(jobsiteMediaExportKey(scope, row.sha256));
        if (bytes.length !== row.byteSize || sha256Hex(bytes) !== row.sha256)
          throw problem('conflict', 'The saved package could not be verified.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: exportId,
          resourceType: 'enterprise_media_export',
          action: 'media.package_export_downloaded',
        });
        return { format: row.format, bytes };
      });
      const filename = 'jobsite-media-' + exportId.slice(0, 8) + '.' + output.format;
      return reply
        .type(output.format === 'zip' ? 'application/zip' : 'application/pdf')
        .header('content-disposition', 'attachment; filename="' + filename + '"')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(output.bytes);
    },
  );
};

export default jobsiteMediaExports;
