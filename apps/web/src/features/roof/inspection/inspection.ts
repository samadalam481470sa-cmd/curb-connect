// Photo inspection report: annotate roof photos with findings and produce a
// pass/fail summary with prices. Pure logic only (no React, no network) so it
// can be unit-tested and reused by the printable report.
//
// Prices are never invented: a blank price is reported as missing (same rule
// as RoofQuoteBuilder / roofQuote.ts) and the report is not final until every
// finding that needs a price has one. A price of 0 means "no charge".

export const FINDING_TYPES = [
  { id: 'missing_shingles', label: 'Missing shingles' },
  { id: 'creased_tabs', label: 'Creased tabs' },
  { id: 'lifted_flashing', label: 'Lifted flashing' },
  { id: 'cracked_tile', label: 'Cracked tile' },
  { id: 'granule_loss', label: 'Granule loss' },
  { id: 'exposed_fasteners', label: 'Exposed fasteners' },
  { id: 'other', label: 'Other' },
] as const;

export type FindingTypeId = (typeof FINDING_TYPES)[number]['id'];
export type Severity = 'minor' | 'moderate' | 'severe';
export type FindingResult = 'pass' | 'monitor' | 'fail';

export const SEVERITIES: readonly Severity[] = ['minor', 'moderate', 'severe'];
export const FINDING_RESULTS: readonly FindingResult[] = ['pass', 'monitor', 'fail'];

export function findingLabel(id: string): string {
  return FINDING_TYPES.find((t) => t.id === id)?.label ?? 'Other';
}

export interface InspectionMarker {
  id: string;
  /** Position on the photo, 0..1 from the left / top. */
  x: number;
  y: number;
  findingType: FindingTypeId;
  severity: Severity;
  result: FindingResult;
  note: string;
  /** Dollars typed by a person; blank means not yet priced. */
  priceText: string;
}

export interface InspectionPhoto {
  id: string;
  name: string;
  markers: InspectionMarker[];
}

export interface Inspection {
  address: string;
  customer: string;
  inspector: string;
  /** ISO date (yyyy-mm-dd) the inspection was done. */
  date: string;
  companyName: string;
  phone: string;
  license: string;
  photos: InspectionPhoto[];
}

export const EMPTY_INSPECTION: Inspection = {
  address: '',
  customer: '',
  inspector: '',
  date: '',
  companyName: '',
  phone: '',
  license: '',
  photos: [],
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

let fallbackSeq = 0;
/** Ids only need to be unique within one inspection draft. */
export function newInspectionId(prefix = 'm'): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  fallbackSeq += 1;
  return `${prefix}-${Date.now()}-${fallbackSeq}`;
}

export function createMarker(input: {
  x: number;
  y: number;
  findingType?: FindingTypeId;
  severity?: Severity;
  result?: FindingResult;
  note?: string;
  priceText?: string;
  id?: string;
}): InspectionMarker {
  return {
    id: input.id ?? newInspectionId('marker'),
    x: clamp01(input.x),
    y: clamp01(input.y),
    findingType: input.findingType ?? 'missing_shingles',
    severity: input.severity ?? 'moderate',
    result: input.result ?? 'fail',
    note: input.note ?? '',
    priceText: input.priceText ?? '',
  };
}

export function addMarker(photo: InspectionPhoto, marker: InspectionMarker): InspectionPhoto {
  return { ...photo, markers: [...photo.markers, marker] };
}

export function removeMarker(photo: InspectionPhoto, markerId: string): InspectionPhoto {
  return { ...photo, markers: photo.markers.filter((m) => m.id !== markerId) };
}

export function updateMarker(
  photo: InspectionPhoto,
  markerId: string,
  patch: Partial<Omit<InspectionMarker, 'id'>>,
): InspectionPhoto {
  return {
    ...photo,
    markers: photo.markers.map((m) =>
      m.id === markerId
        ? {
            ...m,
            ...patch,
            x: patch.x === undefined ? m.x : clamp01(patch.x),
            y: patch.y === undefined ? m.y : clamp01(patch.y),
          }
        : m,
    ),
  };
}

