'use client';

import { useState, type FormEvent } from 'react';
import { buildQuickEstimate, parseQuickEstimate, type QuickEstimate as Estimate } from './quickEstimate';

const EXAMPLES = [
  'Re-roof 2,400 sq ft at 8/12 with 3 curbs, waste 12%',
  '1,800 sq ft roof, pitch 6, 2 skylights',
];

/** Plain-language roof estimate. Every figure comes from the takeoff engine; assumptions are shown. */
export function QuickEstimate() {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseQuickEstimate(text);
    if (!parsed.ok) {
      setEstimate(null);
      setError(parsed.error);
      return;
    }
    setError(null);
    setEstimate(buildQuickEstimate(parsed.input));
  }

  return (
    <div>
      <form onSubmit={submit} role="search" aria-label="Quick roof estimate">
        <label htmlFor="quick-estimate-input" className="web-muted">
          Describe the job
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            id="quick-estimate-input"
            className="cc-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. 2,400 sq ft at 8/12 with 3 curbs"
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" className="cc-btn cc-btn--primary" disabled={text.trim().length === 0}>
            Estimate
          </button>
        </div>
      </form>
      <p className="web-muted" style={{ marginTop: 6 }}>
        Try: {EXAMPLES.map((example, i) => (
          <span key={example}>
            {i > 0 && ' · '}
            <button type="button" className="web-link" onClick={() => setText(example)}>
              {example}
            </button>
          </span>
        ))}
      </p>
      {error && (
        <p role="alert" className="web-info">
          {error}
        </p>
      )}
      {estimate && (
        <div aria-live="polite" style={{ marginTop: 10 }}>
          <dl className="web-kv">
            <dt>Roof area (plan)</dt>
            <dd>{estimate.roof.planSqFt.toLocaleString()} sq ft</dd>
            <dt>Sloped area at {estimate.input.pitch}/12</dt>
            <dd>{estimate.roof.slopedSqFt.toLocaleString()} sq ft</dd>
            <dt>Squares with {estimate.input.wastePercent}% waste</dt>
            <dd>{estimate.roof.squaresWithWaste}</dd>
            <dt>Shingle bundles (3 per square)</dt>
            <dd>{estimate.roof.bundles}</dd>
            <dt>Underlayment rolls</dt>
            <dd>{estimate.roof.underlaymentRolls}</dd>
            <dt>Deck sheets</dt>
            <dd>{estimate.roof.deckSheets}</dd>
            <dt>Curbs / penetrations counted</dt>
            <dd>{estimate.curbs}</dd>
          </dl>
          <p className="web-muted">
            Assumed: {estimate.input.assumed.pitch ? `pitch ${estimate.input.pitch}/12` : ''}
            {estimate.input.assumed.pitch && estimate.input.assumed.waste ? ', ' : ''}
            {estimate.input.assumed.waste ? `waste ${estimate.input.wastePercent}%` : ''}
            {!estimate.input.assumed.pitch && !estimate.input.assumed.waste ? 'nothing' : ''}
            . Confirm the pitch on site. Nails, drip edge and curb flashing are not priced by this
            quick estimate; use the Roof or Build workspace for the full line-item takeoff.
          </p>
        </div>
      )}
    </div>
  );
}
