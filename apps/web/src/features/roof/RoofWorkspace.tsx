'use client';

import { getRoute } from '@fieldline/contracts';
import type { MaterialSpec } from '@fieldline/pricing';
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
import { fractionToPercent } from '../../lib/decimal-text';
import {
  formatPricingMoney,
  formatQty,
  formatRate,
  scenarioTotals,
} from '../calc/formatEstimate';
import {
  type AreaDisplayUnit,
  computeRoofEstimate,
  type RoofCalcResult,
  type RoofFacetInput,
} from './calc';
import {
  EXAMPLE_LABOR,
  EXAMPLE_MATERIAL_SPECS,
  WORKED_EXAMPLE_LABEL,
  WORKED_EXAMPLE_WASTE_PERCENT,
} from './defaults';

type FacetRow = RoofFacetInput;

function newFacet(n: number): FacetRow {
  return {
    id: `facet-${n}`,
    structureId: 'structure-1',
    planArea: '',
    planAreaUnit: 'ft2',
    pitchRise: '6',
    pitchRun: '12',
  };
}

function cloneMaterials(specs: readonly MaterialSpec[]): MaterialSpec[] {
  return specs.map((s) => ({ ...s, basis: { ...s.basis } as MaterialSpec['basis'] }));
}

export function RoofWorkspace() {
  return (
    <RouteGate routeId="roof">
      <RoofCalculator />
    </RouteGate>
  );
}

