'use client';

// ConstructionOS module 10 (Plumbing Pro) release-1 estimating slice: fixture schedule, measured
// pipe runs, deterministic takeoff, material pricing, labour and a printable preliminary proposal.
//
// Deliberately honest: quantities and money come from the shared engine in @fieldline/contracts, a
// live draft stays in this browser until the API persistence layer lands, sample prices are marked
// as samples, and nothing here claims code compliance or a professional design approval.
import {
  computeEstimate,
  FIXTURE_CATALOG,
  FIXTURE_TYPES,
  NOMINAL_SIZES_MM,
  PIPE_MATERIALS,
  PIPE_MATERIAL_LABELS,
  PLUMBING_SYSTEM_LABELS,
  PLUMBING_SYSTEMS,
  type FixtureLine,
  type FixtureType,
  type PipeMaterial,
  type PipeRun,
  type PlumbingEstimateResult,
  type PlumbingSystem,
  type TakeoffLine,
} from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useApi } from '../../lib/session';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';

const DRAFT_KEY = 'fieldpro.plumbing.draft.v1';
const FT_TO_MM = 304.8;

const SAMPLE_MATERIAL_PRICES: Record<PipeMaterial, { pipe: number; fitting: number }> = {
  pex_a: { pipe: 850, fitting: 320 },
  copper_type_l: { pipe: 2400, fitting: 900 },
  pvc_schedule_40: { pipe: 900, fitting: 260 },
  abs_schedule_40: { pipe: 950, fitting: 280 },
};

export interface RunDraft {
  id: string;
  label: string;
  system: PlumbingSystem;
  material: PipeMaterial;
  nominalSizeMm: number;
  lengthFt: string;
  stockLengthFt: string;
  wastePercent: string;
  extraElbows: string;
}

interface Draft {
  name: string;
  jurisdiction: string;
  fixtures: FixtureLine[];
  runs: RunDraft[];
  prices: Record<string, number>;
  laborRate: string;
  equipment: string;
  contingency: string;
  overhead: string;
  markup: string;
  tax: string;
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultDraft(): Draft {
  return {
    name: 'Bathroom rough-in',
    jurisdiction: '',
    fixtures: [
      { id: newId('fx'), type: 'water_closet', quantity: 1 },
      { id: newId('fx'), type: 'lavatory', quantity: 1 },
    ],
    runs: [
      {
        id: newId('run'),
        label: 'Cold riser to bathroom',
        system: 'cold_water',
        material: 'pex_a',
        nominalSizeMm: 20,
        lengthFt: '24',
        stockLengthFt: '20',
        wastePercent: '5',
        extraElbows: '0',
      },
    ],
    prices: {},
    laborRate: '95',
    equipment: '0',
    contingency: '5',
    overhead: '10',
    markup: '15',
    tax: '7',
  };
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Percentages are clamped to the engine's validated ranges so typing can never break the totals. */
function clampPercent(value: string, fallback: number, max: number): number {
  return Math.min(max, Math.max(0, parseNumber(value, fallback)));
}

function usd(minor: number): string {
  return (minor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function runToPipeRun(run: RunDraft): PipeRun {
  const lengthMm = Math.max(0, Math.round(parseNumber(run.lengthFt) * FT_TO_MM));
  return {
    id: run.id,
    label: run.label,
    system: run.system,
    material: run.material,
    nominalSizeMm: run.nominalSizeMm,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: lengthMm, y: 0, z: 0 },
    ],
    wastePercent: Math.min(25, Math.max(0, parseNumber(run.wastePercent, 5))),
    stockLengthMm: Math.max(100, Math.round(parseNumber(run.stockLengthFt, 20) * FT_TO_MM)),
    extraElbows: Math.max(0, Math.round(parseNumber(run.extraElbows))),
  };
}

const MAX_LINES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a stored draft before it reaches the estimator. A corrupted or hand-edited localStorage
 * entry must never crash the page or feed the engine a type it does not understand: unknown lines
 * are dropped, numbers are bounded, and anything unreadable falls back to the default document.
 */
export function sanitizeDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null;
  const base = defaultDraft();

  const fixtures = (
    Array.isArray(value.fixtures)
      ? value.fixtures.flatMap((item): FixtureLine[] => {
          if (!isRecord(item) || typeof item.id !== 'string') return [];
          if (!(FIXTURE_TYPES as readonly string[]).includes(String(item.type))) return [];
          const quantity = Number(item.quantity);
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) return [];
          return [{ id: item.id.slice(0, 80), type: item.type as FixtureType, quantity }];
        })
      : base.fixtures
  ).slice(0, MAX_LINES);

