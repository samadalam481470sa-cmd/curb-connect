import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ExportTakeoffMarkup,
  PreviewTakeoffMarkup,
  TakeoffMarkupExport,
  TakeoffMarkupExportPage,
  TakeoffMarkupPreview,
} from '@fieldline/contracts';
import { canonicalJson, renderToBuffer, sha256Hex } from '@fieldline/pdf';
import { enterpriseTakeoffMarkupExports as exports } from '../../db/schema/enterpriseTakeoff';
import { organizations } from '../../db/schema/orgs';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { renderTakeoffMarkupDrawing } from '../../services/takeoff-markup';
import { audit, checkEnabled, checkProject } from './access';
import { readVerifiedEnterpriseDocument } from './documentStorage';
import type { TakeoffSheetScope } from './takeoffCalibration';
import { sheetScope } from './takeoffMeasurements';
import { readMarkupSnapshot } from './takeoffMarkupSnapshot';

const path =
  '/enterprise/projects/:projectId/takeoff/plan-sets/:planId/sheets/:sheetId/markup-exports';
const Sheet = z.object({ projectId: z.uuid(), planId: z.uuid(), sheetId: z.uuid() });
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 20, timeWindow: '1 minute' },
} as const;
const read = { permission: 'estimate:write' } as const;

function dto(row: typeof exports.$inferSelect): z.infer<typeof TakeoffMarkupExport> {
  return {
    ...row.preview,
    id: row.id,
    filename: 'takeoff-markup-' + row.id + '.pdf',
    format: 'pdf',
    sha256: row.sha256,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
  };
}

async function alreadyExported(
  tx: Tx,
  scope: TakeoffSheetScope,
  userId: string,
  clientRequestId: string,
  requestHash: string,
) {
  const [row] = await tx
    .select()
    .from(exports)
    .where(
      and(
        eq(exports.orgId, scope.orgId),
        eq(exports.projectId, scope.projectId),
        eq(exports.clientRequestId, clientRequestId),
      ),
    );
  if (row && (row.requestHash !== requestHash || row.createdByUserId !== userId))
    throw problem('conflict', 'This request already recorded a different export.');
  return row;
}

function checkSelection(preview: z.infer<typeof TakeoffMarkupPreview>, expected: string) {
  if (preview.selectionDigest !== expected)
    throw problem(
      'conflict',
      'The approved measurements or scale have changed. Refresh the review before exporting.',
    );
  if (!preview.approvedCount)
    throw problem('validation_failed', 'Select a layer with current approved measurements.');
}

