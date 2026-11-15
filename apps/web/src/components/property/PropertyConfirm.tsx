'use client';

// RF-017-FE / RF-024-FE / RF-077-FE: confirm a picked address before anything is spent on it.
//  - drag the pin (the original geocoded point is kept by the server; the pin is stored separately),
//  - decide every candidate structure explicitly (included / excluded / unmeasured): with two or
//    more candidates nothing is preselected,
//  - see the jurisdiction result and pick the locality manually when boundaries overlap.
// Saves show the starter's honest states: Saving…, Saved to server, Conflict — review required, or
// Save failed — draft retained. Idempotency keys are stable per attempt so a retry never doubles.
import {
  type AddressCandidate,
  type GeoPoint,
  PropertySchema,
  StructureSchema,
  type StructureScopeStatus,
} from '@fieldline/contracts';
import { Button } from '@fieldline/ui';
import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { PinMap } from './PinMap';
import type { PropertyApi } from './types';
import styles from './property.module.css';

const PropertyDetailSchema = PropertySchema.extend({ structures: z.array(StructureSchema) });
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>;
const CommandResponse = z.object({ receipt: z.object({ server_revision: z.number() }).loose(), property: PropertyDetailSchema });

export type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'failed';
const SAVE_LABEL: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved to server',
  conflict: 'Conflict — review required',
  failed: 'Save failed — draft retained',
};

export interface PropertyConfirmProps {
  api: PropertyApi;
  query: string;
  candidate: AddressCandidate;
  onConfirmed: (property: PropertyDetail) => void;
  label?: string;
}

const SCOPES: { value: StructureScopeStatus; label: string }[] = [
  { value: 'included', label: 'In scope' },
  { value: 'excluded', label: 'Not in scope' },
  { value: 'unmeasured', label: 'In scope, cannot be measured yet' },
];

