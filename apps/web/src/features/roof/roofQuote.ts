// Good / Better / Best roof replacement quote from roof sections and the contractor's own price
// sheet. Prices are never invented: a blank price is reported as missing and the quote is not
// final until every needed price is filled in. Quantities include a waste cushion (10% default)
// and the quote is marked "Estimate - final measurement required".

export interface QuoteSection {
  name: string;
  slopedSqFt: number;
  pitch: number;
}

export type TierKey = 'good' | 'better' | 'best';
export const TIER_KEYS: TierKey[] = ['good', 'better', 'best'];
export const TIER_TITLES: Record<TierKey, string> = {
  good: 'Good',
  better: 'Better',
  best: 'Best',
};

/** Prices are text so blank (not yet priced) is different from 0 (no charge). */
export interface PriceSheet {
  tiers: Record<TierKey, { name: string; perSquare: string }>;
  laborPerSquare: string;
  tearOffPerSquare: string;
  permit: string;
  dumpster: string;
  steepFromPitch: number;
  steepPerSquare: string;
  lowSlopeBelowPitch: number;
  lowSlopePerSquare: string;
  extras: { name: string; amount: string }[];
  companyName: string;
  phone: string;
  email: string;
  license: string;
  logoDataUrl: string;
  terms: string;
}

export const EMPTY_SHEET: PriceSheet = {
  tiers: {
    good: { name: 'Architectural shingles', perSquare: '' },
    better: { name: 'Upgraded impact-rated shingles', perSquare: '' },
    best: { name: 'Standing seam metal', perSquare: '' },
  },
  laborPerSquare: '',
  tearOffPerSquare: '',
  permit: '',
  dumpster: '',
  steepFromPitch: 8,
  steepPerSquare: '',
  lowSlopeBelowPitch: 2,
  lowSlopePerSquare: '',
  extras: [],
  companyName: '',
  phone: '',
  email: '',
  license: '',
  logoDataUrl: '',
  terms: 'Estimate only. Final price upon on-site inspection and measurement. Valid for 30 days.',
};

export interface QuoteLine {
  label: string;
  qty: number | null;
  unit: string;
  rate: number;
  amount: number;
}

export interface TierQuote {
  key: TierKey;
  title: string;
  name: string;
  lines: QuoteLine[];
  total: number;
}

