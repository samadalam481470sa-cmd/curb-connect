'use client';

// Instant roof quote: roof sections from Google satellite data or from the roof measured on this
// page, a 10% cushion, the contractor's own price sheet, and Good / Better / Best side by side as
// a branded page to save as PDF. Missing prices are asked for, never made up.
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { AccountDraftStatus, useAccountDraft } from '../../lib/accountDrafts';
import { useApi } from '../../lib/session';
import { errorHint } from '../../lib/api';
import { Panel } from '../command/Panel';
import {
  computeRoofQuote,
  EMPTY_SHEET,
  quoteHtml,
  TIER_KEYS,
  TIER_TITLES,
  type PriceSheet,
  type QuoteSection,
  type TierKey,
} from './roofQuote';

const Satellite = z.object({
  status: z.enum(['found', 'not_configured', 'not_found', 'unavailable']),
  message: z.string(),
  totalSqFt: z.number(),
  imageryDate: z.string().nullable(),
  imageryQuality: z.string().nullable(),
  sections: z.array(
    z.object({
      name: z.string(),
      slopedSqFt: z.number(),
      planSqFt: z.number().nullable(),
      pitch: z.number(),
      azimuthDegrees: z.number().nullable(),
    }),
  ),
});

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

type Source = 'measured' | 'satellite';

