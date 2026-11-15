// Price-book selection, staleness/conflict detection and CSV import (CP-057, OPS-065, ADD-060).
//   Selection: the narrowest active service area whose boundary covers the point and that has an
//   approved, effective revision wins. With no covering area the company-wide default book is a
//   controlled, ALWAYS DISCLOSED broader fallback. No book at all -> price_unavailable.
//   Staleness: an item whose price date (or the revision's effective date) is older than the
//   revision's max_price_age_days, or a revision past effective_to, is stale.
//   Conflicts: equally narrow matching books that price the same code differently.
//   Stale or conflicting prices block a firm quote (gating) and ask for a human price check.
import {
  COST_COMPONENTS,
  type ImportReport,
  PRICE_ITEM_CATEGORIES,
  PRICING_UNITS,
  type PriceSelection,
  type ProductLine,
} from '@fieldline/contracts';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { priceBookRevisions, priceBooks, priceItems } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

export type PriceBookRow = typeof priceBooks.$inferSelect;
export type RevisionRow = typeof priceBookRevisions.$inferSelect;
export type ItemRow = typeof priceItems.$inferSelect;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** The latest approved revision of a book that is effective on `today`. */
export async function activeRevision(tx: Tx, orgId: string, bookId: string, today: string): Promise<RevisionRow | null> {
  const [row] = await tx
    .select()
    .from(priceBookRevisions)
    .where(
      and(
        eq(priceBookRevisions.orgId, orgId),
        eq(priceBookRevisions.priceBookId, bookId),
        eq(priceBookRevisions.status, 'approved'),
        sql`(${priceBookRevisions.effectiveFrom} is null or ${priceBookRevisions.effectiveFrom} <= ${today}::date)`,
      ),
    )
    .orderBy(desc(priceBookRevisions.revisionNumber))
    .limit(1);
  return row ?? null;
}

export async function revisionItems(tx: Tx, orgId: string, revisionId: string): Promise<ItemRow[]> {
  return tx
    .select()
    .from(priceItems)
    .where(and(eq(priceItems.orgId, orgId), eq(priceItems.priceBookRevisionId, revisionId)))
    .orderBy(asc(priceItems.sortOrder), asc(priceItems.code));
}

export function staleItems(rev: RevisionRow, items: ItemRow[], today: string): PriceSelection['stale'] {
  const out: PriceSelection['stale'] = [];
  const revisionExpired = rev.effectiveTo !== null && rev.effectiveTo < today;
  for (const it of items) {
    const asOf = it.priceDate ?? rev.effectiveFrom ?? (rev.approvedAt ? isoDate(rev.approvedAt) : null);
    if (revisionExpired || asOf === null || daysBetween(asOf, today) > rev.maxPriceAgeDays) {
      out.push({ code: it.code, priceDate: it.priceDate, maxAgeDays: rev.maxPriceAgeDays });
    }
  }
  return out;
}

export interface SelectedPriceBook {
  book: PriceBookRow;
  revision: RevisionRow;
  items: ItemRow[];
  selection: PriceSelection;
}

interface Candidate {
  book: PriceBookRow;
  serviceArea: { id: string; name: string } | null;
  area: number | null;
}