const takeoffMarkup: FastifyPluginAsyncZod = async (app) => {
  app.post(
    path + '/preview',
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        body: PreviewTakeoffMarkup,
        response: { 200: TakeoffMarkupPreview },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId);
        return (await readMarkupSnapshot(tx, scope, request.body.visibleLayers)).preview;
      });
    },
  );

  app.get(
    path,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: TakeoffMarkupExportPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId);
        const limit = 15;
        const rows = await tx
          .select()
          .from(exports)
          .where(
            and(sheetScope(exports, scope), beforeCursor(exports.createdAt, exports.id, cursor)),
          )
          .orderBy(desc(msTrunc(exports.createdAt)), desc(exports.id))
          .limit(limit + 1);
        return pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), dto);
      });
    },
  );

  app.post(
    path,
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Sheet,
        body: ExportTakeoffMarkup,
        response: { 200: TakeoffMarkupExport, 201: TakeoffMarkupExport },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const scope = { orgId, ...request.params };
      const { clientRequestId, ...input } = request.body;
      if (input.sheetId !== scope.sheetId || input.revisionId !== scope.planId)
        throw problem('not_found');
      const visibleLayers = [...input.visibleLayers].sort();
      const requestHash = sha256Hex(canonicalJson({ ...input, visibleLayers }));
      const before = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const project = await checkProject(tx, orgId, scope.projectId, true);
        const prior = await alreadyExported(tx, scope, userId, clientRequestId, requestHash);
        if (prior) return { prior } as const;
        const snapshot = await readMarkupSnapshot(tx, scope, visibleLayers, true);
        checkSelection(snapshot.preview, input.selectionDigest);
        const [org] = await tx
          .select({ name: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        return { snapshot, organization: org?.name ?? project.name } as const;
      });
      if (before.prior) return reply.code(200).send(dto(before.prior));

      const { snapshot, organization } = before;
      const { source, preview } = snapshot;
      const bytes = await readVerifiedEnterpriseDocument(app.storage, orgId, source.file);
      const id = randomUUID();
      const createdAt = new Date();
      const drawing = await renderTakeoffMarkupDrawing(
        bytes,
        source.sheet,
        snapshot.geometry,
      ).catch((cause: unknown) => {
        request.log.warn(
          { cause, sheetId: scope.sheetId },
          'Takeoff markup drawing could not render',
        );
        throw problem(
          'dependency_unavailable',
          'The selected drawing could not render. Try exporting again.',
        );
      });
      const pdf = await renderToBuffer({
        kind: 'takeoff_markup',
        meta: {
          documentId: id,
          revision: 1,
          issuedAt: createdAt.toISOString(),
          organization: { name: organization },
        },
        planTitle: source.planTitle,
        sheetLabel: source.sheet.pageLabel,
        revisionLabel: preview.revisionLabel,
        scaleLabel: preview.scaleLabel,
        approvedCount: preview.approvedCount,
        totals: preview.totals,
        drawing,
      });
      if (pdf.buffer.length > app.config.storage.maxUploadBytes)
        throw problem('payload_too_large', 'The rendered markup PDF exceeds the file size limit.');
      const storageKey = 'orgs/' + orgId + '/enterprise/takeoff-markup/' + id;
      let storageAttempted = false;
      try {
        const result = await tenantTx(request, async (tx) => {
          await checkEnabled(tx, orgId);
          await checkProject(tx, orgId, scope.projectId, true);
          const prior = await alreadyExported(tx, scope, userId, clientRequestId, requestHash);
          if (prior) return { row: prior, created: false };
          const current = await readMarkupSnapshot(tx, scope, visibleLayers);
          checkSelection(current.preview, input.selectionDigest);
          storageAttempted = true;
          await app.storage.put(storageKey, pdf.buffer, 'application/pdf');
          const [row] = await tx
            .insert(exports)
            .values({
              ...scope,
              id,
              calibrationId: snapshot.calibrationId,
              sourceVersionId: source.sheet.sourceVersionId,
              selectedReviewIds: snapshot.reviewIds,
              preview,
              templateVersion: pdf.templateVersion,
              storageKey,
              sha256: pdf.sha256,
              byteSize: pdf.buffer.length,
              createdByUserId: userId,
              createdAt,
              clientRequestId,
              requestHash,
            })
            .returning();
          if (!row) throw new Error('Takeoff markup export insertion failed.');
          await audit(
            tx,
            orgId,
            userId,
            'takeoff_markup_export',
            row.id,
            'takeoff.markup_exported',
            null,
            {
              ...dto(row),
              planId: scope.planId,
              sourceVersionId: row.sourceVersionId,
              calibrationId: row.calibrationId,
              selectedReviewIds: row.selectedReviewIds,
            },
          );
          return { row, created: true };
        });
        return reply.code(result.created ? 201 : 200).send(dto(result.row));
      } catch (cause) {
        if (storageAttempted) {
          try {
            const [record] = await tenantTx(request, (tx) =>
              tx
                .select({ id: exports.id })
                .from(exports)
                .where(and(sheetScope(exports, scope), eq(exports.id, id))),
            );
            if (!record) await app.storage.delete(storageKey);
          } catch {
            request.log.warn(
              { exportId: id },
              'Could not reconcile an interrupted Takeoff markup export',
            );
          }
        }
        throw cause;
      }
    },
  );

  app.get(
    path + '/:exportId/download',
    {
      config: read,
      schema: { tags: ['enterprise'], params: Sheet.extend({ exportId: z.uuid() }) },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const { exportId, ...pathScope } = request.params;
      const scope = { orgId, ...pathScope };
      const row = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, scope.projectId);
        const [record] = await tx
          .select()
          .from(exports)
          .where(and(sheetScope(exports, scope), eq(exports.id, exportId)));
        if (!record) throw problem('not_found');
        return record;
      });
      const bytes = await readVerifiedEnterpriseDocument(app.storage, orgId, {
        ...row,
        sha256Hex: row.sha256,
      });
      return reply
        .type('application/pdf')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Disposition', 'attachment; filename="' + dto(row).filename + '"')
        .send(bytes);
    },
  );
};

export default takeoffMarkup;
