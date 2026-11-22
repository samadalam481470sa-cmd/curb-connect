// Invoice Intelligence routes (/v1/invoice-intel/*): bulk import of invoices and bills from other
// platforms, the review queue, import history, payments on imported records, and Analysis.
// Additive: the existing Billing invoices, bills, payments and /invoices/import are unchanged.
import { UuidSchema } from '@fieldline/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  importedInvoicePayments,
  importedInvoices,
  invoiceImportBatches,
  invoiceImportFiles,
  invoiceImportProfiles,
  organizations,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { askOpenModelWithFallback } from '../../services/open-model';
import { extractPlanPdfText } from '../../services/plan-pdf';
import { analyze, DEFINITIONS } from './analysis';
import {
  AI_PROMPT,
  FIELDS,
  FIELD_LABEL,
  PLATFORM_PROFILES,
  candidateFromAi,
  candidateFromText,
  headerSignature,
  type Candidate,
  type Direction,
  type Field,
} from './extract';
import {
  LIMITS,
  SUPPORTED_FORMATS,
  dangerousContent,
  expandZip,
  parseDelimited,
  parseXlsx,
  sha256,
  sniffKind,
  type FileKind,
} from './intake';
import {
  ApprovalError,
  addPayment,
  analysisRecords,
  approveRecord,
  editRecord,
  extractSheetFile,
  listRecords,
  mappingFor,
  mappingReady,
  refreshBatch,
  sheetFromRows,
  storeCandidates,
  type ImportFile,
} from './service';

const today = () => new Date().toISOString().slice(0, 10);
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Money = z.number().int().min(-1e13).max(1e13);
const MappingSchema = z.record(z.enum(FIELDS), z.number().int().min(0).max(LIMITS.columns));

