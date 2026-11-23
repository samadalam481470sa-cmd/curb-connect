'use client';

import { useMemo, useState } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { Kpi, money, NumberField, Panel, SelectField } from '../command/Panel';
import {
  computeHvacQuote, DEFAULT_HVAC, DUCT_LABELS, hvacQuoteCsv, SYSTEM_LABELS,
  type DuctScope, type HvacSpec, type SystemType,
} from './estimate';

const SYSTEM_OPTIONS = (Object.keys(SYSTEM_LABELS) as SystemType[]).map((value) => ({
  value, label: SYSTEM_LABELS[value],
}));
const DUCT_OPTIONS = (Object.keys(DUCT_LABELS) as DuctScope[]).map((value) => ({
  value, label: DUCT_LABELS[value],
}));

export function HvacEstimatorView() {
  return (
    <RouteGate routeId="hvac">
      <HvacContent />
    </RouteGate>
  );
}

function HvacContent() {
  const [spec, setSpec] = useState<HvacSpec>({ ...DEFAULT_HVAC, prices: { ...DEFAULT_HVAC.prices } });
  const quote = useMemo(() => computeHvacQuote(spec), [spec]);
  const num = <K extends keyof HvacSpec>(key: K) => (value: number) =>
    setSpec((prev) => ({ ...prev, [key]: Math.min(10_000_000, Math.max(0, value)) }));
  const price = (key: keyof HvacSpec['prices']) => (value: number) =>
    setSpec((prev) => ({
      ...prev,
      prices: { ...prev.prices, [key]: Math.min(10_000_000, Math.max(0, value)) },
    }));

  const downloadCsv = () => {
    const blob = new Blob([hvacQuoteCsv(spec, quote)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hvac-estimate.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <Panel title="HVAC estimator — planning estimate only">
        <p className="web-muted web-small">
          Sizing uses editable rules of thumb (sq ft per ton, CFM per ton). This is not a
          Manual J load calculation or Manual D duct design. Run a load calculation before
          ordering equipment. Prices are yours: leave a price at 0 and that line stays out
          of the total.
        </p>
        <div className="cc-grid">
          <NumberField label="Conditioned area" suffix="ft²" value={spec.conditionedSqFt} onChange={num('conditionedSqFt')} />
          <NumberField label="Assumption: sq ft per ton" value={spec.sqFtPerTon} onChange={num('sqFtPerTon')} />
          <NumberField label="Assumption: CFM per ton" value={spec.cfmPerTon} onChange={num('cfmPerTon')} />
          <SelectField label="System type" value={spec.systemType} options={SYSTEM_OPTIONS}
            onChange={(v) => setSpec((p) => ({ ...p, systemType: v }))} />
          <SelectField label="Duct scope" value={spec.ductScope} options={DUCT_OPTIONS}
            onChange={(v) => setSpec((p) => ({ ...p, ductScope: v }))} />
          <NumberField label="Duct length" suffix="linear ft" value={spec.ductLinearFt} onChange={num('ductLinearFt')} />
          <NumberField label="Supply registers" value={spec.supplyRegisters} onChange={num('supplyRegisters')} />
          <NumberField label="Return grilles" value={spec.returnGrilles} onChange={num('returnGrilles')} />
          <NumberField label="Thermostats" value={spec.thermostats} onChange={num('thermostats')} />
          <NumberField label="Zones" value={spec.zones} onChange={num('zones')} />
          <NumberField label="Waste" suffix="%" value={spec.wastePercent} onChange={num('wastePercent')} />
          <NumberField label="Labor hours" value={spec.laborHours} onChange={num('laborHours')} />
        </div>
      </Panel>

      <Panel title="Your prices (0 = not priced yet)">
        <div className="cc-grid">
          <NumberField label="Equipment per ton" suffix="USD" value={spec.prices.equipmentPerTon} onChange={price('equipmentPerTon')} />
          <NumberField label="Duct per linear ft" suffix="USD" value={spec.prices.ductPerLinearFt} onChange={price('ductPerLinearFt')} />
          <NumberField label="Register each" suffix="USD" value={spec.prices.registerEach} onChange={price('registerEach')} />
          <NumberField label="Return grille each" suffix="USD" value={spec.prices.returnGrilleEach} onChange={price('returnGrilleEach')} />
          <NumberField label="Thermostat each" suffix="USD" value={spec.prices.thermostatEach} onChange={price('thermostatEach')} />
          <NumberField label="Zone kit each" suffix="USD" value={spec.prices.zoneKitEach} onChange={price('zoneKitEach')} />
          <NumberField label="Labor rate" suffix="USD/hr" value={spec.laborRate} onChange={num('laborRate')} />
          <NumberField label="Trip fee" suffix="USD" value={spec.tripFee} onChange={num('tripFee')} />
          <NumberField label="Tax" suffix="%" value={spec.taxPercent} onChange={num('taxPercent')} />
        </div>
      </Panel>

      <Panel title="Estimate">
        <div className="cc-grid">
          <Kpi label="Selected size" value={`${quote.tonsSelected} tons`} />
          <Kpi label="Capacity" value={`${quote.btuPerHour.toLocaleString()} BTU/hr`} />
          <Kpi label="Design airflow" value={`${quote.designCfm.toLocaleString()} CFM`} />
          <Kpi label="Total (priced lines)" value={money(quote.total)} />
        </div>
        {quote.unpricedCount > 0 && (
          <p className="web-muted web-small">
            {quote.unpricedCount} line(s) have no price yet and are excluded from the total.
          </p>
        )}
        <table className="cc-table">
          <thead>
            <tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {quote.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.label}<div className="web-muted web-small">{l.detail}</div></td>
                <td>{l.qty} {l.unit}</td>
                <td>{l.unitPrice === null ? 'Not priced' : money(l.unitPrice)}</td>
                <td>{l.amount === null ? '—' : money(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="web-muted web-small">
          {quote.assumptions.map((a) => <li key={a}>{a}</li>)}
        </ul>
        <button type="button" className="cc-btn" onClick={downloadCsv}>
          Download CSV
        </button>
      </Panel>
    </div>
  );
}
