'use client';

// RF-017-FE / ADD-021-FE: address autocomplete (WAI-ARIA combobox). Every candidate shows its
// provider attribution, match precision, geocoder confidence and a "Synthetic" label for fixture
// data. Searching is read-only on the server. Two or more matches are never auto-picked.
import { AddressSearchResponseSchema, type AddressCandidate } from '@fieldline/contracts';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { errorHint } from '../../lib/api';
import type { PropertyApi } from './types';
import styles from './property.module.css';

export interface AddressSearchProps {
  api: PropertyApi;
  onSelect: (candidate: AddressCandidate, query: string) => void;
  /** Called when nothing matches, so the caller can offer a manual pin or site survey. */
  onNoMatch?: (query: string) => void;
  label?: string;
  debounceMs?: number;
}

const PRECISION_LABEL: Record<AddressCandidate['precision'], string> = {
  rooftop: 'Rooftop match',
  parcel: 'Parcel match',
  interpolated: 'Interpolated on street',
  street: 'Street only',
  locality: 'Town only',
};

export function AddressSearch({ api, onSelect, onNoMatch, label = 'Property address', debounceMs = 300 }: AddressSearchProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AddressCandidate[]>([]);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    // Short queries are not sent; `shown` below hides stale results without a state update here.
    if (q.length < 3) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState('searching');
      try {
        const res = await api.get('/v1/search/addresses', { query: { q }, schema: AddressSearchResponseSchema, signal: controller.signal });
        if (mine !== seq.current) return;
        setCandidates(res.candidates);
        setActive(-1);
        setError(null);
        setState('done');
        if (res.candidates.length === 0) onNoMatch?.(q);
      } catch (e) {
        if (mine !== seq.current || controller.signal.aborted) return;
        setError(errorHint(e));
        setState('error');
      }
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, query, debounceMs, onNoMatch]);

  function pick(c: AddressCandidate) {
    onSelect(c, query.trim());
    setCandidates([]);
    setActive(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!candidates.length || query.trim().length < 3) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % candidates.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? candidates.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(candidates[active]!);
    } else if (e.key === 'Escape') {
      setCandidates([]);
    }
  }

  const tooShort = query.trim().length < 3;
  const shown = tooShort ? [] : candidates;
  const open = shown.length > 0;
  return (
    <div className={styles.search}>
      <label htmlFor={`${id}-input`} className={styles.label}>
        {label}
      </label>
      <input
        id={`${id}-input`}
        className={styles.input}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        value={query}
        placeholder="Start typing a street address"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className={styles.status} aria-live="polite">
        {!tooShort && state === 'searching' && 'Searching…'}
        {!tooShort && state === 'done' && candidates.length > 1 && `${candidates.length} matches. Pick the right one; we never pick for you.`}
        {!tooShort && state === 'done' && candidates.length === 0 && 'No match. Drop a pin on the map or request a site survey.'}
        {state === 'error' && (error ?? 'Address search is unavailable.')}
      </p>
      {open && (
        <ul id={listId} role="listbox" className={styles.listbox} aria-label="Address matches">
          {shown.map((c, i) => (
            <li
              key={`${c.provider}:${c.placeId}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? `${styles.option} ${styles.optionActive}` : styles.option}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className={styles.optionLabel}>{c.label}</span>
              <span className={styles.optionMeta}>
                {PRECISION_LABEL[c.precision]} · confidence {Math.round(c.confidence * 100)}%
                {c.isSynthetic && <strong className={styles.synthetic}> · Synthetic test data</strong>}
              </span>
              <span className={styles.attribution}>{c.attribution}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