/** Spreadsheet cells that start with = + - @ run as formulas in Excel; prefix them. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const invoiceIntelModule: FastifyPluginAsyncZod = async (app) => {
  const defaultCurrency = async (
    tx: Parameters<Parameters<typeof tenantTx>[1]>[0],
    orgId: string,
  ) => {
    const [o] = await tx
      .select({ currency: organizations.currency })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return o?.currency ?? 'USD';
  };

  app.get(
    '/invoice-intel/meta',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'Supported formats, limits, fields and KPI definitions',
      },
    },
    async () => ({
      formats: SUPPORTED_FORMATS,
      limits: {
        fileMb: LIMITS.fileBytes / 1024 / 1024,
        batchFiles: LIMITS.batchFiles,
        zipEntries: LIMITS.zipEntries,
        rows: LIMITS.rows,
      },
      fields: FIELDS.map((f) => ({ key: f, label: FIELD_LABEL[f] })),
      platforms: [
        { id: 'other', label: 'Other / not sure' },
        ...PLATFORM_PROFILES.map((p) => ({ id: p.id, label: p.label })),
      ],
      aiReading: app.config.openModel !== null,
      virusScanner: app.scanner.name,
      definitions: DEFINITIONS,
      knownLimits: [
        'Totals in another currency are kept but not converted, and are left out of Analysis.',
        'Excel: only the first sheet is read; dates stored as numbers are converted when the column is mapped to a date.',
        'Scanned documents need the server AI; without it they are entered by hand in review.',
        'Analysis is not a general ledger, tax return or certified financial statement.',
      ],
    }),
  );

  app.post(
    '/invoice-intel/batches',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Start an import batch',
        body: z.object({
          sourcePlatform: z.string().trim().min(1).max(60).default('other'),
          directionHint: z.enum(['auto', 'receivable', 'payable', 'mixed']).default('auto'),
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [b] = await tx
          .insert(invoiceImportBatches)
          .values({
            orgId: org.orgId,
            createdByUserId: request.auth?.userId ?? null,
            sourcePlatform: request.body.sourcePlatform,
            directionHint: request.body.directionHint,
          })
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice_import.batch_created',
          resourceType: 'invoice_import_batch',
          resourceId: b!.id,
          after: request.body,
        });
        return { batch: b };
      });
    },
  );

  app.post(
    '/invoice-intel/batches/:batchId/files',
    {
      bodyLimit: Math.ceil((LIMITS.fileBytes * 4) / 3) + 64 * 1024,
      config: { permission: 'invoice:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Upload one file (or ZIP) into a batch; it is checked, stored privately and read',
        params: z.object({ batchId: UuidSchema }),
        body: z.object({
          name: z.string().trim().min(1).max(300),
          dataBase64: z
            .string()
            .min(4)
            .max(Math.ceil((LIMITS.fileBytes * 4) / 3) + 8),
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const bytes = Uint8Array.from(Buffer.from(request.body.dataBase64, 'base64'));
      if (bytes.length > LIMITS.fileBytes)
        throw problem('validation_failed', 'File is larger than 12 MB.');
      const batch = await tenantTx(request, async (tx) => {
        const [b] = await tx
          .select()
          .from(invoiceImportBatches)
          .where(
            and(
              eq(invoiceImportBatches.orgId, org.orgId),
              eq(invoiceImportBatches.id, request.params.batchId),
            ),
          )
          .limit(1);
        return b ?? null;
      });
      if (!batch) throw problem('not_found');
      if (batch.fileCount >= LIMITS.batchFiles)
        throw problem(
          'validation_failed',
          `A batch holds at most ${LIMITS.batchFiles} files. Start a new batch.`,
        );

      const name = request.body.name.split(/[\\/]/).pop()!.slice(0, 300);
      const kind = sniffKind(name, bytes);
      const inputs: { name: string; bytes: Uint8Array; kind: FileKind; parent?: string }[] = [];
      const skipped: { name: string; reason: string }[] = [];
      if (kind === 'zip') {
        try {
          const z = expandZip(bytes);
          skipped.push(...z.skipped);
          for (const f of z.files)
            inputs.push({
              name: f.name,
              bytes: f.bytes,
              kind: sniffKind(f.name, f.bytes),
              parent: name,
            });
        } catch {
          skipped.push({
            name,
            reason: 'The ZIP could not be opened (damaged or password-protected).',
          });
        }
      } else inputs.push({ name, bytes, kind });

      const results: {
        file: string;
        status: string;
        reason?: string;
        records?: number;
        needsReview?: number;
        duplicates?: number;
        fileId?: string;
        headers?: string[];
      }[] = [];
      for (const s of skipped) results.push({ file: s.name, status: 'rejected', reason: s.reason });
      for (const input of inputs.slice(0, LIMITS.batchFiles - batch.fileCount)) {
        results.push(await processFile(request, org.orgId, batch, input));
      }
      await tenantTx(request, (tx) => refreshBatch(tx, org.orgId, batch.id));
      return { results };
    },
  );

  async function processFile(
    request: Parameters<typeof tenantTx>[0],
    orgId: string,
    batch: typeof invoiceImportBatches.$inferSelect,
    input: { name: string; bytes: Uint8Array; kind: FileKind; parent?: string },
  ) {
    const hash = sha256(input.bytes);
    const danger = dangerousContent(input.name, input.bytes);
    const reject = async (reason: string, status: 'rejected' | 'duplicate_file' = 'rejected') => {
      const f = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(invoiceImportFiles)
          .values({
            orgId,
            batchId: batch.id,
            fileName: input.name,
            mimeType: input.kind,
            kind: input.kind,
            byteSize: input.bytes.length,
            sha256: hash,
            status,
            rejectReason: reason,
          })
          .returning();
        return row!;
      });
      return { file: input.name, status, reason, fileId: f.id };
    };
    if (danger) return reject(danger);
    if (input.kind === 'unsupported')
      return reject('Not a supported file type. Use CSV, TSV, XLSX, PDF, PNG, JPEG, WebP or ZIP.');
    if (input.kind === 'zip') return reject('Archives inside archives are not opened.');

    const already = await tenantTx(request, async (tx) => {
      const [f] = await tx
        .select({ id: invoiceImportFiles.id, batchId: invoiceImportFiles.batchId })
        .from(invoiceImportFiles)
        .where(
          and(
            eq(invoiceImportFiles.orgId, orgId),
            eq(invoiceImportFiles.sha256, hash),
            inArray(invoiceImportFiles.status, ['extracted', 'needs_mapping']),
          ),
        )
        .limit(1);
      return f ?? null;
    });
    if (already)
      return reject(
        'This exact file was already imported. Its records are in import history.',
        'duplicate_file',
      );

    const scan = await app.scanner.scan(Buffer.from(input.bytes));
    if (scan === 'infected')
      return reject('The virus scanner flagged this file. It was not stored.');
    const scanNote =
      scan === 'clean' ? null : 'File was not virus-scanned (no scanner is set up on the server).';

    const storageKey = `orgs/${orgId}/invoice-imports/${batch.id}/${hash}`;
    try {
      await app.storage.put(
        storageKey,
        Buffer.from(input.bytes),
        input.kind === 'pdf'
          ? 'application/pdf'
          : input.kind === 'image'
            ? 'application/octet-stream'
            : 'text/plain',
      );
    } catch (error) {
      request.log.error({ err: error }, 'invoice import: storing original failed');
      return reject(
        'The original file could not be stored safely. Nothing was imported. Try again.',
      );
    }

    const file = await tenantTx(request, async (tx) => {
      const [row] = await tx
        .insert(invoiceImportFiles)
        .values({
          orgId,
          batchId: batch.id,
          fileName: input.parent ? `${input.parent} / ${input.name}` : input.name,
          mimeType: input.kind,
          kind: input.kind,
          byteSize: input.bytes.length,
          sha256: hash,
          storageKey,
          status: 'extracting',
        })
        .returning();
      return row!;
    });
    const hint: Direction =
      batch.directionHint === 'receivable' || batch.directionHint === 'payable'
        ? batch.directionHint
        : 'unknown';
    const fail = async (reason: string) => {
      await tenantTx(request, (tx) =>
        tx
          .update(invoiceImportFiles)
          .set({ status: 'failed', rejectReason: reason, updatedAt: new Date() })
          .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.id, file.id))),
      );
      return { file: input.name, status: 'failed', reason, fileId: file.id };
    };

    try {
      if (input.kind === 'csv' || input.kind === 'xlsx') {
        const rows =
          input.kind === 'csv'
            ? parseDelimited(new TextDecoder('utf-8').decode(input.bytes))
            : parseXlsx(input.bytes);
        if (rows.length < 2) return fail('The file has no data rows.');
        const sheet = sheetFromRows(rows);
        return tenantTx(request, async (tx) => {
          const cur = await defaultCurrency(tx, orgId);
          const m = await mappingFor(tx, orgId, sheet.headers);
          await tx
            .update(invoiceImportFiles)
            .set({ sheet, mapping: m.mapping, updatedAt: new Date() })
            .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.id, file.id)));
          const withSheet: ImportFile = { ...file, sheet, mapping: m.mapping };
          if (!mappingReady(m.mapping)) {
            await tx
              .update(invoiceImportFiles)
              .set({ status: 'needs_mapping', updatedAt: new Date() })
              .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.id, file.id)));
            return {
              file: input.name,
              status: 'needs_mapping',
              fileId: file.id,
              headers: sheet.headers,
            };
          }
          const r = await extractSheetFile(tx, orgId, withSheet, m.mapping, m.confidence, {
            directionHint: hint !== 'unknown' ? hint : (m.direction ?? 'unknown'),
            defaultCurrency: cur,
            today: today(),
            scanNote,
            platform: m.platform,
          });
          return { file: input.name, status: 'extracted', fileId: file.id, ...r };
        });
      }
      // PDF and images: one document each.
      const cur = await tenantTx(request, (tx) => defaultCurrency(tx, orgId));
      const ctx = { directionHint: hint, defaultCurrency: cur, today: today(), scanNote };
      let candidate: Candidate | null = null;
      let text = '';
      if (input.kind === 'pdf') {
        try {
          text = (await extractPlanPdfText(input.bytes)).text;
        } catch {
          text = '';
        }
      }
      const model = app.config.openModel;
      if (model && (input.kind === 'image' || text.trim().length > 0)) {
        try {
          const answer = await askOpenModelWithFallback(model, {
            text: `${AI_PROMPT}\n\n${text ? 'Invoice text:\n' + text.slice(0, 12000) : 'The invoice is in the picture.'}`,
            image:
              input.kind === 'image'
                ? {
                    mediaType:
                      input.bytes[0] === 0x89
                        ? 'image/png'
                        : input.bytes[0] === 0xff
                          ? 'image/jpeg'
                          : 'image/webp',
                    data: Buffer.from(input.bytes).toString('base64'),
                  }
                : null,
            maxTokens: 1500,
            timeoutMs: 60_000,
          });
          candidate = candidateFromAi(answer.reply, ctx, answer.model);
        } catch (error) {
          request.log.warn({ err: error }, 'invoice import: AI reading failed');
        }
      }
      if (!candidate && text.trim().length > 20) candidate = candidateFromText(text, ctx);
      if (!candidate) {
        candidate = candidateFromText(
          '',
          ctx,
          input.kind === 'image' ? 'a photo' : 'a scanned PDF',
        );
        candidate.reviewReasons.unshift(
          model
            ? 'The AI could not read this document. Enter the fields by hand.'
            : 'No text could be read. Turn on the server AI to read scans, or enter the fields by hand.',
        );
      }
      const c = candidate;
      return tenantTx(request, async (tx) => {
        const r = await storeCandidates(tx, orgId, file, [c], {
          file: input.name,
          kind: input.kind,
        });
        await tx
          .update(invoiceImportFiles)
          .set({ status: 'extracted', attempts: 1, updatedAt: new Date() })
          .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.id, file.id)));
        return { file: input.name, status: 'extracted', fileId: file.id, ...r };
      });
    } catch (error) {
      request.log.warn({ err: error }, 'invoice import: file could not be read');
      return fail(
        error instanceof Error && /macro|sheet/i.test(error.message)
          ? error.message
          : 'The file could not be read. Check that it is not damaged.',
      );
    }
  }

  app.get(
    '/invoice-intel/files/:fileId',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'A file with its headers, sample rows and mapping',
        params: z.object({ fileId: UuidSchema }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [f] = await tx
          .select()
          .from(invoiceImportFiles)
          .where(
            and(
              eq(invoiceImportFiles.orgId, org.orgId),
              eq(invoiceImportFiles.id, request.params.fileId),
            ),
          )
          .limit(1);
        if (!f) throw problem('not_found');
        const sheet = f.sheet as { headers: string[]; rows: string[][] } | null;
        return {
          file: {
            id: f.id,
            batchId: f.batchId,
            fileName: f.fileName,
            kind: f.kind,
            status: f.status,
            rejectReason: f.rejectReason,
            mapping: f.mapping,
            byteSize: f.byteSize,
            sha256: f.sha256,
          },
          headers: sheet?.headers ?? [],
          sample: sheet?.rows.slice(0, 8) ?? [],
          rowCount: sheet?.rows.length ?? 0,
        };
      });
    },
  );

  app.put(
    '/invoice-intel/files/:fileId/mapping',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Set the column mapping for a spreadsheet and read it again',
        params: z.object({ fileId: UuidSchema }),
        body: z.object({
          mapping: MappingSchema,
          direction: z.enum(['auto', 'receivable', 'payable']).default('auto'),
          saveProfileName: z.string().trim().min(1).max(120).optional(),
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const mapping = request.body.mapping as Partial<Record<Field, number>>;
      if (!mappingReady(mapping))
        throw problem(
          'validation_failed',
          'Map at least the customer/vendor, the total, and the invoice number or date.',
        );
      return tenantTx(request, async (tx) => {
        const [f] = await tx
          .select()
          .from(invoiceImportFiles)
          .where(
            and(
              eq(invoiceImportFiles.orgId, org.orgId),
              eq(invoiceImportFiles.id, request.params.fileId),
            ),
          )
          .limit(1)
          .for('update');
        if (!f || !f.sheet) throw problem('not_found');
        const [batch] = await tx
          .select()
          .from(invoiceImportBatches)
          .where(
            and(eq(invoiceImportBatches.orgId, org.orgId), eq(invoiceImportBatches.id, f.batchId)),
          )
          .limit(1);
        const sheet = f.sheet as { headers: string[] };
        if (request.body.saveProfileName) {
          await tx.insert(invoiceImportProfiles).values({
            orgId: org.orgId,
            name: request.body.saveProfileName,
            sourcePlatform: batch?.sourcePlatform ?? 'other',
            headerSignature: headerSignature(sheet.headers),
            mapping,
            createdByUserId: request.auth?.userId ?? null,
          });
        }
        const dir: Direction =
          request.body.direction !== 'auto'
            ? request.body.direction
            : batch?.directionHint === 'receivable' || batch?.directionHint === 'payable'
              ? batch.directionHint
              : 'unknown';
        const confidence = Object.fromEntries(
          Object.keys(mapping).map((k) => [k, 0.97]),
        ) as Partial<Record<Field, number>>;
        const r = await extractSheetFile(tx, org.orgId, f, mapping, confidence, {
          directionHint: dir,
          defaultCurrency: await defaultCurrency(tx, org.orgId),
          today: today(),
          scanNote: null,
          platform: batch?.sourcePlatform ?? null,
        });
        await refreshBatch(tx, org.orgId, f.batchId);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice_import.mapped',
          resourceType: 'invoice_import_file',
          resourceId: f.id,
          after: { mapping, profile: request.body.saveProfileName ?? null },
        });
        return r;
      });
    },
  );

  app.get(
    '/invoice-intel/files/:fileId/original',
    {
      config: { permission: 'invoice:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Short-lived private link to the original file',
        params: z.object({ fileId: UuidSchema }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const f = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(invoiceImportFiles)
          .where(
            and(
              eq(invoiceImportFiles.orgId, org.orgId),
              eq(invoiceImportFiles.id, request.params.fileId),
            ),
          )
          .limit(1);
        return row ?? null;
      });
      if (!f?.storageKey) throw problem('not_found');
      const url = await app.storage.createDownloadUrl(f.storageKey, {
        expiresInSeconds: 300,
        fileName: f.fileName
          .split(' / ')
          .pop()!
          .replace(/[^A-Za-z0-9._-]+/g, '_')
          .slice(0, 120),
      } as never);
      return { url };
    },
  );

  app.get(
    '/invoice-intel/batches',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'Import history',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const items = await tx
          .select()
          .from(invoiceImportBatches)
          .where(eq(invoiceImportBatches.orgId, org.orgId))
          .orderBy(desc(invoiceImportBatches.createdAt))
          .limit(request.query.limit);
        const ids = items.map((b) => b.id);
        const files = ids.length
          ? await tx
              .select({
                id: invoiceImportFiles.id,
                batchId: invoiceImportFiles.batchId,
                fileName: invoiceImportFiles.fileName,
                kind: invoiceImportFiles.kind,
                status: invoiceImportFiles.status,
                rejectReason: invoiceImportFiles.rejectReason,
                byteSize: invoiceImportFiles.byteSize,
              })
              .from(invoiceImportFiles)
              .where(
                and(
                  eq(invoiceImportFiles.orgId, org.orgId),
                  inArray(invoiceImportFiles.batchId, ids),
                ),
              )
          : [];
        return {
          items: items.map((b) => ({ ...b, files: files.filter((f) => f.batchId === b.id) })),
        };
      });
    },
  );

  const RecordsQuery = z.object({
    review: z
      .enum(['needs_review', 'approved', 'rejected', 'duplicate', 'all'])
      .default('needs_review'),
    direction: z.enum(['receivable', 'payable', 'unknown']).optional(),
    batchId: UuidSchema.optional(),
    status: z
      .enum(['open', 'partially_paid', 'paid', 'overdue', 'void', 'disputed', 'written_off'])
      .optional(),
    q: z.string().trim().max(100).optional(),
    from: DateStr.optional(),
    to: DateStr.optional(),
    sort: z.enum(['date', 'total', 'party', 'confidence']).default('date'),
    ids: z.string().max(4000).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  });

  app.get(
    '/invoice-intel/records',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'Imported records: review queue and approved imports, with filters',
        querystring: RecordsQuery,
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { ids: rawIds, ...q } = request.query;
      const ids = rawIds
        ? rawIds
            .split(',')
            .filter((s) => UuidSchema.safeParse(s).success)
            .slice(0, 200)
        : undefined;
      return tenantTx(request, (tx) =>
        listRecords(tx, org.orgId, { ...q, ...(ids ? { ids } : {}) }),
      );
    },
  );

  app.get(
    '/invoice-intel/records/:id',
    {
      config: { permission: 'invoice:read' },
      schema: {
        tags: ['invoices'],
        summary: 'One imported record with field evidence and payments',
        params: z.object({ id: UuidSchema }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [rec] = await tx
          .select()
          .from(importedInvoices)
          .where(
            and(eq(importedInvoices.orgId, org.orgId), eq(importedInvoices.id, request.params.id)),
          )
          .limit(1);
        if (!rec) throw problem('not_found');
        const pays = await tx
          .select()
          .from(importedInvoicePayments)
          .where(
            and(
              eq(importedInvoicePayments.orgId, org.orgId),
              eq(importedInvoicePayments.importedInvoiceId, rec.id),
            ),
          )
          .orderBy(importedInvoicePayments.paidOn);
        const [file] = await tx
          .select({
            id: invoiceImportFiles.id,
            fileName: invoiceImportFiles.fileName,
            kind: invoiceImportFiles.kind,
            hasOriginal: sql<boolean>`${invoiceImportFiles.storageKey} is not null`,
          })
          .from(invoiceImportFiles)
          .where(
            and(eq(invoiceImportFiles.orgId, org.orgId), eq(invoiceImportFiles.id, rec.fileId)),
          )
          .limit(1);
        return { record: rec, payments: pays, file: file ?? null };
      });
    },
  );

  const EditSchema = z.object({
    direction: z.enum(['receivable', 'payable']).optional(),
    docType: z
      .enum(['invoice', 'credit_note', 'debit_note', 'receipt', 'statement', 'other'])
      .optional(),
    invoiceNumber: z.string().trim().min(1).max(120).nullable().optional(),
    partyName: z.string().trim().min(1).max(300).nullable().optional(),
    issueDate: DateStr.nullable().optional(),
    dueDate: DateStr.nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    subtotalMinor: Money.nullable().optional(),
    taxMinor: Money.nullable().optional(),
    totalMinor: Money.nullable().optional(),
    amountPaidMinor: z.number().int().min(0).max(1e13).optional(),
    category: z.string().trim().max(80).nullable().optional(),
    projectLabel: z.string().trim().max(200).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    costCode: z.string().trim().max(60).nullable().optional(),
    status: z.enum(['void', 'disputed', 'written_off']).nullable().optional(),
  });

  app.patch(
    '/invoice-intel/records/:id',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Correct fields on a record before approval',
        params: z.object({ id: UuidSchema }),
        body: EditSchema,
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        let rec;
        try {
          rec = await editRecord(
            tx,
            org.orgId,
            request.params.id,
            request.body,
            request.auth?.userId ?? null,
            today(),
            await defaultCurrency(tx, org.orgId),
          );
        } catch (error) {
          throw problem('conflict', (error as Error).message);
        }
        if (!rec) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice_import.record_corrected',
          resourceType: 'imported_invoice',
          resourceId: rec.id,
          after: request.body,
        });
        return { record: rec };
      });
    },
  );

  app.post(
    '/invoice-intel/records/:id/approve',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 240, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'Approve a record into Billing / Analysis',
        params: z.object({ id: UuidSchema }),
        body: z.object({ overrideReason: z.string().trim().min(3).max(500).optional() }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        try {
          const rec = await approveRecord(
            tx,
            org.orgId,
            request.params.id,
            request.auth?.userId ?? null,
            request.body.overrideReason ?? null,
          );
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'invoice_import.approved',
            resourceType: 'imported_invoice',
            resourceId: rec.id,
            after: {
              invoiceId: (rec.sourceMeta as { invoiceId?: string }).invoiceId ?? null,
              override: request.body.overrideReason ?? null,
            },
          });
          return { record: rec };
        } catch (error) {
          if (error instanceof ApprovalError) throw problem('conflict', error.message);
          throw error;
        }
      });
    },
  );

  app.post(
    '/invoice-intel/records/:id/reject',
    {
      config: { permission: 'invoice:write' },
      schema: {
        tags: ['invoices'],
        summary: 'Reject a record (kept for history)',
        params: z.object({ id: UuidSchema }),
        body: z.object({ reason: z.string().trim().max(300).default('') }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [rec] = await tx
          .update(importedInvoices)
          .set({
            reviewStatus: 'rejected',
            reviewedByUserId: request.auth?.userId ?? null,
            reviewedAt: new Date(),
            sourceMeta: sql`${importedInvoices.sourceMeta} || ${JSON.stringify({ rejectReason: request.body.reason })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(importedInvoices.orgId, org.orgId),
              eq(importedInvoices.id, request.params.id),
              sql`${importedInvoices.reviewStatus} <> 'approved'`,
            ),
          )
          .returning();
        if (!rec) throw problem('conflict', 'Approved records cannot be rejected.');
        await refreshBatch(tx, org.orgId, rec.batchId);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice_import.rejected',
          resourceType: 'imported_invoice',
          resourceId: rec.id,
          after: { reason: request.body.reason },
        });
        return { record: rec };
      });
    },
  );

  app.post(
    '/invoice-intel/records/bulk',
    {
      config: { permission: 'invoice:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary:
          'Approve or reject many records. Approve only takes records with nothing left to check.',
        body: z.object({
          ids: z.array(UuidSchema).min(1).max(500),
          action: z.enum(['approve_clean', 'reject']),
          reason: z.string().trim().max(300).default(''),
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const done: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const id of request.body.ids) {
        try {
          await tenantTx(request, async (tx) => {
            const [rec] = await tx
              .select({
                reasons: importedInvoices.reviewReasons,
                status: importedInvoices.reviewStatus,
                meta: importedInvoices.sourceMeta,
                batchId: importedInvoices.batchId,
              })
              .from(importedInvoices)
              .where(and(eq(importedInvoices.orgId, org.orgId), eq(importedInvoices.id, id)))
              .limit(1);
            if (!rec) throw new ApprovalError('Not found.');
            if (request.body.action === 'reject') {
              if (rec.status === 'approved') throw new ApprovalError('Already approved.');
              await tx
                .update(importedInvoices)
                .set({
                  reviewStatus: 'rejected',
                  reviewedByUserId: request.auth?.userId ?? null,
                  reviewedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(and(eq(importedInvoices.orgId, org.orgId), eq(importedInvoices.id, id)));
              await refreshBatch(tx, org.orgId, rec.batchId);
            } else {
              const conf = Number((rec.meta as { confidence?: number }).confidence ?? 0);
              if (rec.status !== 'needs_review')
                throw new ApprovalError(`Status is ${rec.status}.`);
              if (rec.reasons.length) throw new ApprovalError('Has items to check.');
              if (conf < 0.85) throw new ApprovalError('Confidence below 85%.');
              await approveRecord(tx, org.orgId, id, request.auth?.userId ?? null, null);
            }
          });
          done.push(id);
        } catch (error) {
          skipped.push({
            id,
            reason: error instanceof ApprovalError ? error.message : 'Could not be processed.',
          });
        }
      }
      await tenantTx(request, (tx) =>
        auditRequest(request, tx, {
          orgId: org.orgId,
          action: `invoice_import.bulk_${request.body.action}`,
          resourceType: 'imported_invoice',
          resourceId: org.orgId,
          after: { done: done.length, skipped: skipped.length },
        }),
      );
      return { done, skipped };
    },
  );

  app.post(
    '/invoice-intel/records/:id/payments',
    {
      config: { permission: 'invoice:write' },
      schema: {
        tags: ['invoices'],
        summary: 'Record a payment on an approved imported bill or credit',
        params: z.object({ id: UuidSchema }),
        body: z.object({
          paidOn: DateStr,
          amountMinor: z.number().int().min(1).max(1e13),
          method: z.string().trim().max(60).nullable().optional(),
          reference: z.string().trim().max(120).nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
        }),
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        try {
          const rec = await addPayment(
            tx,
            org.orgId,
            request.params.id,
            request.body,
            request.auth?.userId ?? null,
            today(),
          );
          if (!rec) throw problem('not_found');
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'invoice_import.payment_recorded',
            resourceType: 'imported_invoice',
            resourceId: rec.id,
            after: request.body,
          });
          return { record: rec };
        } catch (error) {
          if (error instanceof ApprovalError) throw problem('conflict', error.message);
          throw error;
        }
      });
    },
  );

  const RangeQuery = z.object({
    from: DateStr.optional(),
    to: DateStr.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  });
  const rangeOf = (q: { from?: string | undefined; to?: string | undefined }) => {
    const to = q.to ?? today();
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    return from <= to ? { from, to } : { from: to, to: from };
  };

  app.get(
    '/invoice-intel/analysis',
    {
      config: { permission: 'invoice:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary:
          'Analysis: KPIs, aging, trends, customers, vendors, projects, forecast and insights',
        querystring: RangeQuery,
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      return tenantTx(request, async (tx) => {
        const cur = request.query.currency ?? (await defaultCurrency(tx, org.orgId));
        const recs = await analysisRecords(tx, org.orgId);
        return {
          generatedAt: new Date().toISOString(),
          ...analyze(recs, rangeOf(request.query), today(), cur),
          drill: recs
            .map((r) => ({
              id: r.id,
              href: r.href,
              number: r.number,
              party: r.party,
              direction: r.direction,
              issueDate: r.issueDate,
              dueDate: r.dueDate,
              totalMinor: r.totalMinor,
              paidMinor: r.paidMinor,
              status: r.status,
              source: r.source,
            }))
            .slice(0, 20_000),
        };
      });
    },
  );

  app.get(
    '/invoice-intel/export.csv',
    {
      config: { permission: 'invoice:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['invoices'],
        summary: 'CSV for an accountant: imported records or the Analysis records',
        querystring: RangeQuery.extend({
          view: z.enum(['imports', 'analysis']).default('analysis'),
          review: z
            .enum(['needs_review', 'approved', 'rejected', 'duplicate', 'all'])
            .default('approved'),
        }),
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const rows: unknown[][] = [];
      await tenantTx(request, async (tx) => {
        if (request.query.view === 'imports') {
          const { items } = await listRecords(tx, org.orgId, {
            review: request.query.review,
            limit: 20_000,
            offset: 0,
            sort: 'date',
          });
          rows.push([
            'Record ID',
            'Review',
            'Sent/received',
            'Type',
            'Number',
            'Party',
            'Invoice date',
            'Due date',
            'Currency',
            'Subtotal',
            'Tax',
            'Total',
            'Paid',
            'Status',
            'Category',
            'Project',
            'Location',
            'Cost code',
            'Things to check',
          ]);
          for (const r of items)
            rows.push([
              r.id,
              r.reviewStatus,
              r.direction,
              r.docType,
              r.invoiceNumber,
              r.partyName,
              r.issueDate,
              r.dueDate,
              r.currency,
              cents(r.subtotalMinor),
              cents(r.taxMinor),
              cents(r.totalMinor),
              cents(r.amountPaidMinor),
              r.status,
              r.category,
              r.projectLabel,
              r.location,
              r.costCode,
              r.reviewReasons.join(' | '),
            ]);
        } else {
          const range = rangeOf(request.query);
          const recs = (await analysisRecords(tx, org.orgId)).filter(
            (r) => r.issueDate && r.issueDate >= range.from && r.issueDate <= range.to,
          );
          rows.push([
            'Source',
            'ID',
            'Sent/received',
            'Type',
            'Number',
            'Party',
            'Invoice date',
            'Due date',
            'Currency',
            'Total',
            'Paid',
            'Balance',
            'Status',
            'Category',
            'Project',
            'Location',
          ]);
          for (const r of recs)
            rows.push([
              r.source,
              r.id,
              r.direction,
              r.docType,
              r.number,
              r.party,
              r.issueDate,
              r.dueDate,
              r.currency,
              cents(r.totalMinor),
              cents(r.paidMinor),
              cents(Math.max(0, Math.abs(r.totalMinor) - r.paidMinor)),
              r.status,
              r.category,
              r.project,
              r.location,
            ]);
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'invoice_import.exported',
          resourceType: 'invoice_export',
          resourceId: org.orgId,
          after: { view: request.query.view, rows: rows.length - 1 },
        });
      });
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="curb-connect-${request.query.view}-${today()}.csv"`,
      );
      reply.header('cache-control', 'private, no-store');
      return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
    },
  );
};

const cents = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : (Number(v) / 100).toFixed(2);

export default invoiceIntelModule;
