'use client';

import { useMemo, useState } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { Kpi, money, NumberField, Panel, SelectField } from '../command/Panel';
import {
  computeElectricalQuote, DEFAULT_ELECTRICAL, electricalQuoteCsv, SERVICE_LABELS,
  type ElectricalSpec, type ServiceType,
} from './estimate';

const SERVICE_OPTIONS = (Object.keys(SERVICE_LABELS) as ServiceType[]).map((value) => ({
  value, label: SERVICE_LABELS[value],
}));

export function ElectricalEstimatorView() {
  return (
    <RouteGate routeId="electrical">
      <ElectricalContent />
    </RouteGate>
  );
}

function ElectricalContent() {
  const [spec, setSpec] = useState<ElectricalSpec>({
    ...DEFAULT_ELECTRICAL, prices: { ...DEFAULT_ELECTRICAL.prices },
  });
  const quote = useMemo(() => computeElectricalQuote(spec), [spec]);
  const num = <K extends keyof ElectricalSpec>(key: K) => (value: number) =>
    setSpec((prev) => ({ ...prev, [key]: Math.min(10_000_000, Math.max(0, value)) }));
  const price = (key: keyof ElectricalSpec['prices']) => (value: number) =>
    setSpec((prev) => ({
      ...prev,
      prices: { ...prev.prices, [key]: Math.min(10_000_000, Math.max(0, value)) },
    }));

  const downloadCsv = () => {
    const blob = new Blob([electricalQuoteCsv(spec, quote)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'electrical-estimate.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <Panel title="Electrical estimator — planning estimate only">
        <p className="web-muted web-small">
          Load figures use editable planning allowances and one demand factor. This is not
          an NEC Article 220 load calculation. Verify service size, GFCI/AFCI locations and
          local amendments before permitting. Prices are yours: leave a price at 0 and that
          line stays out of the total.
        </p>
        <div className="cc-grid">
          <NumberField label="Dwelling area" suffix="ft²" value={spec.dwellingSqFt} onChange={num('dwellingSqFt')} />
          <SelectField label="Scope" value={spec.serviceType} options={SERVICE_OPTIONS}
            onChange={(v) => setSpec((p) => ({ ...p, serviceType: v }))} />
          <NumberField label="Panel size" suffix="amps" value={spec.panelAmps} onChange={num('panelAmps')} />
          <NumberField label="Assumption: lighting VA/ft²" value={spec.lightingVaPerSqFt} onChange={num('lightingVaPerSqFt')} />
          <NumberField label="Assumption: demand factor" step={0.05} value={spec.demandFactor} onChange={num('demandFactor')} />
          <NumberField label="General circuits" value={spec.generalCircuits} onChange={num('generalCircuits')} />
          <NumberField label="Kitchen circuits" value={spec.kitchenCircuits} onChange={num('kitchenCircuits')} />
          <NumberField label="Bathroom circuits" value={spec.bathroomCircuits} onChange={num('bathroomCircuits')} />
          <NumberField label="Laundry circuits" value={spec.laundryCircuits} onChange={num('laundryCircuits')} />
          <NumberField label="Dedicated circuits" value={spec.dedicatedCircuits} onChange={num('dedicatedCircuits')} />
          <NumberField label="Receptacles" value={spec.receptacles} onChange={num('receptacles')} />
          <NumberField label="Switches" value={spec.switches} onChange={num('switches')} />
          <NumberField label="Light fixtures" value={spec.lightFixtures} onChange={num('lightFixtures')} />
          <NumberField label="Wire run" suffix="linear ft" value={spec.wireRunFt} onChange={num('wireRunFt')} />
          <NumberField label="Waste" suffix="%" value={spec.wastePercent} onChange={num('wastePercent')} />
          <NumberField label="Labor hours" value={spec.laborHours} onChange={num('laborHours')} />
        </div>
      </Panel>

      <Panel title="Your prices (0 = not priced yet)">
        <div className="cc-grid">
          <NumberField label="Panel each" suffix="USD" value={spec.prices.panelEach} onChange={price('panelEach')} />
          <NumberField label="Breaker each" suffix="USD" value={spec.prices.breakerEach} onChange={price('breakerEach')} />
          <NumberField label="Receptacle each" suffix="USD" value={spec.prices.receptacleEach} onChange={price('receptacleEach')} />
          <NumberField label="Switch each" suffix="USD" value={spec.prices.switchEach} onChange={price('switchEach')} />
          <NumberField label="Fixture each" suffix="USD" value={spec.prices.fixtureEach} onChange={price('fixtureEach')} />
          <NumberField label="Wire per linear ft" suffix="USD" value={spec.prices.wirePerLinearFt} onChange={price('wirePerLinearFt')} />
          <NumberField label="Labor rate" suffix="USD/hr" value={spec.laborRate} onChange={num('laborRate')} />
          <NumberField label="Trip fee" suffix="USD" value={spec.tripFee} onChange={num('tripFee')} />
          <NumberField label="Tax" suffix="%" value={spec.taxPercent} onChange={num('taxPercent')} />
        </div>
      </Panel>

      <Panel title="Estimate">
        <div className="cc-grid">
          <Kpi label="Planning demand" value={`${quote.demandVa.toLocaleString()} VA`} />
          <Kpi label="Demand at 240V" value={`${quote.demandAmps} A`} />
          <Kpi label="Circuits" value={String(quote.totalCircuits)} />
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