export function RoofQuoteBuilder({
  measured,
  address: pageAddress,
}: {
  measured: QuoteSection[];
  address: string;
}) {
  const { api } = useApi();
  const [sheet, setSheet] = useState<PriceSheet>(EMPTY_SHEET);
  const [cushion, setCushion] = useState(10);
  const draft = useAccountDraft({
    key: 'roof-price-sheet',
    legacyKey: 'fieldpro.roof-price-sheet',
    value: { sheet, cushion },
    onRestore: (d: { sheet?: PriceSheet; cushion?: number }) => {
      if (d.sheet && typeof d.sheet === 'object' && d.sheet.tiers)
        setSheet({ ...EMPTY_SHEET, ...d.sheet, tiers: { ...EMPTY_SHEET.tiers, ...d.sheet.tiers } });
      if (typeof d.cushion === 'number' && d.cushion >= 0 && d.cushion <= 50) setCushion(d.cushion);
    },
  });
  const [source, setSource] = useState<Source>(measured.length ? 'measured' : 'satellite');
  const [address, setAddress] = useState(pageAddress);
  const [customer, setCustomer] = useState('');
  const [satellite, setSatellite] = useState<QuoteSection[]>([]);
  const [satMsg, setSatMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const sections = source === 'satellite' ? satellite : measured;
  const quote = useMemo(
    () => computeRoofQuote(sections, cushion, sheet),
    [sections, cushion, sheet],
  );

  const setField = (field: string, value: string) =>
    setSheet((s) => {
      if (field.startsWith('tiers.')) {
        const k = field.slice(6) as TierKey;
        return { ...s, tiers: { ...s.tiers, [k]: { ...s.tiers[k], perSquare: value } } };
      }
      if (field.startsWith('extras.')) {
        const i = Number(field.slice(7));
        return { ...s, extras: s.extras.map((e, j) => (j === i ? { ...e, amount: value } : e)) };
      }
      return { ...s, [field]: value };
    });

  async function measureFromSatellite() {
    const q = (address || pageAddress).trim();
    if (!q) {
      setSatMsg('Enter the job address first.');
      return;
    }
    setBusy(true);
    setSatMsg('Finding the address…');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
      );
      const hits = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      const hit = hits[0];
      if (!hit) {
        setSatMsg('No match for that address. Use a full street address and city.');
        return;
      }
      setSatMsg('Reading the roof from Google satellite data…');
      const r = await api.post(
        '/v1/roof/satellite-sections',
        { latitude: Number(hit.lat), longitude: Number(hit.lon) },
        { schema: Satellite },
      );
      setSatellite(
        r.sections.map((s) => ({ name: s.name, slopedSqFt: s.slopedSqFt, pitch: s.pitch })),
      );
      setSource('satellite');
      setSatMsg(
        r.message +
          (r.imageryDate ? ` Imagery date ${r.imageryDate}` : '') +
          (r.imageryQuality ? `, quality ${r.imageryQuality.toLowerCase()}.` : ''),
      );
    } catch (error) {
      setSatMsg(errorHint(error));
    } finally {
      setBusy(false);
    }
  }

  function openPdf() {
    const html = quoteHtml({
      quote,
      sheet,
      sections,
      customer,
      address: address || pageAddress,
      date: new Date().toLocaleDateString(),
      source:
        source === 'satellite' ? 'Google satellite data, estimate' : 'measured on Field Pro map',
    });
    const w = window.open('', '_blank', 'noopener=no');
    if (!w) {
      window.alert('Allow pop-ups for Field Pro to open the quote.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  function onLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 300_000 || !/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) {
      window.alert('Use a PNG, JPG, WebP or SVG logo under 300 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSheet((s) => ({ ...s, logoDataUrl: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  const ready = sections.length > 0 && quote.missing.length === 0;

  return (
    <Panel title="Instant roof quote (Good / Better / Best)" id="roof-quote">
      <p className="web-small">
        Roof sections come from Google satellite data or from the roof you measured above. A{' '}
        {cushion}% cushion is added so you do not quote short, and the quote is marked as an
        estimate until you measure on site. Prices come only from your price sheet. If a price is
        missing, Field Pro asks you for it.
      </p>
      <AccountDraftStatus
        status={draft.status}
        message={draft.message}
        onImport={draft.importLegacy}
        onReload={draft.reload}
      />

      <div className="cc-work-board__form">
        <label className="cc-work-board__wide">
          Job address
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Carrollton, TX"
          />
        </label>
        <label>
          Customer name
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} />
        </label>
        <label>
          Cushion %
          <input
            type="number"
            min={0}
            max={50}
            value={cushion}
            onChange={(e) => setCushion(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={busy}
          onClick={() => void measureFromSatellite()}
        >
          {busy ? 'Measuring…' : 'Measure from Google satellite'}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={!measured.length}
          onClick={() => setSource('measured')}
        >
          Use roof measured above ({measured.length} facets)
        </button>
      </div>
      {satMsg && (
        <p role="status" className="web-small">
          {satMsg}
        </p>
      )}

      <p className="web-small">
        <b>Using:</b>{' '}
        {source === 'satellite' ? 'Google satellite sections' : 'roof measured on this page'} ·{' '}
        {sections.length} sections · {quote.slopedSqFt.toLocaleString()} sq ft + {cushion}% ={' '}
        {quote.squares} squares
        {quote.steepSquares ? ` · ${quote.steepSquares} steep sq` : ''}
        {quote.lowSlopeSquares ? ` · ${quote.lowSlopeSquares} low-slope sq` : ''}
      </p>
      {sections.length > 0 && (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Pitch</th>
                <th>Sq ft</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{s.pitch}/12</td>
                  <td>{Math.round(s.slopedSqFt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quote.missing.length > 0 && sections.length > 0 && (
        <div className="web-card" role="alert">
          <b>Field Pro needs your price for:</b>
          {quote.missing.map((m) => (
            <form
              key={m.field}
              className="cc-work-board__form"
              onSubmit={(e) => {
                e.preventDefault();
                const v = (answers[m.field] ?? '').trim();
                if (v) setField(m.field, v);
              }}
            >
              <label className="cc-work-board__wide">
                {m.label} ($). Enter 0 if you do not charge it.
                <input
                  inputMode="decimal"
                  value={answers[m.field] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [m.field]: e.target.value }))}
                />
              </label>
              <button className="cc-btn cc-btn--primary" type="submit">
                Save price
              </button>
            </form>
          ))}
          <p className="web-small">Saved prices stay in your price sheet for the next quote.</p>
        </div>
      )}

      {sections.length > 0 && (
        <div className="cc-quote-tiers">
          {quote.tiers.map((t) => (
            <article
              key={t.key}
              className={
                'web-card cc-quote-tier' + (t.key === 'better' ? ' cc-quote-tier--mid' : '')
              }
            >
              <h3>{t.title}</h3>
              <p className="web-muted web-small">{t.name}</p>
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {t.lines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        {l.label}
                        {l.qty !== null && (
                          <div className="web-small web-muted">
                            {l.qty} {l.unit} × {usd(l.rate)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{usd(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="cc-quote-total">{ready ? usd(t.total) : 'Needs prices'}</p>
            </article>
          ))}
        </div>
      )}

      <div className="cc-outreach__actions">
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={!ready}
          onClick={openPdf}
        >
          Open quote as PDF
        </button>
        <button
          type="button"
          className="cc-btn"
          aria-expanded={showSheet}
          onClick={() => setShowSheet((v) => !v)}
        >
          {showSheet ? 'Close price sheet' : 'Edit my price sheet'}
        </button>
        {!ready && sections.length > 0 && (
          <span className="web-small">Fill in the missing prices to finish the quote.</span>
        )}
      </div>

      {showSheet && (
        <div className="cc-work-board__form web-card">
          {TIER_KEYS.map((k) => (
            <fieldset key={k} className="cc-work-board__wide">
              <legend>{TIER_TITLES[k]} option</legend>
              <label>
                Product name
                <input
                  value={sheet.tiers[k].name}
                  onChange={(e) =>
                    setSheet((s) => ({
                      ...s,
                      tiers: { ...s.tiers, [k]: { ...s.tiers[k], name: e.target.value } },
                    }))
                  }
                />
              </label>
              <label>
                Material $ per square
                <input
                  inputMode="decimal"
                  value={sheet.tiers[k].perSquare}
                  onChange={(e) => setField(`tiers.${k}`, e.target.value)}
                />
              </label>
            </fieldset>
          ))}
          <label>
            Install labor $ per square
            <input
              inputMode="decimal"
              value={sheet.laborPerSquare}
              onChange={(e) => setField('laborPerSquare', e.target.value)}
            />
          </label>
          <label>
            Tear-off $ per square
            <input
              inputMode="decimal"
              value={sheet.tearOffPerSquare}
              onChange={(e) => setField('tearOffPerSquare', e.target.value)}
            />
          </label>
          <label>
            Permit and inspections $
            <input
              inputMode="decimal"
              value={sheet.permit}
              onChange={(e) => setField('permit', e.target.value)}
            />
          </label>
          <label>
            Dumpster and cleanup $
            <input
              inputMode="decimal"
              value={sheet.dumpster}
              onChange={(e) => setField('dumpster', e.target.value)}
            />
          </label>
          <label>
            Steep charge starts at pitch (x/12)
            <input
              type="number"
              min={4}
              max={24}
              value={sheet.steepFromPitch}
              onChange={(e) => setSheet((s) => ({ ...s, steepFromPitch: Number(e.target.value) }))}
            />
          </label>
          <label>
            Steep charge $ per square
            <input
              inputMode="decimal"
              value={sheet.steepPerSquare}
              onChange={(e) => setField('steepPerSquare', e.target.value)}
            />
          </label>
          <label>
            Low-slope below pitch (x/12)
            <input
              type="number"
              min={0}
              max={4}
              step={0.5}
              value={sheet.lowSlopeBelowPitch}
              onChange={(e) =>
                setSheet((s) => ({ ...s, lowSlopeBelowPitch: Number(e.target.value) }))
              }
            />
          </label>
          <label>
            Low-slope / flat $ per square
            <input
              inputMode="decimal"
              value={sheet.lowSlopePerSquare}
              onChange={(e) => setField('lowSlopePerSquare', e.target.value)}
            />
          </label>
          <fieldset className="cc-work-board__wide">
            <legend>Other fixed charges (every option)</legend>
            {sheet.extras.map((e, i) => (
              <div key={i} className="cc-outreach__actions">
                <input
                  aria-label="Charge name"
                  value={e.name}
                  onChange={(ev) =>
                    setSheet((s) => ({
                      ...s,
                      extras: s.extras.map((x, j) =>
                        j === i ? { ...x, name: ev.target.value } : x,
                      ),
                    }))
                  }
                />
                <input
                  aria-label="Charge amount"
                  inputMode="decimal"
                  value={e.amount}
                  onChange={(ev) => setField(`extras.${i}`, ev.target.value)}
                />
                <button
                  type="button"
                  className="cc-btn"
                  onClick={() =>
                    setSheet((s) => ({ ...s, extras: s.extras.filter((_, j) => j !== i) }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cc-btn"
              onClick={() =>
                setSheet((s) => ({ ...s, extras: [...s.extras, { name: '', amount: '' }] }))
              }
            >
              Add a charge (drip edge, skylight, vents…)
            </button>
          </fieldset>
          <label>
            Company name on quote
            <input
              value={sheet.companyName}
              onChange={(e) => setSheet((s) => ({ ...s, companyName: e.target.value }))}
            />
          </label>
          <label>
            Phone
            <input
              value={sheet.phone}
              onChange={(e) => setSheet((s) => ({ ...s, phone: e.target.value }))}
            />
          </label>
          <label>
            Email
            <input
              value={sheet.email}
              onChange={(e) => setSheet((s) => ({ ...s, email: e.target.value }))}
            />
          </label>
          <label>
            License / registration no.
            <input
              value={sheet.license}
              onChange={(e) => setSheet((s) => ({ ...s, license: e.target.value }))}
            />
          </label>
          <label>
            Logo (PNG/JPG under 300 KB)
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
          </label>
          <label className="cc-work-board__wide">
            Terms printed on the quote
            <textarea
              rows={3}
              maxLength={1000}
              value={sheet.terms}
              onChange={(e) => setSheet((s) => ({ ...s, terms: e.target.value }))}
            />
          </label>
        </div>
      )}
    </Panel>
  );
}