  const runs = (
    Array.isArray(value.runs)
      ? value.runs.flatMap((item): RunDraft[] => {
          if (!isRecord(item) || typeof item.id !== 'string') return [];
          if (!(PLUMBING_SYSTEMS as readonly string[]).includes(String(item.system))) return [];
          if (!(PIPE_MATERIALS as readonly string[]).includes(String(item.material))) return [];
          const size = Number(item.nominalSizeMm);
          if (!(NOMINAL_SIZES_MM as readonly number[]).includes(size)) return [];
          const text = (key: string, fallback: string): string =>
            typeof item[key] === 'string' ? (item[key] as string) : fallback;
          return [
            {
              id: item.id.slice(0, 80),
              label: text('label', '').slice(0, 120),
              system: item.system as PlumbingSystem,
              material: item.material as PipeMaterial,
              nominalSizeMm: size,
              lengthFt: text('lengthFt', '10'),
              stockLengthFt: text('stockLengthFt', '20'),
              wastePercent: text('wastePercent', '5'),
              extraElbows: text('extraElbows', '0'),
            },
          ];
        })
      : base.runs
  ).slice(0, MAX_LINES);

  const prices: Record<string, number> = {};
  if (isRecord(value.prices)) {
    for (const [key, price] of Object.entries(value.prices)) {
      if (typeof price === 'number' && Number.isInteger(price) && price >= 0) prices[key] = price;
    }
  }

  const text = (key: keyof Draft, fallback: string): string =>
    typeof value[key] === 'string' ? (value[key] as string) : fallback;

  return {
    name: text('name', base.name).slice(0, 200),
    jurisdiction: text('jurisdiction', '').slice(0, 120),
    fixtures,
    runs,
    prices,
    laborRate: text('laborRate', base.laborRate),
    equipment: text('equipment', base.equipment),
    contingency: text('contingency', base.contingency),
    overhead: text('overhead', base.overhead),
    markup: text('markup', base.markup),
    tax: text('tax', base.tax),
  };
}

/** Sample price used only to demonstrate the flow; the screen labels it as such. */
export function samplePriceMinor(line: TakeoffLine): number {
  const material = line.material ?? 'pex_a';
  const base = SAMPLE_MATERIAL_PRICES[material];
  const sizeFactor = 0.6 + (line.nominalSizeMm ?? 20) / 50;
  const unit = line.item === 'pipe' ? base.pipe : base.fitting;
  return Math.round(unit * sizeFactor);
}

export function PlumbingEstimatorView() {
  return (
    <RouteGate routeId="plumbing">
      <PlumbingEstimator />
    </RouteGate>
  );
}

