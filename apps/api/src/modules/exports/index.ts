// `exports` module (RF-036, RR-036, RR-038, ADD-035): status, retry and download of generated exports.
// Creation is subject-specific (e.g. POST /v1/roof/reports/{id}/exports) and goes through
// createExport() so every export records actor, format, destination, report version and audit.
import { ExportRecordDtoSchema, type ExportFormat, UuidSchema } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { exportRecords } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { exportDto, exportSubject, type ExportRow, scheduleRender } from './service';

const IdParams = z.object({ id: UuidSchema });

/** Inserts the pending record (+ audit) in the caller's transaction; call scheduleExport after commit. */
export async function createExport(
  request: FastifyRequest,
  tx: Tx,
  input: { subjectType: string; subjectId: string; format: ExportFormat; options: Record<string, unknown> },
): Promise<ExportRow> {
  const org = requireOrg(request);
  const subject = exportSubject(input.subjectType);
  const supported = Boolean(subject?.formats.includes(input.format));
  const [row] = await tx
    .insert(exportRecords)
    .values({
      orgId: org.orgId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      format: input.format,
      status: supported ? 'pending' : 'unsupported',
      options: input.options,
      // RR-038 A: ESX is an optional licensed integration that is not built; say so explicitly.
      error: supported ? null : `${input.format} export is not available for ${input.subjectType} (no validated format adapter).`,
      requestedByUserId: org.userId,
      completedAt: supported ? null : new Date(),
    })
    .returning();
  await auditRequest(request, tx, {
    orgId: org.orgId,
    action: 'export.requested',
    resourceType: 'export_record',
    resourceId: row!.id,
    after: { subjectType: input.subjectType, subjectId: input.subjectId, format: input.format, status: row!.status, ...input.options },
  });
  return row!;
}

export function scheduleExport(request: FastifyRequest, row: ExportRow): void {
  if (row.status !== 'pending') return;
  const org = requireOrg(request);
  void scheduleRender(request.server, org.orgId, org.userId, row.id);
}

const exportsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/exports/:id',
    { config: { permission: 'export:create' }, schema: { tags: ['exports'], summary: 'Export status', params: IdParams, response: { 200: ExportRecordDtoSchema } } },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [row] = await tx.select().from(exportRecords).where(and(eq(exportRecords.orgId, org.orgId), eq(exportRecords.id, request.params.id)));
        if (!row) throw problem('not_found');
        return exportDto(row);
      });
    },
  );

  app.post(
    '/exports/:id/retry',
    { config: { permission: 'export:create' }, schema: { tags: ['exports'], summary: 'Retry a failed or stuck export', params: IdParams, response: { 202: ExportRecordDtoSchema } } },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [r] = await tx.select().from(exportRecords).where(and(eq(exportRecords.orgId, org.orgId), eq(exportRecords.id, request.params.id))).for('update');
        if (!r) throw problem('not_found');
        if (r.status !== 'failed' && r.status !== 'pending') throw problem('invalid_transition', `A ${r.status} export cannot be retried.`);
        const [u] = await tx.update(exportRecords).set({ status: 'pending', error: null, completedAt: null }).where(eq(exportRecords.id, r.id)).returning();
        return u!;
      });
      scheduleExport(request, row);
      reply.status(202);
      return exportDto(row);
    },
  );

  app.get(
    '/exports/:id/download',
    {
      config: { permission: 'export:create' },
      schema: { tags: ['exports'], summary: 'Short-lived download link (audited)', params: IdParams, response: { 200: z.object({ url: z.string(), expiresInSeconds: z.number(), sha256: z.string() }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        const [r] = await tx.select().from(exportRecords).where(and(eq(exportRecords.orgId, org.orgId), eq(exportRecords.id, request.params.id)));
        if (!r) throw problem('not_found');
        if (r.status !== 'completed' || !r.objectKey || !r.sha256) throw problem('conflict', `The export is ${r.status}.`, { retryable: r.status === 'pending', retryAfterSeconds: 2 });
        await auditRequest(request, tx, { orgId: org.orgId, action: 'export.downloaded', resourceType: 'export_record', resourceId: r.id, after: { sha256: r.sha256 } });
        return r;
      });
      const ext = row.format === 'pdf' ? 'pdf' : row.format;
      const contentType = row.format === 'pdf' ? 'application/pdf' : row.format === 'csv' ? 'text/csv' : 'application/json';
      const expiresInSeconds = 300;
      const url = await request.server.storage.createDownloadUrl(row.objectKey!, { expiresInSeconds, contentType, fileName: `export-${row.id}.${ext}` });
      return { url, expiresInSeconds, sha256: row.sha256! };
    },
  );
};

export default exportsModule;