export async function selectPriceBook(
  tx: Tx,
  input: { orgId: string; productLine: ProductLine; point: { lon: number; lat: number } | null; revisionId?: string | null; today: string },
): Promise<SelectedPriceBook> {
  const { orgId, today } = input;
  if (input.revisionId) {
    const [rev] = await tx
      .select()
      .from(priceBookRevisions)
      .where(and(eq(priceBookRevisions.orgId, orgId), eq(priceBookRevisions.id, input.revisionId)));
    if (!rev) throw problem('not_found', 'Price-book revision not found.');
    if (rev.status !== 'approved') throw problem('price_unavailable', 'Only an approved price-book revision can price an estimate.');
    const [book] = await tx.select().from(priceBooks).where(and(eq(priceBooks.orgId, orgId), eq(priceBooks.id, rev.priceBookId)));
    if (book!.productLine !== input.productLine) throw problem('validation_failed', 'The price book is for another product line.');
    const items = await revisionItems(tx, orgId, rev.id);
    return {
      book: book!,
      revision: rev,
      items,
      selection: {
        priceBookId: book!.id,
        priceBookRevisionId: rev.id,
        match: 'explicit',
        serviceArea: null,
        fallback: false,
        disclosure: null,
        stale: staleItems(rev, items, today),
        conflicts: [],
      },
    };
  }

  const pointSql = input.point ? sql`ST_SetSRID(ST_MakePoint(${input.point.lon}, ${input.point.lat}), 4326)` : sql`null::geometry`;
  const rows = await tx.execute<{ id: string; service_area_id: string | null; area_name: string | null; area: number | null; covers: boolean | null }>(sql`
    select b.id, b.service_area_id, sa.name as area_name,
           case when sa.id is null then null else ST_Area(sa.boundary::geography) end as area,
           case when sa.id is null then null else ST_Covers(sa.boundary, ${pointSql}) end as covers
    from price_books b
    left join service_areas sa on sa.org_id = b.org_id and sa.id = b.service_area_id and sa.active
    where b.org_id = ${orgId} and b.status = 'active' and b.product_line = ${input.productLine}
    order by b.name`);
  const all = [...rows];
  const books = new Map<string, PriceBookRow>();
  for (const b of await tx.select().from(priceBooks).where(eq(priceBooks.orgId, orgId))) books.set(b.id, b);

  const withRevision: (Candidate & { revision: RevisionRow })[] = [];
  for (const r of all) {
    if (r.service_area_id !== null && r.area_name === null) continue; // inactive area
    if (r.service_area_id !== null && r.covers !== true) continue;
    const revision = await activeRevision(tx, orgId, r.id, today);
    if (!revision) continue;
    withRevision.push({
      book: books.get(r.id)!,
      serviceArea: r.service_area_id ? { id: r.service_area_id, name: r.area_name! } : null,
      area: r.area === null ? null : Number(r.area),
      revision,
    });
  }
  const areaMatches = withRevision.filter((c) => c.serviceArea !== null).sort((a, b) => a.area! - b.area!);
  let tier: typeof withRevision;
  let match: PriceSelection['match'];
  let disclosure: string | null = null;
  if (areaMatches.length > 0) {
    const narrowest = areaMatches[0]!.area!;
    // Equal-size areas (or the same area) are one tier: they must agree on every price.
    tier = areaMatches.filter((c) => Math.abs(c.area! - narrowest) <= narrowest * 1e-9);
    match = 'service_area';
  } else {
    tier = withRevision.filter((c) => c.serviceArea === null);
    match = 'company_default';
    if (tier.length === 0) {
      throw problem('price_unavailable', 'No approved price book covers this location. Add a service-area book or a company-wide default.');
    }
    disclosure = input.point
      ? `No service-area price book covers this location; using the company-wide default "${tier[0]!.book.name}". Review before quoting.`
      : `The property has no confirmed location; using the company-wide default "${tier[0]!.book.name}". Review before quoting.`;
  }
  const chosen = tier[0]!;
  const items = await revisionItems(tx, orgId, chosen.revision.id);
  const conflicts: PriceSelection['conflicts'] = [];
  if (tier.length > 1) {
    const byCode = new Map<string, { priceBookId: string; unitRate: string | null; fixedAmountMinor: number | null }[]>();
    for (const c of tier) {
      for (const it of await revisionItems(tx, orgId, c.revision.id)) {
        const list = byCode.get(it.code) ?? [];
        list.push({ priceBookId: c.book.id, unitRate: it.unitRate, fixedAmountMinor: it.fixedAmountMinor });
        byCode.set(it.code, list);
      }
    }
    for (const [code, list] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const distinct = new Set(list.map((l) => `${l.unitRate === null ? '' : Number(l.unitRate)}|${l.fixedAmountMinor ?? ''}`));
      if (distinct.size > 1) conflicts.push({ code, books: list });
    }
  }
  return {
    book: chosen.book,
    revision: chosen.revision,
    items,
    selection: {
      priceBookId: chosen.book.id,
      priceBookRevisionId: chosen.revision.id,
      match,
      serviceArea: chosen.serviceArea,
      fallback: match === 'company_default',
      disclosure,
      stale: staleItems(chosen.revision, items, today),
      conflicts,
    },
  };
}

// ------------------------------------------------------------------ CSV import (CP-057 A)
export const CSV_COLUMNS = [
  'code',
  'label',
  'category',
  'cost_component',
  'unit',
  'unit_rate',
  'fixed_amount_minor',
  'minimum_quantity',
  'taxable',
  'source',
  'source_ref',
  'price_date',
] as const;

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ImportedItem {
  code: string;
  label: string;
  category: (typeof PRICE_ITEM_CATEGORIES)[number];
  costComponent: (typeof COST_COMPONENTS)[number];
  unit: (typeof PRICING_UNITS)[number];
  unitRate: string | null;
  fixedAmountMinor: number | null;
  minimumQuantity: string | null;
  taxable: boolean;
  source: string;
  sourceRef: string | null;
  priceDate: string | null;
}

const RATE = /^(0|[1-9]\d{0,11})(\.\d{1,6})?$/;
const CODE = /^[A-Z0-9_]{2,40}$/;