function PlumbingEstimator() {
  const { endpoints } = useApi();
  const [draft, setDraft] = useState<Draft>(defaultDraft);
  const [restored, setRestored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<{
    projectId: string;
    revisionNumber: number;
    estimateId: string;
    totalMinor: number;
    unpriced: number;
  } | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);

  useEffect(() => {
    // Restore after paint: reading storage during render would break hydration, and a corrupt
    // draft must never block the estimator — the default document is shown instead.
    const handle = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(DRAFT_KEY);
        if (stored) {
          const restoredDraft = sanitizeDraft(JSON.parse(stored));
          if (restoredDraft) setDraft(restoredDraft);
        }
      } catch {
        // Ignore unreadable storage and keep the default document.
      }
      setRestored(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Private browsing may refuse storage: the screen still works for this session.
    }
  }, [draft, restored]);

  const result = useMemo<PlumbingEstimateResult>(() => {
    return computeEstimate({
      name: draft.name || 'Untitled plumbing estimate',
      jurisdiction: draft.jurisdiction,
      fixtures: draft.fixtures,
      runs: draft.runs.map(runToPipeRun),
      prices: draft.prices,
      laborRateMinorPerHour: Math.round(Math.max(0, parseNumber(draft.laborRate)) * 100),
      equipmentMinor: Math.round(Math.max(0, parseNumber(draft.equipment)) * 100),
      contingencyPercent: clampPercent(draft.contingency, 5, 50),
      overheadPercent: clampPercent(draft.overhead, 10, 50),
      markupPercent: clampPercent(draft.markup, 15, 100),
      taxPercent: clampPercent(draft.tax, 0, 30),
    });
  }, [draft]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  // Persists a company-owned project, an immutable revision and a server-computed estimate. The
  // server recalculates the totals; this screen only ever sends the inputs.
  const saveRecord = useMutation({
    mutationFn: async () => {
      // Reuse the project this draft already saved to; a second save adds the next immutable
      // revision instead of creating a duplicate project.
      const projectId =
        saved?.projectId ??
        (
          await endpoints.createPlumbingProject(
            { name: draft.name || 'Untitled plumbing estimate', jurisdiction: draft.jurisdiction },
            newIdempotencyKey(),
          )
        ).id;
      const revision = await endpoints.createPlumbingRevision(
        projectId,
        { design: { fixtures: draft.fixtures, runs: draft.runs.map(runToPipeRun) } },
        newIdempotencyKey(),
      );
      const estimate = await endpoints.computePlumbingEstimate(projectId, {
        revisionId: revision.id,
        prices: draft.prices,
        laborRateMinorPerHour: Math.round(Math.max(0, parseNumber(draft.laborRate)) * 100),
        equipmentMinor: Math.round(Math.max(0, parseNumber(draft.equipment)) * 100),
        contingencyPercent: clampPercent(draft.contingency, 5, 50),
        overheadPercent: clampPercent(draft.overhead, 10, 50),
        markupPercent: clampPercent(draft.markup, 15, 100),
        taxPercent: clampPercent(draft.tax, 0, 30),
      });
      return {
        projectId,
        revisionNumber: revision.revisionNumber,
        estimateId: estimate.id,
        totalMinor: estimate.totals.totalMinor,
        unpriced: estimate.unpricedLineKeys.length,
      };
    },
    onSuccess: (record) => {
      setSaved(record);
      setRecordError(null);
    },
    onError: (error) => setRecordError(errorHint(error)),
  });

  const approveRecord = useMutation({
    mutationFn: (input: { projectId: string; estimateId: string }) =>
      endpoints.approvePlumbingEstimate(input.projectId, input.estimateId),
    onSuccess: (approved) => {
      setSaved((current) =>
        current ? { ...current, totalMinor: approved.totals.totalMinor, unpriced: 0 } : current,
      );
      setRecordError(null);
    },
    onError: (error) => setRecordError(errorHint(error)),
  });

  const updateRun = (id: string, patch: Partial<RunDraft>) =>
    update({ runs: draft.runs.map((run) => (run.id === id ? { ...run, ...patch } : run)) });

  const updatePrice = (key: string, dollars: string) => {
    const cleaned = dollars.trim();
    if (cleaned === '') {
      const next = { ...draft.prices };
      delete next[key];
      update({ prices: next });
      return;
    }
    update({ prices: { ...draft.prices, [key]: Math.max(0, Math.round(parseNumber(cleaned) * 100)) } });
  };

  const applySamplePrices = () => {
    const prices: Record<string, number> = { ...draft.prices };
    for (const line of result.takeoff.lines) {
      if (prices[line.key] === undefined) prices[line.key] = samplePriceMinor(line);
    }
    update({ prices });
  };

  const summaryText = useMemo(() => {
    const lines = [
      `${draft.name}${draft.jurisdiction ? ` — ${draft.jurisdiction}` : ''}`,
      'PRELIMINARY PLUMBING ESTIMATE (calculated quantities; not a code-compliance review)',
      '',
      ...result.pricedLines.map(
        (priced) =>
          `${priced.line.description}: ${priced.line.quantity} ${priced.line.unit} @ ${usd(
            priced.unitPriceMinor,
          )} = ${usd(priced.totalMinor)}`,
      ),
      '',
      `Material ${usd(result.totals.materialMinor)}`,
      `Labour ${result.labor.hours} h = ${usd(result.totals.laborMinor)}`,
      `Equipment ${usd(result.totals.equipmentMinor)}`,
      `Contingency ${usd(result.totals.contingencyMinor)}`,
      `Overhead ${usd(result.totals.overheadMinor)}`,
      `Markup ${usd(result.totals.markupMinor)}`,
      `Tax ${usd(result.totals.taxMinor)}`,
      `Total ${usd(result.totals.totalMinor)}`,
      '',
      `${result.fixtures.totalQuantity} fixtures, ${result.fixtures.totalDrainageFu} DFU, ${result.fixtures.totalWaterSupplyFu} WSFU (sample planning values)`,
    ];
    return lines.join('\n');
  }, [draft.jurisdiction, draft.name, result]);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Plumbing"
        description="Measured takeoff, material and labour estimate, and a printable preliminary proposal. Calculated quantities only — not a code-compliance review."
        actions={
          <div className="web-actions">
            <button type="button" className="plumbing-button" onClick={applySamplePrices}>
              Use sample prices
            </button>
            <button type="button" className="plumbing-button" onClick={copySummary}>
              {copied ? 'Copied' : 'Copy summary'}
            </button>
            <button type="button" className="plumbing-button" onClick={() => window.print()}>
              Print
            </button>
          </div>
        }
      />

      <section className="web-card" aria-labelledby="plumbing-project-heading">
        <h2 id="plumbing-project-heading">Project</h2>
        <div className="plumbing-grid">
          <label>
            Project name
            <input
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              maxLength={200}
            />
          </label>
          <label>
            Jurisdiction (optional)
            <input
              value={draft.jurisdiction}
              onChange={(event) => update({ jurisdiction: event.target.value })}
              placeholder="City / state or code edition"
              maxLength={120}
            />
          </label>
        </div>
        <p className="web-muted web-small">
          This working draft stays in this browser. Saving stores a project, an immutable revision and a
          server-computed estimate in your company’s records, where no other company can read them. Sample
          prices, fixture units and productivity are planning placeholders — replace them with your price
          book and measured rates before sending anything to a customer.
        </p>
      </section>

      <section className="web-card" aria-labelledby="plumbing-fixtures-heading">
        <div className="web-section__head">
          <h2 id="plumbing-fixtures-heading">Fixtures</h2>
          <button
            type="button"
            className="plumbing-button"
            onClick={() =>
              update({
                fixtures: [...draft.fixtures, { id: newId('fx'), type: 'lavatory', quantity: 1 }],
              })
            }
          >
            Add fixture
          </button>
        </div>
        <div className="web-table-scroll">
          <table className="plumbing-table">
            <thead>
              <tr>
                <th scope="col">Fixture</th>
                <th scope="col">Quantity</th>
                <th scope="col">DFU</th>
                <th scope="col">WSFU</th>
                <th scope="col">
                  <span className="web-small web-muted">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.fixtures.map((fixture) => (
                <tr key={fixture.id}>
                  <td>
                    <select
                      aria-label="Fixture type"
                      value={fixture.type}
                      onChange={(event) =>
                        update({
                          fixtures: draft.fixtures.map((line) =>
                            line.id === fixture.id
                              ? { ...line, type: event.target.value as FixtureType }
                              : line,
                          ),
                        })
                      }
                    >
                      {FIXTURE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {FIXTURE_CATALOG[type].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="Fixture quantity"
                      type="number"
                      min={1}
                      max={1000}
                      value={fixture.quantity}
                      onChange={(event) =>
                        update({
                          fixtures: draft.fixtures.map((line) =>
                            line.id === fixture.id
                              ? { ...line, quantity: Math.max(1, Math.round(parseNumber(event.target.value, 1))) }
                              : line,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>{FIXTURE_CATALOG[fixture.type].drainageFu * fixture.quantity}</td>
                  <td>{FIXTURE_CATALOG[fixture.type].waterSupplyFu * fixture.quantity}</td>
                  <td>
                    <button
                      type="button"
                      className="plumbing-button"
                      onClick={() =>
                        update({ fixtures: draft.fixtures.filter((line) => line.id !== fixture.id) })
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="web-muted web-small">
          Totals: {result.fixtures.totalQuantity} fixtures · {result.fixtures.totalDrainageFu} DFU ·{' '}
          {result.fixtures.totalWaterSupplyFu} WSFU. Sample fixture values; confirm against the adopted code.
        </p>
      </section>

      <section className="web-card" aria-labelledby="plumbing-runs-heading">
        <div className="web-section__head">
          <h2 id="plumbing-runs-heading">Pipe runs</h2>
          <button
            type="button"
            className="plumbing-button"
            onClick={() =>
              update({
                runs: [
                  ...draft.runs,
                  {
                    id: newId('run'),
                    label: '',
                    system: 'cold_water',
                    material: 'pex_a',
                    nominalSizeMm: 15,
                    lengthFt: '10',
                    stockLengthFt: '20',
                    wastePercent: '5',
                    extraElbows: '0',
                  },
                ],
              })
            }
          >
            Add run
          </button>
        </div>
        <div className="web-table-scroll">
          <table className="plumbing-table">
            <thead>
              <tr>
                <th scope="col">Label</th>
                <th scope="col">System</th>
                <th scope="col">Material</th>
                <th scope="col">Size</th>
                <th scope="col">Length (ft)</th>
                <th scope="col">Stock (ft)</th>
                <th scope="col">Waste %</th>
                <th scope="col">Extra elbows</th>
                <th scope="col">
                  <span className="web-small web-muted">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <input
                      aria-label="Run label"
                      value={run.label}
                      onChange={(event) => updateRun(run.id, { label: event.target.value })}
                      maxLength={120}
                    />
                  </td>
                  <td>
                    <select
                      aria-label="Plumbing system"
                      value={run.system}
                      onChange={(event) =>
                        updateRun(run.id, { system: event.target.value as PlumbingSystem })
                      }
                    >
                      {PLUMBING_SYSTEMS.map((system) => (
                        <option key={system} value={system}>
                          {PLUMBING_SYSTEM_LABELS[system]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label="Pipe material"
                      value={run.material}
                      onChange={(event) =>
                        updateRun(run.id, { material: event.target.value as PipeMaterial })
                      }
                    >
                      {PIPE_MATERIALS.map((material) => (
                        <option key={material} value={material}>
                          {PIPE_MATERIAL_LABELS[material]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label="Nominal size"
                      value={run.nominalSizeMm}
                      onChange={(event) =>
                        updateRun(run.id, { nominalSizeMm: Number(event.target.value) })
                      }
                    >
                      {NOMINAL_SIZES_MM.map((size) => (
                        <option key={size} value={size}>
                          {size} mm
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="Measured length in feet"
                      type="number"
                      min={0}
                      step="0.5"
                      value={run.lengthFt}
                      onChange={(event) => updateRun(run.id, { lengthFt: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Stock length in feet"
                      type="number"
                      min={1}
                      value={run.stockLengthFt}
                      onChange={(event) => updateRun(run.id, { stockLengthFt: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Waste percent"
                      type="number"
                      min={0}
                      max={25}
                      value={run.wastePercent}
                      onChange={(event) => updateRun(run.id, { wastePercent: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Field-verified extra elbows"
                      type="number"
                      min={0}
                      value={run.extraElbows}
                      onChange={(event) => updateRun(run.id, { extraElbows: event.target.value })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="plumbing-button"
                      onClick={() => update({ runs: draft.runs.filter((line) => line.id !== run.id) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="web-muted web-small">
          Lengths are measured centrelines. Waste is applied before rounding up to whole stock lengths;
          couplings follow the number of sticks. Elbows shown are field-verified, not inferred from a drawing.
        </p>
      </section>

      <section className="web-card" aria-labelledby="plumbing-takeoff-heading">
        <h2 id="plumbing-takeoff-heading">Takeoff and prices</h2>
        {result.unpricedLineKeys.length > 0 && (
          <p className="web-muted web-small" role="status">
            {result.unpricedLineKeys.length} line(s) still need a price before this can be sent. Sample
            prices are placeholders, not your price book.
          </p>
        )}
        <div className="web-table-scroll">
          <table className="plumbing-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantity</th>
                <th scope="col">Source runs</th>
                <th scope="col">Unit price (USD)</th>
                <th scope="col">Line total</th>
              </tr>
            </thead>
            <tbody>
              {result.pricedLines.map((priced) => (
                <tr key={priced.line.key}>
                  <td>{priced.line.description}</td>
                  <td>
                    {priced.line.quantity} {priced.line.unit}
                  </td>
                  <td>{priced.line.sourceRunIds.length}</td>
                  <td>
                    <input
                      aria-label={`Unit price for ${priced.line.description}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.prices[priced.line.key] === undefined ? '' : String(draft.prices[priced.line.key]! / 100)}
                      onChange={(event) => updatePrice(priced.line.key, event.target.value)}
                    />
                  </td>
                  <td>{usd(priced.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="web-card" aria-labelledby="plumbing-summary-heading">
        <h2 id="plumbing-summary-heading">Preliminary proposal</h2>
        <div className="plumbing-grid">
          <label>
            Labour rate (USD/h)
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.laborRate}
              onChange={(event) => update({ laborRate: event.target.value })}
            />
          </label>
          <label>
            Equipment (USD)
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.equipment}
              onChange={(event) => update({ equipment: event.target.value })}
            />
          </label>
          <label>
            Contingency %
            <input
              type="number"
              min={0}
              max={50}
              value={draft.contingency}
              onChange={(event) => update({ contingency: event.target.value })}
            />
          </label>
          <label>
            Overhead %
            <input
              type="number"
              min={0}
              max={50}
              value={draft.overhead}
              onChange={(event) => update({ overhead: event.target.value })}
            />
          </label>
          <label>
            Markup %
            <input
              type="number"
              min={0}
              max={100}
              value={draft.markup}
              onChange={(event) => update({ markup: event.target.value })}
            />
          </label>
          <label>
            Tax %
            <input
              type="number"
              min={0}
              max={30}
              value={draft.tax}
              onChange={(event) => update({ tax: event.target.value })}
            />
          </label>
        </div>

        <dl className="plumbing-totals">
          <div>
            <dt>Material</dt>
            <dd>{usd(result.totals.materialMinor)}</dd>
          </div>
          <div>
            <dt>Labour ({result.labor.hours} h)</dt>
            <dd>{usd(result.totals.laborMinor)}</dd>
          </div>
          <div>
            <dt>Equipment</dt>
            <dd>{usd(result.totals.equipmentMinor)}</dd>
          </div>
          <div>
            <dt>Contingency</dt>
            <dd>{usd(result.totals.contingencyMinor)}</dd>
          </div>
          <div>
            <dt>Overhead</dt>
            <dd>{usd(result.totals.overheadMinor)}</dd>
          </div>
          <div>
            <dt>Markup</dt>
            <dd>{usd(result.totals.markupMinor)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{usd(result.totals.taxMinor)}</dd>
          </div>
          <div className="plumbing-totals__grand">
            <dt>Total</dt>
            <dd>{usd(result.totals.totalMinor)}</dd>
          </div>
        </dl>

        <p className="web-muted web-small">
          Preliminary only. Pipe lengths, fittings and totals are calculated from the inputs above with
          documented rounding. A licensed professional must review design, code compliance and final pricing
          before this is issued as a proposal.
        </p>
        <div className="web-actions">
          <button
            type="button"
            className="plumbing-button"
            onClick={() => {
              if (window.confirm('Replace this draft with a new estimate?')) {
                setDraft(defaultDraft());
                setSaved(null);
                setRecordError(null);
              }
            }}
          >
            New estimate
          </button>
        </div>
      </section>

      <section className="web-card" aria-labelledby="plumbing-records-heading">
        <h2 id="plumbing-records-heading">Company records</h2>
        <p className="web-muted web-small">
          Saving creates a plumbing project, stores this design as an immutable revision and computes the
          estimate on the server, so the totals are reproducible and belong to your company only. Approval
          is a separate permission and is audited; it is refused while any line is still unpriced.
        </p>
        <div className="web-actions">
          <button
            type="button"
            className="plumbing-button"
            onClick={() => saveRecord.mutate()}
            disabled={saveRecord.isPending}
          >
            {saveRecord.isPending
              ? 'Saving…'
              : saved
                ? 'Save new revision'
                : 'Save priced estimate to company records'}
          </button>
          {saved && (
            <button
              type="button"
              className="plumbing-button"
              onClick={() =>
                approveRecord.mutate({ projectId: saved.projectId, estimateId: saved.estimateId })
              }
              disabled={approveRecord.isPending || saved.unpriced > 0}
            >
              {approveRecord.isPending ? 'Approving…' : 'Approve estimate'}
            </button>
          )}
        </div>
        {recordError && (
          <p className="web-error" role="alert">
            {recordError}
          </p>
        )}
        {saved && (
          <p className="web-small" role="status">
            Saved revision {saved.revisionNumber} · {usd(saved.totalMinor)}
            {saved.unpriced > 0
              ? ` · ${saved.unpriced} line(s) still unpriced, so approval is blocked until they are priced.`
              : ' · all lines priced.'}
          </p>
        )}
      </section>
    </>
  );
}
