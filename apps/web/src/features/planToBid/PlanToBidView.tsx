'use client';

// Plan-to-Bid: upload a construction plan, read the drawings and specs into draft takeoff
// lines by trade, research material prices, add contractor labor/subcontractor rates, review
// every line, and export a DRAFT bid package. Nothing is sent to anyone — proposals are a
// stub, so the package is a draft until a person approves every line. Blank prices stay
// "Price missing" and are excluded from every total; nothing is ever invented.
import {
  PLAN_TO_BID_TRADE_LABELS,
  PLAN_TO_BID_TRADES,
  type PlanToBidBidPackageRequest,
  type PlanToBidReadResponse,
  type PlanToBidTrade,
} from '@fieldline/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useApi } from '../../lib/session';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff } from '../build/takeoff';
import { fetchLivePrices } from '../build/live';
import {
  buildSequence,
  computeBidTotals,
  takeoffToBidLines,
  type BidReviewLine,
  type TradeCost,
} from './planToBid';

const MAX_BYTES = 8 * 1024 * 1024;
type PlanMediaType = 'application/pdf' | 'application/dxf' | 'image/vnd.dwg';
const ACCEPTED: Record<string, PlanMediaType> = {
  'application/pdf': 'application/pdf',
  'application/dxf': 'application/dxf',
  'image/vnd.dwg': 'image/vnd.dwg',
};