export function validateCsv(text: string, dryRun: boolean): { report: ImportReport; items: ImportedItem[] } {
  const errors: ImportReport['errors'] = [];
  const warnings: ImportReport['warnings'] = [];
  const rows = parseCsv(text);
  const items: ImportedItem[] = [];
  if (rows.length === 0) {
    errors.push({ line: 1, field: null, message: 'The file is empty.' });
    return { report: { dryRun, applied: false, totalRows: 0, validRows: 0, errors, warnings }, items };
  }
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const missing = ['code', 'label', 'category', 'cost_component', 'unit'].filter((c) => !header.includes(c));
  for (const m of missing) errors.push({ line: 1, field: m, message: `Missing required column ${m}.` });
  const unknownCols = header.filter((h) => !(CSV_COLUMNS as readonly string[]).includes(h));
  for (const u of unknownCols) warnings.push({ line: 1, field: u, message: `Column ${u} is ignored.` });
  if (missing.length) return { report: { dryRun, applied: false, totalRows: rows.length - 1, validRows: 0, errors, warnings }, items };
  const seen = new Map<string, number>();
  rows.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const get = (c: string) => {
      const i = header.indexOf(c);
      return i < 0 ? '' : (cells[i] ?? '').trim();
    };
    const rowErrors: ImportReport['errors'] = [];
    const err = (field: string, message: string) => rowErrors.push({ line, field, message });
    const code = get('code').toUpperCase();
    if (!CODE.test(code)) err('code', 'Use 2-40 characters A-Z, 0-9 or _.');
    if (seen.has(code)) err('code', `Duplicate code (first on line ${seen.get(code)}).`);
    const label = get('label');
    if (!label || label.length > 200) err('label', 'Label is required (max 200 characters).');
    const category = get('category');
    if (!(PRICE_ITEM_CATEGORIES as readonly string[]).includes(category)) err('category', `Unknown category "${category}".`);
    const component = get('cost_component');
    if (!(COST_COMPONENTS as readonly string[]).includes(component)) err('cost_component', `Unknown cost component "${component}".`);
    const unit = get('unit');
    if (!(PRICING_UNITS as readonly string[]).includes(unit)) err('unit', `Unknown unit "${unit}".`);
    const unitRate = get('unit_rate') || null;
    if (unitRate !== null && !RATE.test(unitRate)) err('unit_rate', 'Use a non-negative decimal with at most 6 decimals (no currency symbols).');
    const fixedRaw = get('fixed_amount_minor');
    const fixed = fixedRaw === '' ? null : Number(fixedRaw);
    if (fixed !== null && (!Number.isSafeInteger(fixed) || fixed < 0)) err('fixed_amount_minor', 'Use whole minor units (cents), e.g. 40000.');
    // CP-052-API: a line with neither rate nor amount is not imported as $0.
    if (unitRate === null && fixed === null) err('unit_rate', 'Give unit_rate or fixed_amount_minor; a missing price is never imported as 0.');
    if (unitRate !== null && fixed !== null) err('unit_rate', 'Give unit_rate OR fixed_amount_minor, not both.');
    const minQ = get('minimum_quantity') || null;
    if (minQ !== null && !RATE.test(minQ)) err('minimum_quantity', 'Use a non-negative decimal.');
    const taxableRaw = get('taxable').toLowerCase();
    if (taxableRaw && !['true', 'false', 'yes', 'no', '1', '0'].includes(taxableRaw)) err('taxable', 'Use true or false.');
    const priceDate = get('price_date') || null;
    if (priceDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate) || Number.isNaN(Date.parse(priceDate)))) err('price_date', 'Use YYYY-MM-DD.');
    const source = get('source') || 'csv_import';
    if (!get('source')) warnings.push({ line, field: 'source', message: 'No source given; recorded as csv_import. Add the supplier quote reference.' });
    if (!priceDate) warnings.push({ line, field: 'price_date', message: 'No price date; the revision effective date is used for staleness.' });
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    seen.set(code, line);
    items.push({
      code,
      label,
      category: category as ImportedItem['category'],
      costComponent: component as ImportedItem['costComponent'],
      unit: unit as ImportedItem['unit'],
      unitRate,
      fixedAmountMinor: fixed,
      minimumQuantity: minQ,
      taxable: taxableRaw === '' ? true : ['true', 'yes', '1'].includes(taxableRaw),
      source: source.slice(0, 120),
      sourceRef: get('source_ref').slice(0, 300) || null,
      priceDate,
    });
  });
  return {
    report: { dryRun, applied: false, totalRows: rows.length - 1, validRows: items.length, errors, warnings },
    items,
  };
}
