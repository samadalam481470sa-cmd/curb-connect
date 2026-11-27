'use client';

// Plan-to-Bid: upload a construction plan, read the drawings and specs into draft takeoff
// lines by trade, research material prices, add contractor labor/subcontractor rates, review
// every line, and export a DRAFT bid package. Nothing is sent to anyone — proposals are a
// stub, so the package is a draft until a person approves every line. Blank prices stay
// "Price missing" and are excluded from every total; nothing is ever invented.
import {
  PLAN_TO_BID_TRADE_LABELS,
  PLAN_TO_BID_TRADES,
  type LaborRate,
  type PlanAuditResponse,
  type PlanToBidBidPackageRequest,
  type PlanToBidReadResponse,
  type PlanToBidTrade,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useApi } from '../../lib/session';
import { DEFAULT_SPEC, computeTakeoff, priceTakeoff } from '../build/takeoff';
import { fetchLivePrices } from '../build/live';
import {
  buildSequence,
  computeBidTotals,
  computeTradeTotals,
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
  const [audit, setAudit] = useState<PlanAuditResponse | null>(null);
  const [lines, setLines] = useState<BidReviewLine[]>([]);
  const [costs, setCosts] = useState<TradeCost[]>([]);
  const [takeoffDone, setTakeoffDone] = useState(false);
  const [livePrice, setLivePrice] = useState<Record<string, { busy: boolean; note: string | null; offer: { price: number; seller: string; link: string | null } | null }>>({});
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [rateForm, setRateForm] = useState<{ trade: PlanToBidTrade; label: string; dollars: string; note: string }>({
    trade: 'framing',
    label: '',
    dollars: '',
    note: '',
  });
  const [rateFormError, setRateFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['plan-to-bid', 'status'],
    queryFn: () => endpoints.planToBidStatus(),
    staleTime: 60_000,
  });

  const laborRates = useQuery({
    queryKey: ['plan-to-bid', 'labor-rates'],
    queryFn: () => endpoints.planToBidLaborRates(),
    staleTime: 60_000,
  });

  const createRate = useMutation({
    mutationFn: (input: { trade: PlanToBidTrade; label: string; rateCentsPerHour: number; note?: string }) =>
      endpoints.planToBidCreateLaborRate(input),
    onSuccess: () => {
      setRateFormError(null);
      setRateForm((f) => ({ ...f, label: '', dollars: '', note: '' }));
      void queryClient.invalidateQueries({ queryKey: ['plan-to-bid', 'labor-rates'] });
    },
    onError: () =>
      setRateFormError('That rate could not be saved. A rate with the same name may already exist for this trade.'),
  });

  const deleteRate = useMutation({
    mutationFn: (id: string) => endpoints.planToBidDeleteLaborRate(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['plan-to-bid', 'labor-rates'] }),
  });

  const saveRate = () => {
    const dollars = Number(rateForm.dollars);
    if (!rateForm.label.trim()) {
      setRateFormError('Give the rate a name, like "Journeyman" or "Crew A".');
      return;
    }
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setRateFormError('Enter your hourly rate in dollars, above zero.');
      return;
    }
    createRate.mutate({
      trade: rateForm.trade,
      label: rateForm.label.trim(),
      rateCentsPerHour: Math.round(dollars * 100),
      note: rateForm.note.trim() || undefined,
    });
  };

  const ratesForTrade = (trade: PlanToBidTrade): LaborRate[] =>
    (laborRates.data?.rates ?? []).filter((r) => r.trade === trade);

  const readPlan = useMutation({
    mutationFn: () => endpoints.planToBidRead({ file: file!, projectName: projectName.trim() || undefined }),
    onSuccess: (data) => {
      setRead(data);
      setLines(draftLinesFromRead(data));
      setTakeoffDone(false);
      setExportNote(null);
    },
  });

  const auditPlanMutation = useMutation({
    mutationFn: () => endpoints.planToBidAudit({ file: file!, projectName: projectName.trim() || undefined }),
    onSuccess: (data) => setAudit(data),
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
  const tradeTotals = useMemo(() => computeTradeTotals(lines, costs), [lines, costs]);

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
          </button>{' '}
          <button className="cc-btn" type="button" disabled={!file || auditPlanMutation.isPending} onClick={() => auditPlanMutation.mutate()}>
            {auditPlanMutation.isPending ? 'Auditing plan…' : 'Audit this plan'}
          </button>
        </div>
        {readPlan.isError ? <p className="web-error" role="alert">That plan could not be read. Upload a PDF exported from CAD, or a DXF/DWG floor plan.</p> : null}
        {auditPlanMutation.isError ? <p className="web-error" role="alert">That plan could not be audited. Upload a PDF exported from CAD, or a DXF/DWG floor plan.</p> : null}
      </section>

      <section aria-label="Labor rate book">
        <h2>Labor rate book</h2>
        <p className="web-muted web-small">
          Your own hourly rates, saved per trade and reused across bids. A saved rate is used only when you pick it
          below — Field Pro never fills in a labor rate for you.
        </p>
        {laborRates.isPending ? (
          <p className="web-muted web-small">Loading your saved rates…</p>
        ) : laborRates.isError ? (
          <p className="web-error" role="alert">Your saved rates could not be loaded. You can still type rates by hand below.</p>
        ) : laborRates.data && laborRates.data.rates.length === 0 ? (
          <p className="web-small">No saved labor rates yet. Add your own below — there are no default rates.</p>
        ) : (
          <ul className="web-small">
            {(laborRates.data?.rates ?? []).map((r) => (
              <li key={r.id}>
                <strong>{PLAN_TO_BID_TRADE_LABELS[r.trade]}</strong> — {r.label}: {money(r.rateCentsPerHour / 100)}/hr
                {r.note ? ` (${r.note})` : ''}{' '}
                <button
                  type="button"
                  className="cc-btn"
                  disabled={deleteRate.isPending}
                  onClick={() => deleteRate.mutate(r.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="cc-stack" style={{ gap: '0.5rem' }}>
          <label className="cc-field">
            Trade
            <select
              className="cc-input"
              value={rateForm.trade}
              onChange={(e) => setRateForm((f) => ({ ...f, trade: e.target.value as PlanToBidTrade }))}
            >
              {PLAN_TO_BID_TRADES.map((t) => (
                <option key={t} value={t}>
                  {PLAN_TO_BID_TRADE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            Rate name
            <input
              className="cc-input"
              value={rateForm.label}
              maxLength={80}
              placeholder="e.g. Journeyman"
              onChange={(e) => setRateForm((f) => ({ ...f, label: e.target.value }))}
            />
          </label>
          <label className="cc-field">
            Hourly rate ($/hr)
            <input
              className="cc-input"
              type="number"
              min={0}
              step="any"
              value={rateForm.dollars}
              placeholder="Your rate"
              onChange={(e) => setRateForm((f) => ({ ...f, dollars: e.target.value }))}
            />
          </label>
          <label className="cc-field">
            Note (optional)
            <input
              className="cc-input"
              value={rateForm.note}
              maxLength={300}
              placeholder="e.g. includes burden"
              onChange={(e) => setRateForm((f) => ({ ...f, note: e.target.value }))}
            />
          </label>
          <div>
            <button className="cc-btn" type="button" disabled={createRate.isPending} onClick={saveRate}>
              {createRate.isPending ? 'Saving…' : 'Save rate'}
            </button>
          </div>
          {rateFormError ? <p className="web-error" role="alert">{rateFormError}</p> : null}
        </div>
      </section>

      {audit ? (
        <section aria-label="Plan audit">
          <h2>Plan audit</h2>
          <p className="web-muted web-small">
            Auto-tagged {audit.tags.length} item{audit.tags.length === 1 ? '' : 's'} by trade from the plan’s text and
            measured lines{audit.aiTags ? `, plus ${audit.aiTags.length} AI-classified` : ''}. Findings below are about
            what the plan names, what it does not name, and where they disagree. Seeing fixtures and symbols in a scan
            needs a vision model — this audit does not claim that. Nothing here is priced.
          </p>
          <ul className="web-small">
            {audit.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          {audit.findings.length === 0 ? (
            <p role="status">No audit findings — every trade is named and the measured outline agrees with the text.</p>
          ) : (
            <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
              {audit.findings.map((f) => (
                <li key={f.id} className="web-section" style={{ padding: '8px 10px' }}>
                  <strong>
                    {f.severity === 'problem' ? 'Problem: ' : 'Note: '}
                    {f.title}
                  </strong>
                  <span style={{ display: 'block' }}>{f.detail}</span>
                  {f.evidence ? (
                    <span className="web-muted web-small" style={{ display: 'block' }}>
                      Plan text: “{f.evidence}”
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <h3>Tags by trade</h3>
          {PLAN_TO_BID_TRADES.map((trade) => {
            const tradeTags = [...audit.tags, ...(audit.aiTags ?? [])].filter((t) => t.trade === trade);
            if (tradeTags.length === 0) return null;
            return (
              <p key={trade} className="web-small">
                <strong>{PLAN_TO_BID_TRADE_LABELS[trade]}:</strong>{' '}
                {tradeTags.map((t) => `${t.label}${t.source === 'ai' ? ' (AI)' : ''}`).join('; ')}
              </p>
            );
          })}
        </section>
      ) : null}

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
                    {ratesForTrade(trade).length > 0 ? (
                      <label className="cc-field">
                        Or pick one of your saved rates for this trade
                        <select
                          className="cc-input"
                          defaultValue=""
                          onChange={(e) => {
                            const picked = ratesForTrade(trade).find((r) => r.id === e.target.value);
                            if (picked) updateCost(trade, { laborRate: picked.rateCentsPerHour / 100 });
                          }}
                        >
                          <option value="">Pick a saved rate…</option>
                          {ratesForTrade(trade).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label} — {money(r.rateCentsPerHour / 100)}/hr
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
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

          <section aria-label="Trade totals">
            <h2>Trade totals</h2>
            <p className="web-muted web-small">
              Per-trade subtotals from your approved lines plus the labor and subcontractor amounts you entered.
              Unapproved lines are excluded. A trade total stays on hold while any approved line in it is unpriced.
            </p>
            {tradeTotals.length === 0 ? (
              <p className="web-small">No trade subtotals yet — approve lines or enter labor above.</p>
            ) : (
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Trade</th>
                    <th scope="col">Materials</th>
                    <th scope="col">Labor</th>
                    <th scope="col">Subcontractor</th>
                    <th scope="col">Trade total</th>
                    <th scope="col">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeTotals.map((row) => (
                    <tr key={row.trade}>
                      <td>{PLAN_TO_BID_TRADE_LABELS[row.trade]}</td>
                      <td>{money(row.materialTotal)}</td>
                      <td>{money(row.laborTotal)}</td>
                      <td>{money(row.subcontractorTotal)}</td>
                      <td>
                        {row.tradeTotal === null
                          ? `On hold — ${row.unpricedCount} approved line(s) unpriced`
                          : money(row.tradeTotal)}
                      </td>
                      <td>
                        {row.approvedCount}/{row.lineCount} approved
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