/** Dollars typed by a person -> integer cents. Blank -> null (missing). Invalid -> NaN. */
export function parseMoneyText(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return Number.NaN;
  return Math.round(Number(cleaned) * 100);
}

export interface InspectionSummary {
  totalMarkers: number;
  passCount: number;
  monitorCount: number;
  failCount: number;
  /** fail if any marker fails, else monitor if any needs monitoring, else pass. */
  overall: FindingResult;
  byType: { id: FindingTypeId; label: string; count: number }[];
  /** Sum of priced markers only, in cents. */
  pricedTotalCents: number;
  /** Markers with a blank or invalid price. */
  missingPriceCount: number;
  /** True only when there is at least one marker and every marker is priced. */
  isFinal: boolean;
}

export function allMarkers(inspection: Inspection): InspectionMarker[] {
  return inspection.photos.flatMap((p) => p.markers);
}

export function summarizeInspection(inspection: Inspection): InspectionSummary {
  const markers = allMarkers(inspection);
  const byType = FINDING_TYPES.map((t) => ({
    id: t.id as FindingTypeId,
    label: t.label,
    count: markers.filter((m) => m.findingType === t.id).length,
  })).filter((row) => row.count > 0);

  let pricedTotalCents = 0;
  let missingPriceCount = 0;
  for (const m of markers) {
    const cents = parseMoneyText(m.priceText);
    if (cents === null || Number.isNaN(cents)) missingPriceCount += 1;
    else pricedTotalCents += cents;
  }

  const failCount = markers.filter((m) => m.result === 'fail').length;
  const monitorCount = markers.filter((m) => m.result === 'monitor').length;
  const passCount = markers.filter((m) => m.result === 'pass').length;

  return {
    totalMarkers: markers.length,
    passCount,
    monitorCount,
    failCount,
    overall: failCount > 0 ? 'fail' : monitorCount > 0 ? 'monitor' : 'pass',
    byType,
    pricedTotalCents,
    missingPriceCount,
    isFinal: markers.length > 0 && missingPriceCount === 0,
  };
}

const FINDING_IDS = new Set<string>(FINDING_TYPES.map((t) => t.id));

function asFindingType(value: unknown): FindingTypeId {
  return typeof value === 'string' && FINDING_IDS.has(value)
    ? (value as FindingTypeId)
    : 'other';
}
function asSeverity(value: unknown): Severity {
  return value === 'minor' || value === 'severe' ? value : 'moderate';
}
function asResult(value: unknown): FindingResult {
  return value === 'pass' || value === 'monitor' ? value : 'fail';
}
function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Serialize without photo image data (data URLs live only in the browser session). */
export function serializeInspection(inspection: Inspection): string {
  return JSON.stringify(inspection);
}

