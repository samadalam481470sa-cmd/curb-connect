// Invoice Intelligence service: the database side of import batches, files, records, review,
// approval and payments. Every query is scoped to one company (orgId) inside a tenant transaction.
import { lineAmountMinor } from '@fieldline/contracts';
import { and, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  importedInvoicePayments,
  importedInvoices,
  invoiceImportBatches,
  invoiceImportFiles,
  invoiceImportProfiles,
  invoiceLines,
  invoices,
  networkBills,
  payments,
} from '../../db/schema';
import { upsertInvoiceClient } from '../../services/invoice-clients';
import type { Rec } from './analysis';
import {
  addDays,
  autoMap,
  dedupeKey,
  deriveStatus,
  headerSignature,
  partyKey,
  rowsToCandidates,
  type Candidate,
  type Direction,
  type Field,
  type Mapping,
} from './extract';
import { findHeaderRow } from './intake';

export type Batch = typeof invoiceImportBatches.$inferSelect;
export type ImportFile = typeof invoiceImportFiles.$inferSelect;
export type ImportedRecord = typeof importedInvoices.$inferSelect;

export interface Sheet {
  headers: string[];
  rows: string[][];
  headerRow: number;
}

export function sheetFromRows(rows: string[][]): Sheet {
  const headerRow = findHeaderRow(rows);
  return {
    headers: (rows[headerRow] ?? []).map((h) => h.trim()),
    rows: rows.slice(headerRow + 1),
    headerRow,
  };
}

export function mappingReady(m: Mapping): boolean {
  return (
    m.total !== undefined &&
    m.partyName !== undefined &&
    (m.invoiceNumber !== undefined || m.issueDate !== undefined)
  );
}

/** A saved profile for these exact headers wins over auto-mapping. */
export async function mappingFor(tx: Tx, orgId: string, headers: string[]) {
  const auto = autoMap(headers);
  const sig = headerSignature(headers);
  const [profile] = await tx
    .select()
    .from(invoiceImportProfiles)
    .where(
      and(eq(invoiceImportProfiles.orgId, orgId), eq(invoiceImportProfiles.headerSignature, sig)),
    )
    .orderBy(desc(invoiceImportProfiles.updatedAt))
    .limit(1);
  if (profile) {
    const mapping = profile.mapping as Mapping;
    const confidence = Object.fromEntries(Object.keys(mapping).map((k) => [k, 0.98])) as Partial<
      Record<Field, number>
    >;
    return { ...auto, mapping, confidence, profileName: profile.name };
  }
  return { ...auto, profileName: null as string | null };
}