export interface RoofQuote {
  slopedSqFt: number;
  wastePercent: number;
  squares: number;
  steepSquares: number;
  lowSlopeSquares: number;
  missing: { field: string; label: string }[];
  tiers: TierQuote[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function price(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function computeRoofQuote(
  sections: readonly QuoteSection[],
  wastePercent: number,
  sheet: PriceSheet,
): RoofQuote {
  const cushion = 1 + Math.max(0, Math.min(50, wastePercent)) / 100;
  const sq = (sqft: number) => r2((sqft * cushion) / 100);
  const area = (pred: (s: QuoteSection) => boolean) =>
    sections.filter(pred).reduce((a, s) => a + Math.max(0, s.slopedSqFt), 0);
  const slopedSqFt = Math.round(area(() => true));
  const squares = sq(slopedSqFt);
  const lowSlopeSquares = sq(area((s) => s.pitch < sheet.lowSlopeBelowPitch));
  const steepSquares = sq(area((s) => s.pitch >= sheet.steepFromPitch));
  const pitchedSquares = r2(squares - lowSlopeSquares);

  const missing: RoofQuote['missing'] = [];
  const need = (field: string, label: string, value: string) => {
    const n = price(value);
    if (n === null) missing.push({ field, label });
    return n ?? 0;
  };
  const tierRates = Object.fromEntries(
    TIER_KEYS.map((k) => [
      k,
      pitchedSquares > 0
        ? need(
            `tiers.${k}`,
            `${TIER_TITLES[k]} material (${sheet.tiers[k].name || 'unnamed'}) per square`,
            sheet.tiers[k].perSquare,
          )
        : 0,
    ]),
  ) as Record<TierKey, number>;
  const labor = need('laborPerSquare', 'Install labor per square', sheet.laborPerSquare);
  const tearOff = need('tearOffPerSquare', 'Tear-off per square', sheet.tearOffPerSquare);
  const permit = need('permit', 'Permit and inspections', sheet.permit);
  const dumpster = need('dumpster', 'Dumpster and cleanup', sheet.dumpster);
  const steep =
    steepSquares > 0
      ? need(
          'steepPerSquare',
          `Steep roof charge per square (${sheet.steepFromPitch}/12 and up)`,
          sheet.steepPerSquare,
        )
      : 0;
  const low =
    lowSlopeSquares > 0
      ? need(
          'lowSlopePerSquare',
          `Low-slope / flat section per square (under ${sheet.lowSlopeBelowPitch}/12)`,
          sheet.lowSlopePerSquare,
        )
      : 0;
  sheet.extras.forEach((e, i) => {
    if (e.name.trim() && price(e.amount) === null)
      missing.push({ field: `extras.${i}`, label: e.name });
  });

  const tiers = TIER_KEYS.map((k): TierQuote => {
    const lines: QuoteLine[] = [];
    const add = (label: string, qty: number | null, unit: string, rate: number) => {
      const amount = r2(qty === null ? rate : qty * rate);
      if (qty === null || qty > 0) lines.push({ label, qty, unit, rate, amount });
    };
    add(sheet.tiers[k].name || TIER_TITLES[k], pitchedSquares, 'sq', tierRates[k]);
    add('Low-slope / flat sections', lowSlopeSquares, 'sq', low);
    add('Installation labor', squares, 'sq', labor);
    add('Tear-off of existing roof', squares, 'sq', tearOff);
    add('Steep roof charge', steepSquares, 'sq', steep);
    add('Permit and inspections', null, 'each', permit);
    add('Dumpster and cleanup', null, 'each', dumpster);
    for (const e of sheet.extras)
      if (e.name.trim()) add(e.name.trim(), null, 'each', price(e.amount) ?? 0);
    return {
      key: k,
      title: TIER_TITLES[k],
      name: sheet.tiers[k].name || TIER_TITLES[k],
      lines,
      total: r2(lines.reduce((a, l) => a + l.amount, 0)),
    };
  });
  return { slopedSqFt, wastePercent, squares, steepSquares, lowSlopeSquares, missing, tiers };
}

const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

/** Printable, branded quote page. The browser's "Save as PDF" turns it into the PDF. */
export function quoteHtml(input: {
  quote: RoofQuote;
  sheet: PriceSheet;
  sections: readonly QuoteSection[];
  customer: string;
  address: string;
  date: string;
  source: string;
}): string {
  const { quote, sheet } = input;
  const logo = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(
    sheet.logoDataUrl,
  )
    ? `<img src="${sheet.logoDataUrl}" alt="" style="max-height:70px;max-width:220px">`
    : '';
  const tier = (t: TierQuote) => `<div class="tier${t.key === 'better' ? ' mid' : ''}">
<h2>${t.title}</h2><p class="name">${esc(t.name)}</p>
<table>${t.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.label)}${l.qty === null ? '' : ` <small>${l.qty} ${l.unit} × ${money(l.rate)}</small>`}</td><td>${money(l.amount)}</td></tr>`,
    )
    .join('')}</table>
<p class="total">${money(t.total)}</p></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Roof estimate - ${esc(input.address)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#1d2733;margin:32px;font-size:13px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1d4ed8;padding-bottom:12px}
h1{font-size:22px;margin:0} .muted{color:#5b6775}
.banner{background:#fff4d6;border:1px solid #e0b100;padding:8px 12px;margin:16px 0;font-weight:bold}
.tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.tier{border:1px solid #c9d2dc;border-radius:8px;padding:12px}.tier.mid{border:2px solid #1d4ed8}
.tier h2{margin:0;font-size:18px}.name{margin:4px 0 8px;color:#5b6775}
table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px solid #eef1f4;vertical-align:top}
td:last-child{text-align:right;white-space:nowrap}small{color:#5b6775;display:block}
.total{font-size:20px;font-weight:bold;text-align:right;margin:10px 0 0}
.sections td{padding:3px 6px}footer{margin-top:20px;font-size:11px;color:#5b6775}
@media print{body{margin:12mm}}
</style></head><body>
<header><div>${logo}<h1>${esc(sheet.companyName || 'Roof estimate')}</h1>
<div class="muted">${[sheet.phone, sheet.email].filter(Boolean).map(esc).join(' · ')}</div></div>
<div style="text-align:right"><b>Roof replacement estimate</b><div class="muted">${esc(input.date)}</div></div></header>
<p><b>Prepared for:</b> ${esc(input.customer || 'Homeowner')}<br><b>Property:</b> ${esc(input.address || '')}</p>
<div class="banner">Estimate - final measurement required. Measured roof ${quote.slopedSqFt.toLocaleString()} sq ft + ${quote.wastePercent}% cushion = ${quote.squares} squares.</div>
<div class="tiers">${quote.tiers.map(tier).join('')}</div>
<h3>Roof sections (${esc(input.source)})</h3>
<table class="sections"><tr><td><b>Section</b></td><td><b>Pitch</b></td><td><b>Sq ft</b></td></tr>
${input.sections.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.pitch}/12</td><td>${Math.round(s.slopedSqFt).toLocaleString()}</td></tr>`).join('')}</table>
<footer>${esc(sheet.terms)}${sheet.license ? `<br>License / registration: ${esc(sheet.license)}` : ''}</footer>
</body></html>`;
}