export function PropertyConfirm({ api, query, candidate, onConfirmed, label }: PropertyConfirmProps) {
  const [pin, setPin] = useState<GeoPoint>(candidate.location);
  const moved = pin.coordinates[0] !== candidate.location.coordinates[0] || pin.coordinates[1] !== candidate.location.coordinates[1];
  const single = candidate.structures.length === 1 && candidate.precision === 'rooftop';
  const [scope, setScope] = useState<Record<string, StructureScopeStatus | undefined>>(() =>
    single ? { [candidate.structures[0]!.ref]: 'included' } : {},
  );
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [locality, setLocality] = useState<string>('');
  const createKey = useRef(crypto.randomUUID());

  const undecided = candidate.structures.filter((s) => !scope[s.ref]);
  const footprints = useMemo(
    () => candidate.structures.map((s) => ({ id: s.ref, label: s.label, footprint: s.footprint, selected: scope[s.ref] === 'included' || scope[s.ref] === 'unmeasured' })),
    [candidate.structures, scope],
  );

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setSave('saving');
    setMessage(null);
    try {
      const out = await fn();
      setSave('saved');
      return out;
    } catch (e) {
      if (isApiError(e) && e.is('revision_conflict')) {
        setSave('conflict');
        setMessage('Someone else changed this property. Reload it and compare before saving again.');
      } else {
        setSave('failed');
        setMessage(errorHint(e));
      }
      return null;
    }
  }

  async function confirm() {
    let p = property;
    if (!p) {
      p = await run(() =>
        api.post(
          '/v1/properties',
          { originalQuery: query, candidate, ...(label && { label }), ...((moved || !candidate.storable) && { confirmedLocation: pin }) },
          { schema: PropertyDetailSchema, idempotencyKey: createKey.current },
        ),
      );
      if (!p) return;
      setProperty(p);
    }
    if (p.structures.length > 0 && p.scopeConfirmedAt == null) {
      const decisions = p.structures.map((s, i) => ({ structureId: s.id, scopeStatus: scope[candidate.structures[i]?.ref ?? ''] ?? s.scopeStatus }));
      const res = await run(() =>
        api.post(`/v1/properties/${p!.id}/scope`, { expectedRevision: p!.revision, structures: decisions }, { schema: CommandResponse, idempotencyKey: crypto.randomUUID() }),
      );
      if (!res) return;
      p = res.property;
      setProperty(p);
    }
    if (p.jurisdiction?.status !== 'ambiguous' && p.jurisdiction?.status !== 'unresolved') onConfirmed(p);
  }

  async function pickLocality() {
    if (!property || !locality) return;
    const res = await run(() =>
      api.post(`/v1/properties/${property.id}/jurisdiction`, { expectedRevision: property.revision, jurisdictionId: locality }, { schema: CommandResponse, idempotencyKey: crypto.randomUUID() }),
    );
    if (res) {
      setProperty(res.property);
      onConfirmed(res.property);
    }
  }

  const jurisdiction = property?.jurisdiction;
  return (
    <section className={styles.confirm} aria-labelledby="property-confirm-title">
      <h2 id="property-confirm-title">Confirm the property</h2>
      <p>
        <strong>{candidate.label}</strong>
        {candidate.isSynthetic && <span className={styles.synthetic}> · Synthetic test data</span>}
      </p>
      <p className={styles.optionMeta}>
        Geocoder: {candidate.attribution} · confidence {Math.round(candidate.confidence * 100)}%
        {!candidate.storable && ' · this provider does not allow storing its point, so your pin is saved instead'}
      </p>

      <PinMap point={pin} footprints={footprints} onMove={setPin} />
      {moved && <p className={styles.status}>Pin moved. The original search result is kept as evidence.</p>}

      {candidate.structures.length > 0 && (
        <fieldset className={styles.structures}>
          <legend>Which buildings are in scope?</legend>
          {candidate.structures.length > 1 && <p className={styles.status}>Several buildings match this address. Decide each one; nothing is assumed.</p>}
          {candidate.structures.map((s) => (
            <div key={s.ref} role="radiogroup" aria-label={s.label} className={styles.structure}>
              <span className={styles.optionLabel}>
                {s.label}
                {s.detectionConfidence !== null && <span className={styles.optionMeta}> · building detection {Math.round(s.detectionConfidence * 100)}%</span>}
              </span>
              {SCOPES.map((o) => (
                <label key={o.value} className={styles.radio}>
                  <input type="radio" name={`scope-${s.ref}`} value={o.value} checked={scope[s.ref] === o.value} onChange={() => setScope((prev) => ({ ...prev, [s.ref]: o.value }))} />
                  {o.label}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      )}

      {jurisdiction && (jurisdiction.status === 'ambiguous' || jurisdiction.status === 'unresolved') && (
        <div className={styles.locality} role="group" aria-labelledby="locality-title">
          <h3 id="locality-title">{jurisdiction.status === 'ambiguous' ? 'Two or more jurisdictions claim this location' : 'No jurisdiction boundary matched'}</h3>
          <p className={styles.status}>Permit and right-of-way rules stay unresolved until you pick the locality and verify it.</p>
          {jurisdiction.candidates.length > 0 ? (
            <label>
              Locality
              <select value={locality} onChange={(e) => setLocality(e.target.value)}>
                <option value="">Choose…</option>
                {jurisdiction.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind}){c.isSynthetic ? ' · synthetic' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className={styles.status}>No candidate boundary is on file for this point. Continue without one; regulatory checks will require manual verification.</p>
          )}
          <div className={styles.actions}>
            {jurisdiction.candidates.length > 0 && (
              <Button onClick={pickLocality} disabled={!locality || save === 'saving'}>
                Use this locality
              </Button>
            )}
            <Button variant="secondary" onClick={() => onConfirmed(property!)}>
              Continue unresolved
            </Button>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Button onClick={confirm} disabled={undecided.length > 0 || save === 'saving'}>
          {property ? 'Save scope' : 'Confirm property'}
        </Button>
        {undecided.length > 0 && <span className={styles.status}>{undecided.length} building(s) still need a decision.</span>}
      </div>
      <p className={styles.save} aria-live="polite" data-save-state={save}>
        {SAVE_LABEL[save]}
        {message && ` ${message}`}
      </p>
    </section>
  );
}
