// Export pipeline (RF-036 R, RR-036, RR-038, COS-219, ADD-035): an export_records row is written
// 'pending' in the request transaction; rendering runs AFTER commit from the stored snapshot, then
// the record gets the object key, SHA-256 checksum, template version and size (or an explicit
// error). Subject modules register how to build and render their snapshots.
// Deferred: the render runs in-process after commit (setImmediate). A durable graphile task
// ('export.render') belongs in src/jobs (not owned by this module); a crashed process leaves the
// record 'pending' and POST /v1/exports/{id}/retry re-runs it.
import { createHash } from 'node:crypto';
import type { ExportFormat } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type Tx, withTenant } from '../../db/runtime';
import { auditEvents, exportRecords } from '../../db/schema';

export type ExportRow = typeof exportRecords.$inferSelect;

export interface RenderedExport {
  body: Buffer;
  contentType: string;
  extension: string;
  templateVersion: string;
  /** Checksum of the canonical snapshot content (identifies what was rendered). */
  contentChecksum: string;
}

export interface ExportSubject {
  formats: readonly ExportFormat[];
  render(tx: Tx, orgId: string, subjectId: string, format: ExportFormat): Promise<RenderedExport>;
}

const subjects = new Map<string, ExportSubject>();
const inflight = new Map<string, Promise<void>>();

export function registerExportSubject(subjectType: string, subject: ExportSubject): void {
  if (!subjects.has(subjectType)) subjects.set(subjectType, subject);
}

export function exportSubject(subjectType: string): ExportSubject | null {
  return subjects.get(subjectType) ?? null;
}

export function exportDto(r: ExportRow) {
  return {
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    format: r.format,
    status: r.status,
    templateVersion: r.templateVersion,
    sha256: r.sha256,
    sizeBytes: r.sizeBytes,
    options: r.options,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
  };
}

async function render(app: FastifyInstance, orgId: string, userId: string | null, id: string): Promise<void> {
  const scope = { orgId, userId };
  const row = await withTenant(app.db, scope, async (tx) => {
    const [r] = await tx.select().from(exportRecords).where(and(eq(exportRecords.orgId, orgId), eq(exportRecords.id, id)));
    return r ?? null;
  });
  if (!row || row.status !== 'pending') return;
  const subject = exportSubject(row.subjectType);
  try {
    if (!subject) throw new Error(`no exporter for ${row.subjectType}`);
    const out = await withTenant(app.db, scope, (tx) => subject.render(tx, orgId, row.subjectId, row.format));
    const key = `orgs/${orgId}/exports/${row.id}.${out.extension}`;
    await app.storage.put(key, out.body, out.contentType);
    const sha256 = createHash('sha256').update(out.body).digest('hex');
    await withTenant(app.db, scope, async (tx) => {
      await tx
        .update(exportRecords)
        .set({ status: 'completed', objectKey: key, sha256, sizeBytes: out.body.length, templateVersion: out.templateVersion, completedAt: new Date(), options: { ...(row.options as object), contentChecksum: out.contentChecksum } })
        .where(and(eq(exportRecords.orgId, orgId), eq(exportRecords.id, row.id)));
      await tx.insert(auditEvents).values({
        orgId,
        actorType: 'system',
        actorUserId: userId,
        action: 'export.completed',
        resourceType: 'export_record',
        resourceId: row.id,
        after: { format: row.format, sha256, sizeBytes: out.body.length, templateVersion: out.templateVersion, subjectType: row.subjectType, subjectId: row.subjectId },
      });
    });
  } catch (error) {
    // RR-038 S: a failed export is explicit; report delivery itself is unaffected.
    const message = error instanceof Error ? error.message.slice(0, 500) : 'export failed';
    app.log.warn({ exportId: row.id, err: message }, 'export render failed');
    await withTenant(app.db, scope, (tx) =>
      tx.update(exportRecords).set({ status: 'failed', error: message, completedAt: new Date() }).where(and(eq(exportRecords.orgId, orgId), eq(exportRecords.id, row.id))),
    );
  }
}

/** Starts rendering after the creating transaction committed; returns the in-flight promise. */
export function scheduleRender(app: FastifyInstance, orgId: string, userId: string | null, id: string): Promise<void> {
  const p = new Promise<void>((resolve) => setImmediate(resolve)).then(() => render(app, orgId, userId, id)).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Test/ops seam: wait for an export that is rendering in this process. */
export async function awaitExport(id: string): Promise<void> {
  await inflight.get(id);
}