const money = (n: number | null) => (n === null ? 'Price missing' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

let lineSeq = 0;
const nextId = () => `line-${Date.now().toString(36)}-${(lineSeq += 1)}`;

function draftLinesFromRead(read: PlanToBidReadResponse): BidReviewLine[] {
  const seen = new Set<string>();
  const out: BidReviewLine[] = [];
  const push = (l: { trade: PlanToBidTrade; label: string; unit: string; quantity: number | null; source: BidReviewLine['source'] }) => {
    const key = `${l.trade}:${l.label.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: nextId(),
      trade: l.trade,
      label: l.label,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: null,
      priceSource: null,
      priceCheckedAt: null,
      source: l.source,
      approved: false,
    });
  };
  for (const l of read.lines) push({ trade: l.trade, label: l.label, unit: l.unit, quantity: l.quantity, source: l.source });
  for (const l of read.aiLines ?? []) push({ trade: l.trade, label: l.label, unit: l.unit, quantity: l.quantity, source: 'ai' });
  return out;
}

export function PlanToBidView() {
  return (
    <RouteGate routeId="planToBid">
      <PlanToBidContent />
    </RouteGate>
  );
}

function PlanToBidContent() {
  const { api, endpoints } = useApi();
  const [file, setFile] = useState<{ name: string; mediaType: PlanMediaType; data: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [orgName, setOrgName] = useState('');
  const [read, setRead] = useState<PlanToBidReadResponse | null>(null);
  const [lines, setLines] = useState<BidReviewLine[]>([]);
  const [costs, setCosts] = useState<TradeCost[]>([]);
  const [takeoffDone, setTakeoffDone] = useState(false);
  const [livePrice, setLivePrice] = useState<Record<string, { busy: boolean; note: string | null; offer: { price: number; seller: string; link: string | null } | null }>>({});
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');

  const status = useQuery({
    queryKey: ['plan-to-bid', 'status'],
    queryFn: () => endpoints.planToBidStatus(),
    staleTime: 60_000,
  });

  const readPlan = useMutation({
    mutationFn: () => endpoints.planToBidRead({ file: file!, projectName: projectName.trim() || undefined }),
    onSuccess: (data) => {
      setRead(data);
      setLines(draftLinesFromRead(data));
      setTakeoffDone(false);
      setExportNote(null);
    },
  });

  const exportPackage = useMutation({
    mutationFn: () => {
      const input: PlanToBidBidPackageRequest = {
        projectName: projectName.trim() || 'Untitled project',
        organizationName: orgName.trim(),
        lines: lines.map((l) => ({
          trade: l.trade,
          label: l.label,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          priceSource: l.priceSource,
          priceCheckedAt: l.priceCheckedAt,
          approved: l.approved,
        })),
        tradeCosts: costs,
        notes: noteText.trim() ? [noteText.trim()] : [],
      };
      return endpoints.planToBidBidPackage(input);
    },
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportNote(
        `Draft bid package downloaded (${data.pages} page${data.pages === 1 ? '' : 's'}, ${data.approvedLines} approved lines${data.unpricedLines > 0 ? `, ${data.unpricedLines} unpriced — the total is partial` : ''}). It was not sent to anyone.`,
      );
    },
  });

  const totals = useMemo(() => computeBidTotals(lines, costs), [lines, costs]);
  const sequence = useMemo(() => buildSequence(lines), [lines]);

  const onFile = (f: File | undefined) => {
    setFileError(null);
    if (!f) return;
    const mediaType = ACCEPTED[f.type];
    if (!mediaType) {
      setFileError('Upload a plan as a PDF exported from CAD, or an AutoCAD DXF/DWG file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('That file is larger than 8 MB. Export the plan page alone, or a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      setFile({ name: f.name, mediaType, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(f);
  };

  const generateTakeoff = () => {
    if (!read?.specHint) return;
    const spec = {
      ...DEFAULT_SPEC,
      lengthFt: read.specHint.lengthFt,
      widthFt: read.specHint.widthFt,
      stories: read.specHint.stories,
    };
    const priced = priceTakeoff(computeTakeoff(spec).lines);
    const made = takeoffToBidLines(priced.lines);
    setLines((prev) => {
      const seen = new Set(prev.map((l) => `${l.trade}:${l.label.toLowerCase()}`));
      const fresh = made.filter((l) => !seen.has(`${l.trade}:${l.label.toLowerCase()}`));
      return [...prev, ...fresh];
    });
    setTakeoffDone(true);
  };

  const updateLine = (id: string, patch: Partial<BidReviewLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const updateCost = (trade: PlanToBidTrade, patch: Partial<TradeCost>) =>
    setCosts((prev) => {
      const found = prev.find((c) => c.trade === trade);
      if (found) return prev.map((c) => (c.trade === trade ? { ...c, ...patch } : c));
      return [...prev, { trade, laborHours: null, laborRate: null, subcontractorAmount: null, ...patch }];
    });

  const costFor = (trade: PlanToBidTrade): TradeCost =>
    costs.find((c) => c.trade === trade) ?? { trade, laborHours: null, laborRate: null, subcontractorAmount: null };

  const checkLivePrice = async (line: BidReviewLine) => {
    setLivePrice((p) => ({ ...p, [line.id]: { busy: true, note: null, offer: null } }));
    const res = await fetchLivePrices(api, line.label, 'Texas, United States');
    const offer = res.offers[0] ?? null;
    setLivePrice((p) => ({
      ...p,
      [line.id]: {
        busy: false,
        note: res.live ? (offer ? null : 'No priced listings found for that search.') : res.message ?? 'Live prices are not set up.',
        offer: offer ? { price: offer.price, seller: offer.seller, link: offer.link } : null,
      },
    }));
  };

  const applyLivePrice = (line: BidReviewLine) => {
    const found = livePrice[line.id]?.offer;
    if (!found) return;
    updateLine(line.id, {
      unitPrice: found.price,
      priceSource: `Live listing: ${found.seller}`,
      priceCheckedAt: new Date().toISOString(),
    });
  };

  const numOrNull = (v: string): number | null => {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
  };

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <PageHeader title="Plan to Bid" />
      <p className="web-muted web-small">
        Upload a construction plan and Field Pro reads the drawings and specs into a takeoff, estimate and bid package,
        organized by trade in build sequence. Review and approve every line before anything is priced into a total — the
        package is a <strong>DRAFT</strong> and is never sent to anyone from here.
      </p>
      {status.data ? (
        <p className="web-muted web-small">
          {status.data.aiReading
            ? 'AI classification is connected (your Qwen model). It only labels what the plan text says.'
            : 'AI classification is not connected. The draft comes from the plan\u2019s own text and measured lines only.'}{' '}
          {status.data.livePricesMessage}
        </p>
      ) : null}

      <section className="cc-stack" aria-label="Upload a plan">
        <label className="cc-field">
          Project name
          <input className="cc-input" value={projectName} maxLength={160} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Maple St Residence" />
        </label>
        <label className="cc-field">
          Plan file (PDF, DXF or DWG, up to 8 MB)
          <input
            className="cc-input"
            type="file"
            accept=".pdf,.dxf,.dwg,application/pdf"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        {file ? <p className="web-small">Selected: {file.name}</p> : null}
        {fileError ? <p className="web-error" role="alert">{fileError}</p> : null}
        <div>
          <button className="cc-btn" type="button" disabled={!file || readPlan.isPending} onClick={() => readPlan.mutate()}>
            {readPlan.isPending ? 'Reading plan…' : 'Read plan into takeoff'}
          </button>
        </div>
        {readPlan.isError ? <p className="web-error" role="alert">That plan could not be read. Upload a PDF exported from CAD, or a DXF/DWG floor plan.</p> : null}
      </section>

      {read ? (
        <>
          <section aria-label="What was read">
            <h2>What was read</h2>
            <ul className="web-small">
              {read.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
            {read.geometry?.footprint ? (
              <p className="web-small">
                Measured footprint: {read.geometry.footprint.lengthFt} ft × {read.geometry.footprint.widthFt} ft,{' '}
                {read.geometry.rooms.length} labeled rooms, {read.geometry.doors} doors, {read.geometry.windows} windows.
              </p>
            ) : (
              <p className="web-small">No footprint could be measured from the drawn lines — enter quantities by hand below.</p>
            )}
            {read.specHint && !takeoffDone ? (
              <button className="cc-btn" type="button" onClick={generateTakeoff}>
                Generate takeoff from the measured plan
              </button>
            ) : null}
            {takeoffDone ? <p className="web-small">Takeoff generated from the measured plan with the existing takeoff engine.</p> : null}
          </section>

          <section aria-label="Review the takeoff">
            <h2>Review the takeoff</h2>
            <p className="web-muted web-small">
              Check every quantity and price. Approve a line only when you stand behind it. Blank prices stay “Price
              missing” and are left out of every total.
            </p>
            {PLAN_TO_BID_TRADES.map((trade) => {
              const tradeLines = lines.filter((l) => l.trade === trade);
              if (tradeLines.length === 0) return null;
              const cost = costFor(trade);
              return (
                <div key={trade} className="web-section">
                  <h3>{PLAN_TO_BID_TRADE_LABELS[trade]}</h3>
                  <table className="cc-table">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Unit price</th>
                        <th scope="col">Amount</th>
                        <th scope="col">Approve</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tradeLines.map((line) => {
                        const amount = line.quantity !== null && line.unitPrice !== null ? line.quantity * line.unitPrice : null;
                        const lp = livePrice[line.id];
                        return (
                          <tr key={line.id}>
                            <td>
                              {line.label}
                              <div className="web-muted web-small">
                                {line.source === 'ai' ? 'AI classified' : line.source === 'geometry' ? 'Measured from the plan' : line.source === 'takeoff' ? 'Takeoff engine' : line.source === 'manual' ? 'Added by hand' : 'Found in the plan text'}
                                {line.priceSource ? ` · ${line.priceSource}` : ''}
                              </div>
                              {lp?.offer ? (
                                <div className="web-small">
                                  Live: {money(lp.offer.price)} at {lp.offer.seller}{' '}
                                  <button type="button" className="cc-btn" onClick={() => applyLivePrice(line)}>
                                    Use this price
                                  </button>
                                </div>
                              ) : null}
                              {lp?.note ? <div className="web-muted web-small">{lp.note}</div> : null}
                            </td>
                            <td>
                              <input
                                className="cc-input"
                                type="number"
                                min={0}
                                step="any"
                                aria-label={`Quantity for ${line.label}`}
                                value={line.quantity ?? ''}
                                placeholder="Not stated"
                                onChange={(e) => updateLine(line.id, { quantity: numOrNull(e.target.value) })}
                              />
                              <span className="web-muted web-small"> {line.unit}</span>
                            </td>
                            <td>
                              <input
                                className="cc-input"
                                type="number"
                                min={0}
                                step="any"
                                aria-label={`Unit price for ${line.label}`}
                                value={line.unitPrice ?? ''}
                                placeholder="Price missing"
                                onChange={(e) => updateLine(line.id, { unitPrice: numOrNull(e.target.value), priceSource: 'Contractor entered', priceCheckedAt: new Date().toISOString() })}
                              />
                              <div style={{ marginTop: '0.5rem' }}>
                                <button type="button" className="cc-btn" disabled={lp?.busy} onClick={() => void checkLivePrice(line)}>
                                  {lp?.busy ? 'Checking…' : 'Live price'}
                                </button>
                              </div>
                            </td>
                            <td>{money(amount)}</td>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Approve ${line.label}`}
                                checked={line.approved}
                                onChange={(e) => updateLine(line.id, { approved: e.target.checked })}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="cc-stack" style={{ gap: '0.5rem' }}>
                    <strong className="web-small">Labor & subcontractor — {PLAN_TO_BID_TRADE_LABELS[trade]} (contractor-entered only)</strong>
                    <label className="cc-field">
                      Labor hours
                      <input className="cc-input" type="number" min={0} step="any" value={cost.laborHours ?? ''} placeholder="Not priced" onChange={(e) => updateCost(trade, { laborHours: numOrNull(e.target.value) })} />
                    </label>
                    <label className="cc-field">
                      Labor rate ($/hr)
                      <input className="cc-input" type="number" min={0} step="any" value={cost.laborRate ?? ''} placeholder="Not priced" onChange={(e) => updateCost(trade, { laborRate: numOrNull(e.target.value) })} />
                    </label>
                    <label className="cc-field">
                      Subcontractor amount ($)
                      <input className="cc-input" type="number" min={0} step="any" value={cost.subcontractorAmount ?? ''} placeholder="Not priced" onChange={(e) => updateCost(trade, { subcontractorAmount: numOrNull(e.target.value) })} />
                    </label>
                  </div>
                </div>
              );
            })}
            <button
              className="cc-btn"
              type="button"
              onClick={() => {
                const trade = PLAN_TO_BID_TRADES[0]!;
                setLines((prev) => [
                  ...prev,
                  { id: nextId(), trade, label: 'New line', unit: 'ls', quantity: null, unitPrice: null, priceSource: null, priceCheckedAt: null, source: 'manual', approved: false },
                ]);
              }}
            >
              Add a line by hand
            </button>
          </section>

          <section aria-label="Build sequence">
            <h2>Build sequence</h2>
            <ol>
              {sequence.map((row, i) => (
                <li key={row.trade}>
                  {i + 1}. {PLAN_TO_BID_TRADE_LABELS[row.trade]} —{' '}
                  {row.status === 'empty'
                    ? 'no lines'
                    : row.status === 'approved'
                      ? `approved (${row.approved}/${row.lines})${row.total !== null ? ` · ${money(row.total)}` : ''}`
                      : row.status === 'blocked'
                        ? `${row.unpriced} approved line(s) still unpriced — total on hold`
                        : `in review (${row.approved}/${row.lines} approved)`}
                </li>
              ))}
            </ol>
            <p className="web-muted web-small">
              The 3D model for this house lives in the House Builder — open the Build page to see it against the same
              measured plan.
            </p>
          </section>

          <section aria-label="Bid package">
            <h2>Bid package — DRAFT</h2>
            <p className="web-small">
              Materials (approved, priced): {money(totals.pricedMaterialTotal)} · Labor: {money(totals.laborTotal)} ·
              Subcontractors: {money(totals.subcontractorTotal)} ·{' '}
              <strong>Total: {totals.grandTotal === null ? `${money(totals.pricedMaterialTotal + totals.laborTotal + totals.subcontractorTotal)} (partial — ${totals.unpricedCount} approved line(s) unpriced)` : money(totals.grandTotal)}</strong>
            </p>
            <p className="web-muted web-small">
              {totals.approvedCount} of {totals.totalCount} lines approved. Unapproved lines are excluded from the
              package. The package is a draft — it is not sent to anyone.
            </p>
            <label className="cc-field">
              Organization name (printed on the package)
              <input className="cc-input" value={orgName} maxLength={160} onChange={(e) => setOrgName(e.target.value)} placeholder="Your company name" />
            </label>
            <label className="cc-field">
              Notes, exclusions & assumptions
              <input className="cc-input" value={noteText} maxLength={300} onChange={(e) => setNoteText(e.target.value)} placeholder="e.g. Excludes permits and utility connection fees." />
            </label>
            <button
              className="cc-btn"
              type="button"
              disabled={totals.approvedCount === 0 || !orgName.trim() || exportPackage.isPending}
              onClick={() => exportPackage.mutate()}
            >
              {exportPackage.isPending ? 'Rendering…' : 'Export draft bid package (PDF)'}
            </button>
            {totals.approvedCount === 0 ? <p className="web-muted web-small">Approve at least one line to export.</p> : null}
            {!orgName.trim() ? <p className="web-muted web-small">Enter your organization name — it is printed on the package.</p> : null}
            {exportPackage.isError ? <p className="web-error" role="alert">The bid package could not be rendered. Check the lines and try again.</p> : null}
            {exportNote ? <p className="web-small">{exportNote}</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
