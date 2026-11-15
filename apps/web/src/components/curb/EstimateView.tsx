'use client';

// CP-058 / ADD-049 curb estimate view. When the revision is not binding (budgetary range, review
// required, unpriced or stale) a PRELIMINARY / BUDGETARY banner is shown that has no dismiss
// control. Low / base / high totals and the base line items follow; unknown inputs are listed
// separately and never priced as zero. Blockers and warnings come from the server's gating.
import type { Estimate } from '@fieldline/contracts';
import { formatMinorUnits, RiskNotice, StatusPill } from '@fieldline/ui';
import { estimateBanner, splitInputs } from './model';

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function EstimateView({ estimate, locale = 'en-US' }: { estimate: Estimate; locale?: string }) {
  const rev = estimate.currentRevision;
  const banner = estimateBanner(rev, estimate.stale);
  const money = (minor: number | undefined) => (minor === undefined ? 'Hidden' : formatMinorUnits(BigInt(minor), rev?.currency ?? 'USD', locale));
  const inputs = rev ? splitInputs(rev.inputs) : { known: [], unknown: [] };

  return (
    <div className="curb-estimate">
      {banner.show && (
        <RiskNotice kind="preliminary_quote" title={banner.title} sticky>
          This is not a binding quote. It may change after field verification, permits, utility clearance and review.
          {estimate.stale && ` Changed: ${estimate.stale.reason}.`}
        </RiskNotice>
      )}
      <div className="curb-row">
        <strong>Estimate {estimate.number}</strong>
        <StatusPill status={estimate.status} machine="curbEstimate" />
        {rev && <span className="curb-tag">{humanize(rev.quoteKind)}</span>}
        {rev && <span className="web-muted">Revision {rev.revisionNumber}</span>}
      </div>
      {!rev && <p className="curb-warn">Not priced yet.</p>}
      {rev && rev.scenarios === null && <p className="curb-warn">Pricing is pending review. No amount is shown until it is reviewed.</p>}
      {rev?.scenarios && (
        <>
          <dl className="curb-scenarios" aria-label="Price range">
            {(['low', 'base', 'high'] as const).map((k) => (
              <div key={k} data-scenario={k}>
                <dt>{k === 'base' ? 'Base' : k === 'low' ? 'Low' : 'High'}</dt>
                <dd>{money(rev.scenarios![k].totalMinor)}</dd>
              </div>
            ))}
          </dl>
          <table className="curb-table">
            <caption>Line items (base scenario)</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantity</th>
                <th scope="col">Rate</th>
                <th scope="col">Amount</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {rev.scenarios.base.lines.map((l) => (
                <tr key={`${l.code}-${l.costComponent}`}>
                  <td>{l.label}</td>
                  <td>
                    {l.quantity} {l.unit}
                  </td>
                  <td>{l.unitRate ?? '—'}</td>
                  <td>{money(l.amountMinor)}</td>
                  <td>{l.quantitySource.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {rev.scenarios.base.directMinor !== undefined && (
                <tr>
                  <th scope="row" colSpan={3}>Direct cost</th>
                  <td colSpan={2}>{money(rev.scenarios.base.directMinor)}</td>
                </tr>
              )}
              <tr>
                <th scope="row" colSpan={3}>Subtotal</th>
                <td colSpan={2}>{money(rev.scenarios.base.subtotalMinor)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>Tax</th>
                <td colSpan={2}>{money(rev.scenarios.base.taxMinor)}</td>
              </tr>
              <tr>
                <th scope="row" colSpan={3}>Total</th>
                <td colSpan={2}>{money(rev.scenarios.base.totalMinor)}</td>
              </tr>
            </tfoot>
          </table>
        </>
      )}
      {rev && (
        <div className="curb-columns">
          <section aria-labelledby="known-inputs">
            <h3 id="known-inputs">Recorded inputs</h3>
            <ul className="curb-list">
              {inputs.known.map((k) => {
                const m = rev.inputs[k] as { value: number; unit: string; source: string };
                return (
                  <li key={k}>
                    {humanize(k)}: {m.value} {m.unit} <span className="web-muted">({humanize(m.source)})</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="unknown-inputs" className="curb-unknowns">
            <h3 id="unknown-inputs">Unknowns ({inputs.unknown.length})</h3>
            {inputs.unknown.length === 0 ? (
              <p className="web-muted">None.</p>
            ) : (
              <ul className="curb-list">
                {inputs.unknown.map((k) => (
                  <li key={k}>
                    {humanize(k)}: not priced, widens the range
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {rev && (rev.gating.blockers.length > 0 || rev.gating.warnings.length > 0) && (
        <section aria-labelledby="gating">
          <h3 id="gating">Why this is not firm</h3>
          <ul className="curb-list">
            {rev.gating.blockers.map((b) => (
              <li key={b.code} data-severity="blocking">
                <strong>Blocker:</strong> {b.message}
                {b.resolution && <em> {b.resolution}</em>}
              </li>
            ))}
            {rev.gating.warnings.map((b) => (
              <li key={b.code} data-severity="warning">
                <strong>Warning:</strong> {b.message}
              </li>
            ))}
          </ul>
        </section>
      )}
      {rev && rev.assumptions.length > 0 && (
        <section aria-labelledby="assumptions">
          <h3 id="assumptions">Assumptions and exclusions</h3>
          <ul className="curb-list">
            {rev.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
