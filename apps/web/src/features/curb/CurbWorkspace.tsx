'use client';

import { getRoute } from '@fieldline/contracts';
import type { PriceBookItem } from '@fieldline/pricing';
import {
  Button,
  EstimateLayerSection,
  Field,
  RiskNotice,
  StatusPill,
  TextInput,
} from '@fieldline/ui';
import { useMemo, useState } from 'react';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import {
  formatPricingMoney,
  formatQty,
  formatRate,
  scenarioTotals,
} from '../calc/formatEstimate';
import { computeCurbEstimate, type CurbCalcResult, type DepthMode, type QtyView } from './calc';
import {
  EXAMPLE_PRICE_BOOK,
  PAGE60_RECIPE,
  WORKED_EXAMPLE,
  WORKED_EXAMPLE_LABEL,
} from './defaults';

function cloneBook(book: readonly PriceBookItem[]): PriceBookItem[] {
  return book.map((b) => ({ ...b }));
}

function formatQtyView(q: QtyView): string {
  if (q.state === 'known') return `${formatQty(q.value, 3)} ${q.unit}`;
  if (q.state === 'bounded') {
    return `${formatQty(q.low, 3)} / ${formatQty(q.base, 3)} / ${formatQty(q.high, 3)} ${q.unit}`;
  }
  return `Unknown (${q.reason ?? '—'})`;
}

export function CurbWorkspace() {
  return (
    <RouteGate routeId="curb">
      <CurbCalculator />
    </RouteGate>
  );
}

