'use client';

import { useState } from 'react';
import { fetchLivePrices } from '../build/live';
import {
  LINKED_SUPPLIERS,
  SUPPLIERS,
  type LiveOffer,
  type LivePriceResponse,
} from '../build/prices';
import { money } from './Panel';

/** Retailer search links for a material, opened in a new tab. */
export function SupplierLinks({ query }: { query: string }) {
  return (
    <span className="cc-links">
      {LINKED_SUPPLIERS.map((id) => (
        <a key={id} href={SUPPLIERS[id].searchUrl(query)} target="_blank" rel="noopener noreferrer">
          {SUPPLIERS[id].name} ↗
        </a>
      ))}
    </span>
  );
}

export function OfferList({
  result,
  onUse,
}: {
  result: LivePriceResponse;
  onUse?: (offer: LiveOffer) => void;
}) {
  if (result.offers.length === 0) {
    return result.message ? <p className="web-muted web-small">{result.message}</p> : null;
  }
  return (
    <ul className="cc-offers" aria-label={`Live prices for ${result.query}, cheapest first`}>
      {result.offers.map((o, i) => (
        <li key={`${o.seller}-${o.price}-${i}`} style={{ animationDelay: `${i * 40}ms` }}>
          <span style={{ minWidth: 0 }}>
            <strong>{o.seller}</strong>
            {i === 0 && (
              <span className="cc-chip cc-chip--green" style={{ marginLeft: 6 }}>
                CHEAPEST
              </span>
            )}
            <span className="cc-formula" title={o.title}>
              {o.link ? (
                <a href={o.link} target="_blank" rel="noopener noreferrer">
                  {o.title}
                </a>
              ) : (
                o.title
              )}
            </span>
          </span>
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <span className="cc-mono">{money(o.price)}</span>
            {onUse && (
              <button type="button" className="cc-btn cc-btn--sm" onClick={() => onUse(o)}>
                Use
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Free-text material search: live cheapest-first offers when configured, retailer links always. */
export function MaterialLookup({ location }: { location?: string }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LivePriceResponse | null>(null);
  const trimmed = query.trim();

  return (
    <div className="cc-stack" style={{ gap: '0.6rem' }}>
      <form
        style={{ display: 'flex', gap: '0.5rem' }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (trimmed.length < 2) return;
          setBusy(true);
          setResult(await fetchLivePrices(trimmed, location));
          setBusy(false);
        }}
      >
        <label className="cc-sr-only" htmlFor="material-lookup">
          Material to price
        </label>
        <input
          id="material-lookup"
          className="cc-input"
          placeholder="e.g. 2x4x8 stud, 80 lb concrete, R-13 batt"
          value={query}
          maxLength={120}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <button
          type="submit"
          className="cc-btn cc-btn--primary"
          disabled={busy || trimmed.length < 2}
        >
          {busy ? 'Scanning…' : 'Find cheapest'}
        </button>
      </form>
      {busy && <div className="cc-skeleton" style={{ height: 64 }} />}
      {!busy && result && <OfferList result={result} />}
      {trimmed.length >= 2 && (
        <div>
          <div className="cc-eyebrow" style={{ marginBottom: 4 }}>
            Compare at retailers
          </div>
          <SupplierLinks query={trimmed} />
        </div>
      )}
    </div>
  );
}