export function parseInspection(json: string): Inspection {
  const raw = JSON.parse(json) as Partial<Inspection>;
  const photos = Array.isArray(raw.photos) ? raw.photos : [];
  return {
    address: asText(raw.address),
    customer: asText(raw.customer),
    inspector: asText(raw.inspector),
    date: asText(raw.date),
    companyName: asText(raw.companyName),
    phone: asText(raw.phone),
    license: asText(raw.license),
    photos: photos.map((p, i) => {
      const photo = (p ?? {}) as Partial<InspectionPhoto>;
      const markers = Array.isArray(photo.markers) ? photo.markers : [];
      return {
        id: asText(photo.id) || `photo-${i + 1}`,
        name: asText(photo.name) || `Photo ${i + 1}`,
        markers: markers.map((m, j) => {
          const marker = (m ?? {}) as Partial<InspectionMarker>;
          return {
            id: asText(marker.id) || `marker-${i + 1}-${j + 1}`,
            x: clamp01(Number(marker.x)),
            y: clamp01(Number(marker.y)),
            findingType: asFindingType(marker.findingType),
            severity: asSeverity(marker.severity),
            result: asResult(marker.result),
            note: asText(marker.note),
            priceText: asText(marker.priceText),
          };
        }),
      };
    }),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/**
 * Printable report HTML (browser Save-as-PDF), following the RoofQuoteBuilder
 * pattern. Photo image data is passed in by the caller keyed by photo id so
 * this stays pure and testable.
 */
export function inspectionReportHtml(input: {
  inspection: Inspection;
  photoDataUrls: Record<string, string>;
}): string {
  const { inspection, photoDataUrls } = input;
  const summary = summarizeInspection(inspection);
  const overallLabel =
    summary.overall === 'fail' ? 'FAIL' : summary.overall === 'monitor' ? 'MONITOR' : 'PASS';

  const photoSections = inspection.photos
    .map((photo) => {
      const src = photoDataUrls[photo.id];
      const markers = photo.markers
        .map(
          (m, i) =>
            `<span class="marker" style="left:${(m.x * 100).toFixed(1)}%;top:${(m.y * 100).toFixed(1)}%" title="${escapeHtml(findingLabel(m.findingType))}">${i + 1}</span>`,
        )
        .join('');
      const img = src
        ? `<div class="photo"><img src="${src}" alt="${escapeHtml(photo.name)}" />${markers}</div>`
        : `<p><em>Photo not included: ${escapeHtml(photo.name)}</em></p>`;
      const rows = photo.markers
        .map((m, i) => {
          const cents = parseMoneyText(m.priceText);
          const price =
            cents === null || Number.isNaN(cents) ? 'Price missing' : formatCents(cents);
          return `<tr><td>${i + 1}</td><td>${escapeHtml(findingLabel(m.findingType))}</td><td>${escapeHtml(m.severity)}</td><td>${escapeHtml(m.result)}</td><td>${escapeHtml(m.note)}</td><td class="num">${price}</td></tr>`;
        })
        .join('');
      return `<h2>${escapeHtml(photo.name)}</h2>${img}${
        photo.markers.length
          ? `<table><thead><tr><th>#</th><th>Finding</th><th>Severity</th><th>Result</th><th>Note</th><th class="num">Price</th></tr></thead><tbody>${rows}</tbody></table>`
          : '<p>No findings marked on this photo.</p>'
      }`;
    })
    .join('');

  const byTypeRows = summary.byType
    .map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="num">${r.count}</td></tr>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Roof photo inspection report</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:14px}.num{text-align:right}.photo{position:relative;display:inline-block;max-width:100%}.photo img{max-width:100%;display:block}.marker{position:absolute;transform:translate(-50%,-50%);background:#b00020;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff}.banner{border:2px solid #111;padding:10px 14px;display:inline-block;font-weight:700}@media print{body{margin:16px}}</style></head>
<body>
<h1>Roof photo inspection report</h1>
<p>${escapeHtml(inspection.companyName)}${inspection.phone ? ` · ${escapeHtml(inspection.phone)}` : ''}${inspection.license ? ` · License ${escapeHtml(inspection.license)}` : ''}</p>
<p>Customer: ${escapeHtml(inspection.customer)}<br>Address: ${escapeHtml(inspection.address)}<br>Inspector: ${escapeHtml(inspection.inspector)} · Date: ${escapeHtml(inspection.date)}</p>
<p class="banner">Overall: ${overallLabel} — ${summary.failCount} fail · ${summary.monitorCount} monitor · ${summary.passCount} pass (${summary.totalMarkers} findings)</p>
${byTypeRows ? `<h2>Findings by type</h2><table><tbody>${byTypeRows}</tbody></table>` : ''}
${photoSections || '<p>No photos in this inspection.</p>'}
<p><strong>Priced total: ${formatCents(summary.pricedTotalCents)}</strong>${summary.missingPriceCount ? ` · ${summary.missingPriceCount} finding(s) still need a price — not final.` : ''}</p>
<p><em>Inspection based on visible conditions in the photos above. Confirm on site before repair. Prices are the contractor's own; blank prices are shown as missing, never invented.</em></p>
</body></html>`;
}