function CurbCalculator() {
  const route = getRoute('curb');
  const [cutLengthFt, setCutLengthFt] = useState('');
  const [segmentCount, setSegmentCount] = useState('1');
  const [sawPasses, setSawPasses] = useState('2');
  const [depthMode, setDepthMode] = useState<DepthMode>('known');
  const [depthIn, setDepthIn] = useState('6');
  const [depthLowIn, setDepthLowIn] = useState('6');
  const [depthBaseIn, setDepthBaseIn] = useState('7');
  const [depthHighIn, setDepthHighIn] = useState('9');
  const [removalWidthFt, setRemovalWidthFt] = useState('2');
  const [crossSectionFt2, setCrossSectionFt2] = useState('1.5');
  const [boundCrossSection, setBoundCrossSection] = useState(false);
  const [crossSectionLowFt2, setCrossSectionLowFt2] = useState('1');
  const [crossSectionHighFt2, setCrossSectionHighFt2] = useState('2');
  const [overheadPercent, setOverheadPercent] = useState('10');
  const [marginPercent, setMarginPercent] = useState('25');
  const [book, setBook] = useState(() => cloneBook(EXAMPLE_PRICE_BOOK));

  const computed = useMemo((): { result: CurbCalcResult | null; error: string | null } => {
    if (!cutLengthFt.trim()) return { result: null, error: null };
    try {
      const segments = Number.parseInt(segmentCount, 10);
      const passes = Number.parseInt(sawPasses, 10);
      return {
        result: computeCurbEstimate({
          cutLengthFt,
          segmentCount: segments,
          sawPasses: passes,
          depthMode,
          depthIn,
          depthLowIn,
          depthBaseIn,
          depthHighIn,
          depthReason: 'depth unverified',
          removalWidthFt,
          crossSectionFt2,
          boundCrossSection: depthMode === 'bounded' && boundCrossSection,
          crossSectionLowFt2,
          crossSectionHighFt2,
          book,
          recipe: PAGE60_RECIPE,
          overheadPercent,
          marginPercent,
        }),
        error: null,
      };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Could not compute curb estimate',
      };
    }
  }, [
    cutLengthFt,
    segmentCount,
    sawPasses,
    depthMode,
    depthIn,
    depthLowIn,
    depthBaseIn,
    depthHighIn,
    removalWidthFt,
    crossSectionFt2,
    boundCrossSection,
    crossSectionLowFt2,
    crossSectionHighFt2,
    book,
    overheadPercent,
    marginPercent,
  ]);

  function loadWorkedExample() {
    setCutLengthFt(WORKED_EXAMPLE.cutLengthFt);
    setSegmentCount(String(WORKED_EXAMPLE.segmentCount));
    setSawPasses(String(WORKED_EXAMPLE.sawPasses));
    setDepthMode(WORKED_EXAMPLE.depthMode);
    setDepthIn(WORKED_EXAMPLE.depthIn);
    setDepthLowIn(WORKED_EXAMPLE.depthLowIn);
    setDepthBaseIn(WORKED_EXAMPLE.depthBaseIn);
    setDepthHighIn(WORKED_EXAMPLE.depthHighIn);
    setRemovalWidthFt(WORKED_EXAMPLE.removalWidthFt);
    setCrossSectionFt2(WORKED_EXAMPLE.crossSectionFt2);
    setBoundCrossSection(false);
    setOverheadPercent(WORKED_EXAMPLE.overheadPercent);
    setMarginPercent(WORKED_EXAMPLE.marginPercent);
    setBook(cloneBook(EXAMPLE_PRICE_BOOK));
  }

  const { result, error } = computed;
  const totals = result ? scenarioTotals(result.estimate) : null;
  const depthUnverified = depthMode === 'bounded';

  return (
    <>
      <PageHeader
        title={route.label}
        description="Interactive curb estimate calculator using @fieldline/pricing (page-60 recipe). Rates are contractor-editable examples, not market quotes."
        actions={
          <Button variant="secondary" size="sm" onClick={loadWorkedExample}>
            Load worked example
          </Button>
        }
      />

      <p className="web-info web-calc-banner">{WORKED_EXAMPLE_LABEL}.</p>

      {depthUnverified && (
        <RiskNotice kind="depth" sticky>
          Cut depth is entered as a low/base/high range. When that range feeds priced quantities,
          the estimate is non-firm (<code>firm=false</code>) and range drivers are listed honestly —
          never invent a single firm price.
        </RiskNotice>
      )}

      <div className="web-calc-grid">
        <div className="web-calc-inputs">
          <EstimateLayerSection layer="measured" title="Cut geometry">
            <div className="web-calc-row">
              <Field label="Cut length" hint="Feet" required>
                <TextInput
                  inputMode="decimal"
                  value={cutLengthFt}
                  onChange={(e) => setCutLengthFt(e.target.value)}
                  suffix="ft"
                />
              </Field>
              <Field label="Segment count">
                <TextInput
                  inputMode="numeric"
                  value={segmentCount}
                  onChange={(e) => setSegmentCount(e.target.value)}
                />
              </Field>
              <Field label="Saw passes" hint="e.g. 2 faces">
                <TextInput
                  inputMode="numeric"
                  value={sawPasses}
                  onChange={(e) => setSawPasses(e.target.value)}
                />
              </Field>
              <Field label="Removal width">
                <TextInput
                  inputMode="decimal"
                  value={removalWidthFt}
                  onChange={(e) => setRemovalWidthFt(e.target.value)}
                  suffix="ft"
                />
              </Field>
              <Field label="Cross-section area">
                <TextInput
                  inputMode="decimal"
                  value={crossSectionFt2}
                  onChange={(e) => setCrossSectionFt2(e.target.value)}
                  suffix="ft²"
                />
              </Field>
            </div>
          </EstimateLayerSection>

          <EstimateLayerSection layer="measured" title="Cut depth">
            <Field label="Depth mode">
              <select
                className="fl-input"
                value={depthMode}
                onChange={(e) => setDepthMode(e.target.value as DepthMode)}
              >
                <option value="known">Known (verified)</option>
                <option value="bounded">Bounded (unverified low/base/high)</option>
              </select>
            </Field>
            {depthMode === 'known' ? (
              <Field label="Depth">
                <TextInput
                  inputMode="decimal"
                  value={depthIn}
                  onChange={(e) => setDepthIn(e.target.value)}
                  suffix="in"
                />
              </Field>
            ) : (
              <div className="web-calc-row">
                <Field label="Low">
                  <TextInput
                    inputMode="decimal"
                    value={depthLowIn}
                    onChange={(e) => setDepthLowIn(e.target.value)}
                    suffix="in"
                  />
                </Field>
                <Field label="Base">
                  <TextInput
                    inputMode="decimal"
                    value={depthBaseIn}
                    onChange={(e) => setDepthBaseIn(e.target.value)}
                    suffix="in"
                  />
                </Field>
                <Field label="High">
                  <TextInput
                    inputMode="decimal"
                    value={depthHighIn}
                    onChange={(e) => setDepthHighIn(e.target.value)}
                    suffix="in"
                  />
                </Field>
                <label className="web-calc-check">
                  <input
                    type="checkbox"
                    className="web-checkbox"
                    checked={boundCrossSection}
                    onChange={(e) => setBoundCrossSection(e.target.checked)}
                  />
                  Also bound cross-section (volume range)
                </label>
                {boundCrossSection && (
                  <>
                    <Field label="Section low">
                      <TextInput
                        inputMode="decimal"
                        value={crossSectionLowFt2}
                        onChange={(e) => setCrossSectionLowFt2(e.target.value)}
                        suffix="ft²"
                      />
                    </Field>
                    <Field label="Section high">
                      <TextInput
                        inputMode="decimal"
                        value={crossSectionHighFt2}
                        onChange={(e) => setCrossSectionHighFt2(e.target.value)}
                        suffix="ft²"
                      />
                    </Field>
                  </>
                )}
              </div>
            )}
          </EstimateLayerSection>

          <EstimateLayerSection layer="assumption" title="Overhead and target margin">
            <div className="web-calc-row">
              <Field label="Overhead %">
                <TextInput
                  inputMode="decimal"
                  value={overheadPercent}
                  onChange={(e) => setOverheadPercent(e.target.value)}
                  suffix="%"
                />
              </Field>
              <Field label="Target margin %">
                <TextInput
                  inputMode="decimal"
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(e.target.value)}
                  suffix="%"
                />
              </Field>
            </div>
          </EstimateLayerSection>

          <EstimateLayerSection layer="assumption" title="Price book (page-60 example rates)">
            {book.map((item, index) => (
              <div key={item.code} className="web-calc-row">
                <Field label={item.code}>
                  <span className="web-muted web-small">
                    {item.unit} · {item.revision}
                  </span>
                </Field>
                <Field label="Rate">
                  <TextInput
                    inputMode="decimal"
                    value={item.rate == null ? '' : String(item.rate)}
                    onChange={(e) =>
                      setBook((rows) =>
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, rate: e.target.value.trim() === '' ? null : e.target.value }
                            : r,
                        ),
                      )
                    }
                    prefix="$"
                  />
                </Field>
              </div>
            ))}
          </EstimateLayerSection>
        </div>

        <div className="web-calc-outputs">
          {error && (
            <div className="web-error" role="alert">
              <p className="web-error__title">Cannot price yet</p>
              <p>{error}</p>
            </div>
          )}

          {!result && !error && (
            <p className="web-muted">Enter a cut length, or load the worked example.</p>
          )}

          {result && totals && (
            <>
              <EstimateLayerSection layer="suggested" title="Quantities">
                <dl className="web-calc-stats">
                  <div>
                    <dt>Cut length</dt>
                    <dd>{formatQtyView(result.quantities.cutLengthFt)}</dd>
                  </div>
                  <div>
                    <dt>Saw pass length</dt>
                    <dd>{formatQtyView(result.quantities.sawPassLengthFt)}</dd>
                  </div>
                  <div>
                    <dt>Inch-feet</dt>
                    <dd>{formatQtyView(result.quantities.inchFeet)}</dd>
                  </div>
                  <div>
                    <dt>Cut depth</dt>
                    <dd>{formatQtyView(result.quantities.cutDepthIn)}</dd>
                  </div>
                  <div>
                    <dt>Removal area</dt>
                    <dd>{formatQtyView(result.quantities.removalAreaFt2)}</dd>
                  </div>
                  <div>
                    <dt>Removal volume</dt>
                    <dd>{formatQtyView(result.quantities.removalVolumeYd3)}</dd>
                  </div>
                  <div>
                    <dt>Segments</dt>
                    <dd>{result.quantities.segmentCount}</dd>
                  </div>
                </dl>
                {result.quantities.issues.length > 0 && (
                  <ul className="web-list">
                    {result.quantities.issues.map((issue) => (
                      <li key={issue.code}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </EstimateLayerSection>

              <EstimateLayerSection layer="approved" title="Cost estimate">
                <div className="web-calc-total-head">
                  <StatusPill
                    status={
                      totals.status === 'priced'
                        ? totals.firm
                          ? 'approved'
                          : 'budgetary'
                        : 'review_required'
                    }
                    label={
                      totals.status === 'priced'
                        ? totals.firm
                          ? 'Firm'
                          : 'Range (firm=false)'
                        : 'Pending review'
                    }
                    tone={
                      totals.status === 'priced'
                        ? totals.firm
                          ? 'success'
                          : 'warning'
                        : 'danger'
                    }
                  />
                </div>
                {!totals.firm && totals.status === 'priced' && (
                  <RiskNotice kind="preliminary_quote">
                    Estimate is not firm. Range drivers:
                    <ul>
                      {result.estimate.rangeDrivers.length === 0 ? (
                        <li>Bounded inputs present; review low/base/high totals.</li>
                      ) : (
                        result.estimate.rangeDrivers.map((d) => (
                          <li key={`${d.lineCode}-${d.input}`}>
                            {d.lineCode} ({d.input}): {d.reason} — swing{' '}
                            {formatRate(d.directCostSwing, result.estimate.currency)}
                          </li>
                        ))
                      )}
                    </ul>
                  </RiskNotice>
                )}
                {totals.status === 'pending_review' && (
                  <RiskNotice kind="preliminary_quote" severity="danger">
                    Critical components unresolved — totals withheld (never $0).
                    {result.estimate.flags.map((f) => (
                      <span key={f.code} className="web-block">
                        {f.message}
                      </span>
                    ))}
                  </RiskNotice>
                )}
                <dl className="web-calc-stats">
                  <div>
                    <dt>Direct cost</dt>
                    <dd>{totals.direct}</dd>
                  </div>
                  <div>
                    <dt>Cost basis</dt>
                    <dd>{totals.costBasis}</dd>
                  </div>
                  <div>
                    <dt>{totals.firm ? 'Total' : 'Base total'}</dt>
                    <dd className="web-calc-total">{totals.total}</dd>
                  </div>
                  {totals.lowTotal && totals.highTotal && (
                    <div>
                      <dt>Low – high</dt>
                      <dd>
                        {totals.lowTotal} – {totals.highTotal}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="web-table-scroll">
                  <table className="web-matrix web-calc-table">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Qty</th>
                        <th>Rate</th>
                        <th>Extended (base)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.estimate.lines.map((line) => (
                        <tr key={line.code}>
                          <td>
                            {line.description}
                            <span className="web-muted web-small web-block">{line.code}</span>
                          </td>
                          <td>
                            {line.quantity ? (
                              line.quantity.low !== line.quantity.high ? (
                                <>
                                  {formatQty(line.quantity.low, 2)}–
                                  {formatQty(line.quantity.high, 2)} {line.unit}
                                </>
                              ) : (
                                <>
                                  {formatQty(line.quantity.base, 3)} {line.unit}
                                </>
                              )
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {line.unitRate
                              ? formatRate(line.unitRate.base, result.estimate.currency)
                              : '—'}
                          </td>
                          <td>
                            {line.extended
                              ? formatPricingMoney(line.extended.base)
                              : (line.unresolvedReason ?? '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </EstimateLayerSection>
            </>
          )}
        </div>
      </div>
    </>
  );
}