/** What earlier approvals taught: the category users chose for a party, by direction. */
async function learnedCategories(tx: Tx, orgId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      direction: importedInvoices.direction,
      partyKey: importedInvoices.partyKey,
      category: importedInvoices.category,
    })
    .from(importedInvoices)
    .where(
      and(
        eq(importedInvoices.orgId, orgId),
        eq(importedInvoices.reviewStatus, 'approved'),
        sql`${importedInvoices.sourceMeta} ? 'categoryCorrected'`,
      ),
    )
    .orderBy(desc(importedInvoices.reviewedAt))
    .limit(2000);
  const map = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.direction}|${r.partyKey}`;
    if (r.partyKey && r.category && !map.has(k)) map.set(k, r.category);
  }
  return map;
}

/** Store candidates for a file. Retrying the same file replaces only records not yet decided. */
export async function storeCandidates(
  tx: Tx,
  orgId: string,
  file: ImportFile,
  candidates: Candidate[],
  meta: Record<string, unknown>,
) {
  await tx
    .delete(importedInvoices)
    .where(
      and(
        eq(importedInvoices.orgId, orgId),
        eq(importedInvoices.fileId, file.id),
        eq(importedInvoices.reviewStatus, 'needs_review'),
      ),
    );
  const learned = await learnedCategories(tx, orgId);
  const keys = [...new Set(candidates.map((c) => c.dedupeKey).filter(Boolean) as string[])];
  const existing = keys.length
    ? await tx
        .select({
          id: importedInvoices.id,
          dedupeKey: importedInvoices.dedupeKey,
          fileId: importedInvoices.fileId,
        })
        .from(importedInvoices)
        .where(
          and(
            eq(importedInvoices.orgId, orgId),
            inArray(importedInvoices.dedupeKey, keys),
            ne(importedInvoices.reviewStatus, 'rejected'),
          ),
        )
    : [];
  const byKey = new Map(
    existing.filter((e) => e.fileId !== file.id).map((e) => [e.dedupeKey!, e.id]),
  );
  // Customer invoices already in Billing with the same number.
  const numbers = candidates
    .filter((c) => c.direction === 'receivable' && c.invoiceNumber)
    .map((c) => c.invoiceNumber!);
  const native = numbers.length
    ? await tx
        .select({ id: invoices.id, number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.orgId, orgId), inArray(invoices.number, numbers)))
    : [];
  const nativeByNumber = new Map(native.map((n) => [n.number, n.id]));
  const seenInFile = new Set<string>();
  let dup = 0;
  let review = 0;
  for (const c of candidates) {
    const reasons = [...c.reviewReasons];
    let reviewStatus: 'needs_review' | 'duplicate' = 'needs_review';
    let duplicateOf: string | null = null;
    const learnedCat = c.partyKey ? learned.get(`${c.direction}|${c.partyKey}`) : undefined;
    if (learnedCat && (c.fields.category?.confidence ?? 0) < 0.9) {
      c.category = learnedCat;
      c.fields.category = {
        value: learnedCat,
        confidence: 0.9,
        source: 'your earlier corrections for this party',
        raw: '',
      };
    }
    if (c.dedupeKey && byKey.has(c.dedupeKey)) {
      reviewStatus = 'duplicate';
      duplicateOf = byKey.get(c.dedupeKey)!;
      reasons.unshift('Already imported: same party and invoice number.');
      dup += 1;
    } else if (c.dedupeKey && seenInFile.has(c.dedupeKey)) {
      reasons.unshift('Appears twice in this file.');
    } else if (
      c.direction === 'receivable' &&
      c.invoiceNumber &&
      nativeByNumber.has(c.invoiceNumber)
    ) {
      reviewStatus = 'duplicate';
      reasons.unshift(`Invoice ${c.invoiceNumber} already exists in Billing.`);
      dup += 1;
    }
    if (c.dedupeKey) seenInFile.add(c.dedupeKey);
    if (reviewStatus === 'needs_review' && reasons.length) review += 1;
    await tx
      .insert(importedInvoices)
      .values({
        orgId,
        batchId: file.batchId,
        fileId: file.id,
        rowIndex: c.rowIndex,
        direction: c.direction,
        docType: c.docType,
        invoiceNumber: c.invoiceNumber,
        partyName: c.partyName,
        partyKey: c.partyKey,
        issueDate: c.issueDate,
        dueDate: c.dueDate,
        currency: c.currency,
        subtotalMinor: c.subtotalMinor,
        taxMinor: c.taxMinor,
        discountMinor: c.discountMinor,
        shippingMinor: c.shippingMinor,
        totalMinor: c.totalMinor,
        calculatedTotalMinor: c.calculatedTotalMinor,
        amountPaidMinor: c.amountPaidMinor,
        sourceStatus: c.sourceStatus,
        status: c.status,
        category: c.category,
        projectLabel: c.projectLabel,
        location: c.location,
        costCode: c.costCode,
        reviewStatus,
        reviewReasons: reasons.slice(0, 20),
        fields: c.fields,
        lines: c.lines.slice(0, 500),
        sourceMeta: {
          ...meta,
          confidence: c.confidence,
          memo: c.memo,
          partyEmail: c.partyEmail,
          paidDate: c.paidDate,
        },
        dedupeKey: c.dedupeKey,
        duplicateOfId: duplicateOf,
      })
      .onConflictDoNothing();
  }
  return { records: candidates.length, duplicates: dup, needsReview: review };
}

export async function refreshBatch(tx: Tx, orgId: string, batchId: string) {
  const [counts] = await tx
    .select({
      records: sql<number>`count(*)::int`,
      review: sql<number>`count(*) filter (where ${importedInvoices.reviewStatus} = 'needs_review')::int`,
      approved: sql<number>`count(*) filter (where ${importedInvoices.reviewStatus} = 'approved')::int`,
      dups: sql<number>`count(*) filter (where ${importedInvoices.reviewStatus} = 'duplicate')::int`,
    })
    .from(importedInvoices)
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.batchId, batchId)));
  const [files] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      rejected: sql<number>`count(*) filter (where ${invoiceImportFiles.status} in ('rejected','failed','duplicate_file'))::int`,
      mapping: sql<number>`count(*) filter (where ${invoiceImportFiles.status} = 'needs_mapping')::int`,
    })
    .from(invoiceImportFiles)
    .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.batchId, batchId)));
  const c = counts!;
  const f = files!;
  const status =
    f.mapping > 0
      ? 'needs_mapping'
      : c.review > 0
        ? 'needs_review'
        : f.rejected > 0 || c.dups > 0
          ? 'completed_with_warnings'
          : 'completed';
  await tx
    .update(invoiceImportBatches)
    .set({
      fileCount: f.total,
      rejectedCount: f.rejected,
      recordCount: c.records,
      needsReviewCount: c.review,
      importedCount: c.approved,
      duplicateCount: c.dups,
      status,
      finishedAt: status.startsWith('completed') ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(invoiceImportBatches.orgId, orgId), eq(invoiceImportBatches.id, batchId)));
}

export async function extractSheetFile(
  tx: Tx,
  orgId: string,
  file: ImportFile,
  mapping: Mapping,
  confidence: Partial<Record<Field, number>>,
  ctx: {
    directionHint: Direction;
    defaultCurrency: string;
    today: string;
    scanNote: string | null;
    platform: string | null;
  },
) {
  const sheet = file.sheet as Sheet;
  const candidates = rowsToCandidates(
    sheet.rows.map((row, i) => ({ index: i + sheet.headerRow + 1, row })),
    {
      headers: sheet.headers,
      mapping,
      mapConfidence: confidence,
      directionHint: ctx.directionHint,
      defaultCurrency: ctx.defaultCurrency,
      today: ctx.today,
      scanNote: ctx.scanNote,
    },
  );
  const result = await storeCandidates(tx, orgId, file, candidates, {
    file: file.fileName,
    platform: ctx.platform,
    scan: ctx.scanNote ?? 'clean',
  });
  await tx
    .update(invoiceImportFiles)
    .set({
      status: 'extracted',
      mapping,
      attempts: sql`${invoiceImportFiles.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(invoiceImportFiles.orgId, orgId), eq(invoiceImportFiles.id, file.id)));
  return result;
}