function RoofCalculator() {
  const route = getRoute('roof');
  const [facets, setFacets] = useState<FacetRow[]>([newFacet(1)]);
  const [edges, setEdges] = useState({
    eave: '',
    rake: '',
    ridge: '',
    hip: '',
    valley: '',
  });
  const [wastePercent, setWastePercent] = useState('10');
  const [materials, setMaterials] = useState(() => cloneMaterials(EXAMPLE_MATERIAL_SPECS));
  const [laborRate, setLaborRate] = useState(String(EXAMPLE_LABOR.ratePerSquare ?? '95'));
  const [overheadPercent, setOverheadPercent] = useState('10');
  const [markupPercent, setMarkupPercent] = useState('30');
  const [areaUnit, setAreaUnit] = useState<AreaDisplayUnit>('ft2');

  const computed = useMemo((): { result: RoofCalcResult | null; error: string | null } => {
    const hasArea = facets.some((f) => f.planArea.trim());
    if (!hasArea) return { result: null, error: null };
    try {
      return {
        result: computeRoofEstimate({
          facets: facets.map((f) => ({ ...f, planAreaUnit: areaUnit })),
          edges: { ...edges, unit: 'ft' },
          wastePercent,
          materials,
          laborRatePerSquare: laborRate,
          overheadPercent,
          markupPercent,
        }),
        error: null,
      };
    } catch (e) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Could not compute roof estimate',
      };
    }
  }, [
    facets,
    edges,
    wastePercent,
    materials,
    laborRate,
    overheadPercent,
    markupPercent,
    areaUnit,
  ]);

  function loadWorkedExample() {
    setAreaUnit('ft2');
    setFacets([
      {
        id: 'all',
        structureId: 'house',
        planArea: '1200',
        planAreaUnit: 'ft2',
        pitchRise: '6',
        pitchRun: '12',
      },
    ]);
    setEdges({ eave: '160', rake: '0', ridge: '40', hip: '75', valley: '15' });
    setWastePercent(WORKED_EXAMPLE_WASTE_PERCENT);
    setMaterials(cloneMaterials(EXAMPLE_MATERIAL_SPECS));
    setLaborRate(String(EXAMPLE_LABOR.ratePerSquare ?? '95'));
    setOverheadPercent('10');
    setMarkupPercent('30');
  }

  const { result, error } = computed;
  const totals = result ? scenarioTotals(result.estimate) : null;
  const wasteDisplay =
    result?.wasteRate != null ? (fractionToPercent(result.wasteRate) ?? result.wasteRate) : null;

  return (
    <>
      <PageHeader
        title={route.label}
        description="Interactive roof takeoff and cost calculator using @fieldline/pricing. Rates below are contractor-editable examples, not market quotes."
        actions={
          <Button variant="secondary" size="sm" onClick={loadWorkedExample}>
            Load worked example
          </Button>
        }
      />

      <p className="web-info web-calc-banner">
        {WORKED_EXAMPLE_LABEL}. Catalog revision <code>example-cat-1 (synthetic)</code> — edit
        coverages and unit prices to match your approved price book before using numbers on a job.
      </p>

      <div className="web-calc-grid">
        <div className="web-calc-inputs">
          <EstimateLayerSection layer="measured" title="Roof facets">
            <div className="web-actions" style={{ marginTop: 0 }}>
              <Field label="Plan area unit">
                <select
                  className="fl-input"
                  value={areaUnit}
                  onChange={(e) => setAreaUnit(e.target.value as AreaDisplayUnit)}
                >
                  <option value="ft2">Square feet</option>
                  <option value="m2">Square metres</option>
                </select>
              </Field>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFacets((f) => [...f, newFacet(f.length + 1)])}
              >
                Add facet
              </Button>
            </div>
            {facets.map((facet, index) => (
              <div key={facet.id} className="web-calc-row">
                <Field label="Facet id">
                  <TextInput
                    value={facet.id}
                    onChange={(e) =>
                      setFacets((rows) =>
                        rows.map((r, i) => (i === index ? { ...r, id: e.target.value } : r)),
                      )
                    }
                  />
                </Field>
                <Field label="Structure">
                  <TextInput
                    value={facet.structureId}
                    onChange={(e) =>
                      setFacets((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, structureId: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`Plan area (${areaUnit})`} required>
                  <TextInput
                    inputMode="decimal"
                    value={facet.planArea}
                    onChange={(e) =>
                      setFacets((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, planArea: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Pitch rise" hint="Leave blank if pitch unknown">
                  <TextInput
                    inputMode="decimal"
                    value={facet.pitchRise}
                    onChange={(e) =>
                      setFacets((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, pitchRise: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Pitch run">
                  <TextInput
                    inputMode="decimal"
                    value={facet.pitchRun}
                    onChange={(e) =>
                      setFacets((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, pitchRun: e.target.value } : r,
                        ),
                      )
                    }
                  />
                </Field>
                {facets.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFacets((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </EstimateLayerSection>

          <EstimateLayerSection layer="measured" title="Edge lengths (ft)">
            <div className="web-calc-row">
              {(['eave', 'rake', 'ridge', 'hip', 'valley'] as const).map((key) => (
                <Field key={key} label={key}>
                  <TextInput
                    inputMode="decimal"
                    value={edges[key]}
                    onChange={(e) => setEdges((prev) => ({ ...prev, [key]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
          </EstimateLayerSection>

          <EstimateLayerSection layer="assumption" title="Waste, labor and markup">
            <div className="web-calc-row">
              <Field label="Waste %" hint="Applied once to shingles and ridge cap; edge accessories use 0%">
                <TextInput
                  inputMode="decimal"
                  value={wastePercent}
                  onChange={(e) => setWastePercent(e.target.value)}
                  suffix="%"
                />
              </Field>
              <Field label="Labor $/square" hint="Sloped squares, no waste">
                <TextInput
                  inputMode="decimal"
                  value={laborRate}
                  onChange={(e) => setLaborRate(e.target.value)}
                  prefix="$"
                />
              </Field>
              <Field label="Overhead %">
                <TextInput
                  inputMode="decimal"
                  value={overheadPercent}
                  onChange={(e) => setOverheadPercent(e.target.value)}
                  suffix="%"
                />
              </Field>
              <Field label="Markup %">
                <TextInput
                  inputMode="decimal"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(e.target.value)}
                  suffix="%"
                />
              </Field>
            </div>
          </EstimateLayerSection>

          <EstimateLayerSection layer="assumption" title="Material packs (example rates)">
            {materials.map((spec, index) => (
              <div key={spec.code} className="web-calc-row">
                <Field label={spec.description}>
                  <span className="web-muted web-small">{spec.code}</span>
                </Field>
                <Field label="Coverage / pack">
                  <TextInput
                    inputMode="decimal"
                    value={String(spec.coveragePerPack ?? '')}
                    onChange={(e) =>
                      setMaterials((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, coveragePerPack: e.target.value || null } : r,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label={`Price / ${spec.packUnit}`}>
                  <TextInput
                    inputMode="decimal"
                    value={String(spec.unitPrice ?? '')}
                    onChange={(e) =>
                      setMaterials((rows) =>
                        rows.map((r, i) =>
                          i === index ? { ...r, unitPrice: e.target.value || null } : r,
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
            <p className="web-muted">Enter a plan area, or load the worked example.</p>
          )}

          {result && totals && (
            <>
              <EstimateLayerSection layer="suggested" title="Areas and squares">
                <dl className="web-calc-stats">
                  <div>
                    <dt>Plan</dt>
                    <dd>
                      {formatQty(result.takeoff.planFt2, 1)} ft² (
                      {formatQty(result.takeoff.planM2, 2)} m²)
                    </dd>
                  </div>
                  <div>
                    <dt>Sloped</dt>
                    <dd>
                      {result.takeoff.slopedFt2
                        ? `${formatQty(result.takeoff.slopedFt2, 2)} ft²`
                        : 'Unresolved (pitch missing)'}
                    </dd>
                  </div>
                  <div>
                    <dt>Squares</dt>
                    <dd>{formatQty(result.takeoff.squares, 3)}</dd>
                  </div>
                  <div>
                    <dt>Waste</dt>
                    <dd>
                      {wasteDisplay != null
                        ? `${wasteDisplay}% (${result.wasteSource})`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </EstimateLayerSection>

              <EstimateLayerSection layer="suggested" title="Material order quantities">
                <div className="web-table-scroll">
                  <table className="web-matrix web-calc-table">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Order</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.materials.map((line) => (
                        <tr key={line.code}>
                          <td>
                            {line.code}
                            {line.unresolvedReason && (
                              <span className="web-muted web-small web-block">
                                {line.unresolvedReason}
                              </span>
                            )}
                          </td>
                          <td>
                            {line.orderPacks ? `${line.orderPacks} ${line.packUnit}` : '—'}
                          </td>
                          <td>{line.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </EstimateLayerSection>

              <EstimateLayerSection layer="approved" title="Cost estimate">
                <div className="web-calc-total-head">
                  <StatusPill
                    status={totals.status === 'priced' ? (totals.firm ? 'approved' : 'budgetary') : 'review_required'}
                    label={
                      totals.status === 'priced'
                        ? totals.firm
                          ? 'Firm'
                          : 'Range (not firm)'
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
                    Low/base/high shown because one or more inputs are bounded or uncertain. Do not
                    present a single firm price.
                  </RiskNotice>
                )}
                {totals.status === 'pending_review' && (
                  <RiskNotice kind="preliminary_quote" severity="danger">
                    Critical lines are unresolved. Totals are withheld (never shown as $0).
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
                            {line.quantity ? formatQty(line.quantity.base, 3) : '—'} {line.unit}
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
