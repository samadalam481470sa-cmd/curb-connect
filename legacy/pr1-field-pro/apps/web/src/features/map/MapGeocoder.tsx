'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApi } from '../../lib/session';
import { geocodeAddress, type GeocodeHit } from './geocode';

export interface MapGeocoderProps {
  readonly onSelect: (hit: GeocodeHit) => void;
  readonly placeholder?: string;
  readonly className?: string;
}

export function MapGeocoder({
  onSelect,
  placeholder = 'Search address or place…',
  className,
}: MapGeocoderProps) {
  const { api } = useApi();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [remoteHits, setRemoteHits] = useState<GeocodeHit[]>([]);
  const [source, setSource] = useState<'api' | 'nominatim' | 'empty' | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);

  const trimmed = query.trim();
  const hits = useMemo(
    () => (trimmed.length < 3 ? [] : remoteHits),
    [trimmed, remoteHits],
  );

  useEffect(() => {
    if (trimmed.length < 3) return;
    const seq = ++requestSeq.current;
    const t = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      setError(null);
      void geocodeAddress(api, trimmed, ac.signal)
        .then((result) => {
          if (ac.signal.aborted || seq !== requestSeq.current) return;
          setRemoteHits(result.hits);
          setSource(result.source);
          setOpen(true);
        })
        .catch((err: unknown) => {
          if (ac.signal.aborted || seq !== requestSeq.current) return;
          setError(err instanceof Error ? err.message : 'Search failed');
          setRemoteHits([]);
        })
        .finally(() => {
          if (!ac.signal.aborted && seq === requestSeq.current) setBusy(false);
        });
    }, 350);
    return () => {
      window.clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [api, trimmed]);

  return (
    <div className={className ? `web-map-geocoder ${className}` : 'web-map-geocoder'}>
      <label className="web-map-geocoder__label" htmlFor={`${listId}-input`}>
        Address search
      </label>
      <input
        id={`${listId}-input`}
        className="web-map-geocoder__input"
        type="search"
        autoComplete="street-address"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
      />
      {busy && <span className="web-map-geocoder__status">Searching…</span>}
      {source === 'nominatim' && trimmed.length >= 3 && (
        <span className="web-map-geocoder__status web-muted web-small">
          Via OpenStreetMap Nominatim (API geocode unavailable)
        </span>
      )}
      {error && (
        <span className="web-map-geocoder__status web-error" role="alert">
          {error}
        </span>
      )}
      {open && hits.length > 0 && (
        <ul id={listId} className="web-map-geocoder__list" role="listbox">
          {hits.map((hit) => (
            <li key={hit.id} role="option">
              <button
                type="button"
                className="web-map-geocoder__hit"
                onClick={() => {
                  onSelect(hit);
                  setQuery(hit.label);
                  setOpen(false);
                }}
              >
                {hit.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