export interface RecordEdit {
  direction?: 'receivable' | 'payable';
  docType?: 'invoice' | 'credit_note' | 'debit_note' | 'receipt' | 'statement' | 'other';
  invoiceNumber?: string | null;
  partyName?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  currency?: string;
  subtotalMinor?: number | null;
  taxMinor?: number | null;
  totalMinor?: number | null;
  amountPaidMinor?: number;
  category?: string | null;
  projectLabel?: string | null;
  location?: string | null;
  costCode?: string | null;
  status?: 'void' | 'disputed' | 'written_off' | null;
}

/** Apply a person's corrections, keep the old values, and re-check what still needs review. */
export async function editRecord(
  tx: Tx,
  orgId: string,
  id: string,
  edit: RecordEdit,
  userId: string | null,
  today: string,
  defaultCurrency: string,
) {
  const [rec] = await tx
    .select()
    .from(importedInvoices)
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .limit(1);
  if (!rec) return null;
  if (rec.reviewStatus === 'approved')
    throw new Error('Approved records cannot be edited here. Record a payment or void it instead.');
  const fields = { ...(rec.fields as Record<string, unknown>) };
  const corrections = [...((rec.sourceMeta as { corrections?: unknown[] }).corrections ?? [])];
  const next = { ...rec };
  for (const [k, v] of Object.entries(edit)) {
    if (v === undefined || k === 'status') continue;
    const before = (rec as Record<string, unknown>)[k];
    if (before === v) continue;
    corrections.push({ field: k, before, after: v, by: userId, at: new Date().toISOString() });
    (next as Record<string, unknown>)[k] = v;
    const fk = k.replace(/Minor$/, '').replace('projectLabel', 'project') as string;
    fields[fk] = { value: v, confidence: 1, source: 'corrected by a person', raw: String(v ?? '') };
  }
  const pk = partyKey(next.partyName);
  const total = next.totalMinor === null ? null : Number(next.totalMinor);
  const reasons: string[] = [];
  if (!next.invoiceNumber) reasons.push('No invoice number.');
  if (!next.partyName) reasons.push('No customer or vendor name.');
  if (total === null) reasons.push('No total.');
  if (!next.issueDate) reasons.push('No invoice date.');
  if (next.direction === 'unknown')
    reasons.push('Not clear if this was sent to a customer or received from a vendor.');
  if (next.issueDate && next.dueDate && next.dueDate < next.issueDate)
    reasons.push('Due date is before the invoice date.');
  if (next.currency !== defaultCurrency)
    reasons.push(`Currency is ${next.currency}, not ${defaultCurrency}. Totals are not converted.`);
  const sub = next.subtotalMinor === null ? null : Number(next.subtotalMinor);
  const calc =
    sub === null
      ? null
      : sub +
        Number(next.taxMinor ?? 0) -
        Math.abs(Number(next.discountMinor ?? 0)) +
        Number(next.shippingMinor ?? 0);
  if (calc !== null && total !== null && Math.abs(calc - total) > 1)
    reasons.push(
      `Parts add up to ${(calc / 100).toFixed(2)} but the total is ${(total / 100).toFixed(2)}.`,
    );
  const status =
    edit.status ??
    deriveStatus(next.sourceStatus, total, Number(next.amountPaidMinor), next.dueDate, today);
  const key = dedupeKey(next.direction as Direction, pk, next.invoiceNumber, next.issueDate, total);
  const [updated] = await tx
    .update(importedInvoices)
    .set({
      direction: next.direction,
      docType: next.docType,
      invoiceNumber: next.invoiceNumber,
      partyName: next.partyName,
      partyKey: pk,
      issueDate: next.issueDate,
      dueDate: next.dueDate,
      currency: next.currency,
      subtotalMinor: next.subtotalMinor,
      taxMinor: next.taxMinor,
      totalMinor: next.totalMinor,
      calculatedTotalMinor: calc,
      amountPaidMinor: next.amountPaidMinor,
      category: next.category,
      projectLabel: next.projectLabel,
      location: next.location,
      costCode: next.costCode,
      status,
      fields,
      reviewReasons: reasons,
      reviewStatus: rec.reviewStatus === 'rejected' ? 'needs_review' : rec.reviewStatus,
      dedupeKey: key,
      sourceMeta: {
        ...(rec.sourceMeta as Record<string, unknown>),
        corrections: corrections.slice(-100),
        ...(edit.category !== undefined && edit.category !== rec.category
          ? { categoryCorrected: true }
          : {}),
      },
      revision: sql`${importedInvoices.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .returning();
  return updated ?? null;
}

const INVOICE_STATUS: Record<
  string,
  {
    status: 'issued' | 'partially_paid' | 'paid' | 'void' | 'uncollectible';
    delivery: 'sent' | 'paid' | 'void' | 'disputed';
  }
> = {
  open: { status: 'issued', delivery: 'sent' },
  overdue: { status: 'issued', delivery: 'sent' },
  partially_paid: { status: 'partially_paid', delivery: 'sent' },
  paid: { status: 'paid', delivery: 'paid' },
  void: { status: 'void', delivery: 'void' },
  disputed: { status: 'issued', delivery: 'disputed' },
  written_off: { status: 'uncollectible', delivery: 'sent' },
};

export class ApprovalError extends Error {}

/**
 * Approve one record. Customer invoices are added to Billing (the existing invoices list) as
 * imported history: nothing is emailed and no ledger entries are made. Vendor bills and credit
 * notes stay in the imported store, where Analysis reads them. Safe to call twice.
 */
export async function approveRecord(
  tx: Tx,
  orgId: string,
  id: string,
  userId: string | null,
  override: string | null,
) {
  const [rec] = await tx
    .select()
    .from(importedInvoices)
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .limit(1)
    .for('update');
  if (!rec) throw new ApprovalError('Record not found.');
  if (rec.reviewStatus === 'approved') return rec;
  const blocking = rec.reviewReasons.filter((r) =>
    /^No (invoice number|customer|total)|Not clear if/.test(r),
  );
  if (blocking.length) throw new ApprovalError(`Fix these first: ${blocking.join(' ')}`);
  if (rec.reviewStatus === 'duplicate' && !override)
    throw new ApprovalError('This looks like a duplicate. Give a reason to import it anyway.');
  if (rec.dedupeKey) {
    const [clash] = await tx
      .select({ id: importedInvoices.id })
      .from(importedInvoices)
      .where(
        and(
          eq(importedInvoices.orgId, orgId),
          eq(importedInvoices.dedupeKey, rec.dedupeKey),
          eq(importedInvoices.reviewStatus, 'approved'),
        ),
      )
      .limit(1);
    if (clash)
      throw new ApprovalError(
        'A record with the same party and invoice number is already approved.',
      );
  }
  const meta = { ...(rec.sourceMeta as Record<string, unknown>) };
  const total = Number(rec.totalMinor ?? 0);
  if (rec.direction === 'receivable' && rec.docType === 'invoice' && total > 0) {
    let number = rec.invoiceNumber!.slice(0, 60);
    const [taken] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.number, number)))
      .limit(1);
    if (taken) {
      if (!override) throw new ApprovalError(`Invoice ${number} already exists in Billing.`);
      number = `${number}-IMP`.slice(0, 60);
    }
    const email =
      typeof meta.partyEmail === 'string' && /@/.test(meta.partyEmail)
        ? meta.partyEmail
        : undefined;
    const customerId = await upsertInvoiceClient(tx, orgId, {
      name: rec.partyName!,
      ...(email ? { email } : {}),
    });
    const tax = Math.min(Math.max(0, Number(rec.taxMinor ?? 0)), total);
    const mapped = INVOICE_STATUS[rec.status] ?? INVOICE_STATUS.open!;
    const paid = rec.status === 'paid' ? total : Math.min(Number(rec.amountPaidMinor), total);
    const now = new Date();
    const [inv] = await tx
      .insert(invoices)
      .values({
        orgId,
        number,
        kind: 'standalone',
        status: mapped.status,
        deliveryStatus: mapped.delivery,
        recipientOrgId: null,
        customerId,
        recipientName: rec.partyName,
        currency: rec.currency,
        subtotalMinor: total - tax,
        taxMinor: tax,
        totalMinor: total,
        amountPaidMinor: paid,
        issuedOn: rec.issueDate,
        dueOn: rec.dueDate ?? rec.issueDate,
        issuedAt: now,
        sentAt: now,
        voidedAt: rec.status === 'void' ? now : null,
        memo: typeof meta.memo === 'string' ? meta.memo.slice(0, 1000) : null,
        recipientEmail: email ?? null,
        billingAddress: {
          billTo: { name: rec.partyName, ...(email ? { email } : {}) },
          title: 'Invoice',
          importedFrom: 'invoice-intelligence',
          importedRecordId: rec.id,
        },
      })
      .returning({ id: invoices.id });
    const lines = (
      rec.lines as {
        description: string;
        quantity: number | null;
        rateMinor: number | null;
        amountMinor: number | null;
      }[]
    ).filter((l) => l.description || l.amountMinor);
    const useLines =
      lines.length &&
      lines.every((l) => l.amountMinor !== null) &&
      lines.reduce((s, l) => s + l.amountMinor!, 0) === total - tax
        ? lines.map((l) => ({
            description: (l.description || 'Item').slice(0, 500),
            quantity: '1',
            unitPriceMinor: l.amountMinor!,
          }))
        : [{ description: 'Imported invoice', quantity: '1', unitPriceMinor: total - tax }];
    await tx.insert(invoiceLines).values(
      useLines.map((line, index) => ({
        orgId,
        invoiceId: inv!.id,
        sortOrder: index,
        description: line.description,
        quantity: line.quantity,
        unit: 'each' as const,
        unitPriceMinor: line.unitPriceMinor,
        amountMinor: lineAmountMinor(line.quantity, line.unitPriceMinor),
      })),
    );
    meta.invoiceId = inv!.id;
  }
  // A paid record with a paid date becomes a dated payment, so Analysis can count the cash.
  const paidDate = typeof meta.paidDate === 'string' ? meta.paidDate : null;
  if (paidDate && Number(rec.amountPaidMinor) > 0) {
    await tx.insert(importedInvoicePayments).values({
      orgId,
      importedInvoiceId: rec.id,
      paidOn: paidDate,
      amountMinor: Number(rec.amountPaidMinor),
      source: 'import',
      createdByUserId: userId,
    });
  }
  const [updated] = await tx
    .update(importedInvoices)
    .set({
      reviewStatus: 'approved',
      duplicateOverrideReason: override,
      reviewedByUserId: userId,
      reviewedAt: new Date(),
      sourceMeta: meta,
      revision: sql`${importedInvoices.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .returning();
  await refreshBatch(tx, orgId, rec.batchId);
  return updated!;
}

export interface RecordQuery {
  review?: 'needs_review' | 'approved' | 'rejected' | 'duplicate' | 'all';
  direction?: 'receivable' | 'payable' | 'unknown';
  batchId?: string;
  status?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: 'date' | 'total' | 'party' | 'confidence';
  ids?: string[];
  limit: number;
  offset: number;
}

export async function listRecords(tx: Tx, orgId: string, q: RecordQuery) {
  const where = [eq(importedInvoices.orgId, orgId)];
  if (q.review && q.review !== 'all') where.push(eq(importedInvoices.reviewStatus, q.review));
  if (q.direction) where.push(eq(importedInvoices.direction, q.direction));
  if (q.batchId) where.push(eq(importedInvoices.batchId, q.batchId));
  if (q.status) where.push(eq(importedInvoices.status, q.status));
  if (q.from) where.push(sql`${importedInvoices.issueDate} >= ${q.from}`);
  if (q.to) where.push(sql`${importedInvoices.issueDate} <= ${q.to}`);
  if (q.ids?.length) where.push(inArray(importedInvoices.id, q.ids));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    where.push(
      or(
        ilike(importedInvoices.partyName, like),
        ilike(importedInvoices.invoiceNumber, like),
        ilike(importedInvoices.projectLabel, like),
        ilike(importedInvoices.category, like),
      )!,
    );
  }
  const order =
    q.sort === 'total'
      ? desc(importedInvoices.totalMinor)
      : q.sort === 'party'
        ? importedInvoices.partyName
        : q.sort === 'confidence'
          ? sql`(${importedInvoices.sourceMeta}->>'confidence')::numeric asc nulls first`
          : desc(importedInvoices.issueDate);
  const rows = await tx
    .select()
    .from(importedInvoices)
    .where(and(...where))
    .orderBy(order, desc(importedInvoices.createdAt))
    .limit(q.limit)
    .offset(q.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(importedInvoices)
    .where(and(...where));
  return { items: rows, total: count?.n ?? 0 };
}

/** All validated records for Analysis: Billing invoices (including approved imports), approved
 *  imported bills and credits, and bills from connected companies. */
export async function analysisRecords(tx: Tx, orgId: string): Promise<Rec[]> {
  const out: Rec[] = [];
  const inv = await tx
    .select({
      id: invoices.id,
      number: invoices.number,
      name: invoices.recipientName,
      issuedOn: invoices.issuedOn,
      dueOn: invoices.dueOn,
      total: invoices.totalMinor,
      paid: invoices.amountPaidMinor,
      status: invoices.status,
      currency: invoices.currency,
      billing: invoices.billingAddress,
      updatedAt: invoices.updatedAt,
    })
    .from(invoices)
    .where(eq(invoices.orgId, orgId))
    .limit(50_000);
  const pays = await tx
    .select({
      invoiceId: payments.invoiceId,
      amount: payments.amountMinor,
      refunded: payments.refundedMinor,
      receivedAt: payments.receivedAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(eq(payments.orgId, orgId), inArray(payments.status, ['succeeded', 'partially_refunded'])),
    );
  const payByInvoice = new Map<string, { date: string; amountMinor: number }[]>();
  for (const p of pays) {
    const list = payByInvoice.get(p.invoiceId) ?? [];
    list.push({
      date: (p.receivedAt ?? p.createdAt).toISOString().slice(0, 10),
      amountMinor: Number(p.amount) - Number(p.refunded),
    });
    payByInvoice.set(p.invoiceId, list);
  }
  const imported = await tx
    .select()
    .from(importedInvoices)
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.reviewStatus, 'approved')))
    .limit(50_000);
  const impPays = await tx
    .select()
    .from(importedInvoicePayments)
    .where(eq(importedInvoicePayments.orgId, orgId));
  const impPayBy = new Map<string, { date: string; amountMinor: number }[]>();
  for (const p of impPays)
    impPayBy.set(p.importedInvoiceId, [
      ...(impPayBy.get(p.importedInvoiceId) ?? []),
      { date: p.paidOn, amountMinor: Number(p.amountMinor) },
    ]);
  const importedByInvoice = new Map(
    imported
      .filter((r) => (r.sourceMeta as { invoiceId?: string }).invoiceId)
      .map((r) => [(r.sourceMeta as { invoiceId: string }).invoiceId, r]),
  );

  for (const i of inv) {
    const src = importedByInvoice.get(i.id);
    const native = payByInvoice.get(i.id) ?? [];
    const importedPays = src ? (impPayBy.get(src.id) ?? []) : [];
    out.push({
      id: i.id,
      source: 'invoice',
      direction: 'receivable',
      docType: 'invoice',
      number: i.number,
      party: i.name ?? 'Unknown',
      issueDate: i.issuedOn,
      dueDate: i.dueOn,
      totalMinor: Number(i.total),
      paidMinor: Number(i.paid),
      status:
        i.status === 'issued' &&
        i.dueOn &&
        i.dueOn < new Date().toISOString().slice(0, 10) &&
        Number(i.paid) < Number(i.total)
          ? 'overdue'
          : i.status,
      category: src?.category ?? null,
      project: src?.projectLabel ?? null,
      location: src?.location ?? null,
      currency: i.currency,
      payments: [...native, ...importedPays],
      href: `/billing/invoices/${i.id}`,
    });
  }
  for (const r of imported) {
    if ((r.sourceMeta as { invoiceId?: string }).invoiceId) continue;
    if (r.direction === 'unknown') continue;
    out.push({
      id: r.id,
      source: 'imported',
      direction: r.direction as 'receivable' | 'payable',
      docType: r.docType as Rec['docType'],
      number: r.invoiceNumber ?? '',
      party: r.partyName ?? 'Unknown',
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      totalMinor: Number(r.totalMinor ?? 0),
      paidMinor: Number(r.amountPaidMinor),
      status: r.status,
      category: r.category,
      project: r.projectLabel,
      location: r.location,
      currency: r.currency,
      payments: impPayBy.get(r.id) ?? [],
      href: `/billing/imports?record=${r.id}`,
    });
  }
  const nb = await tx
    .select({
      id: networkBills.id,
      number: networkBills.number,
      issuer: networkBills.issuerName,
      project: networkBills.projectName,
      issuedOn: networkBills.issuedOn,
      dueOn: networkBills.dueOn,
      total: networkBills.totalMinor,
      status: networkBills.status,
      paidAt: networkBills.paidAt,
      currency: networkBills.currency,
    })
    .from(networkBills)
    .where(eq(networkBills.orgId, orgId))
    .limit(50_000);
  for (const b of nb) {
    const paid = b.status === 'paid' ? Number(b.total) : 0;
    out.push({
      id: b.id,
      source: 'network_bill',
      direction: 'payable',
      docType: 'invoice',
      number: b.number,
      party: b.issuer,
      issueDate: b.issuedOn,
      dueDate: b.dueOn,
      totalMinor: Number(b.total),
      paidMinor: paid,
      status: b.status === 'received' || b.status === 'approved' ? 'open' : b.status,
      category: null,
      project: b.project,
      location: null,
      currency: b.currency,
      payments:
        b.paidAt && paid ? [{ date: b.paidAt.toISOString().slice(0, 10), amountMinor: paid }] : [],
      href: '/billing',
    });
  }
  return out;
}

export async function addPayment(
  tx: Tx,
  orgId: string,
  id: string,
  p: {
    paidOn: string;
    amountMinor: number;
    method?: string | null;
    reference?: string | null;
    note?: string | null;
  },
  userId: string | null,
  today: string,
) {
  const [rec] = await tx
    .select()
    .from(importedInvoices)
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .limit(1)
    .for('update');
  if (!rec) return null;
  if (rec.reviewStatus !== 'approved')
    throw new ApprovalError('Approve the record before recording payments.');
  if ((rec.sourceMeta as { invoiceId?: string }).invoiceId)
    throw new ApprovalError('This invoice is in Billing. Record its payment there.');
  const total = Math.abs(Number(rec.totalMinor ?? 0));
  const paid = Number(rec.amountPaidMinor) + p.amountMinor;
  if (paid > total) throw new ApprovalError('The payment is more than the balance due.');
  await tx.insert(importedInvoicePayments).values({
    orgId,
    importedInvoiceId: id,
    paidOn: p.paidOn,
    amountMinor: p.amountMinor,
    method: p.method ?? null,
    reference: p.reference ?? null,
    note: p.note ?? null,
    source: 'manual',
    createdByUserId: userId,
  });
  const status = deriveStatus(
    rec.sourceStatus === 'void' ? 'void' : null,
    total,
    paid,
    rec.dueDate,
    today,
  );
  const [updated] = await tx
    .update(importedInvoices)
    .set({
      amountPaidMinor: paid,
      status,
      revision: sql`${importedInvoices.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(importedInvoices.orgId, orgId), eq(importedInvoices.id, id)))
    .returning();
  return updated ?? null;
}

export { addDays };
