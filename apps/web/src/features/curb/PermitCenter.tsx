'use client';

import { useEffect, useMemo, useState } from 'react';
import { permitLinksFor, US_STATES, VERIFIED_PERMIT_PORTALS } from './permitDirectory';

const STORAGE_KEY = 'fieldpro.curb.permit-center.v1';
type ManualStage = 'not_started' | 'submitted' | 'in_review' | 'approved' | 'corrections' | 'closed';

const STAGES: { value: ManualStage; label: string }[] = [
  { value: 'not_started', label: 'Not submitted' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved / issued' },
  { value: 'corrections', label: 'Corrections requested' },
  { value: 'closed', label: 'Closed' },
];

function isManualStage(value: unknown): value is ManualStage {
  return STAGES.some((s) => s.value === value);
}

export function PermitCenter() {
  const [city, setCity] = useState('');
  const [state, setState] = useState('TX');
  const [permitNumber, setPermitNumber] = useState('');
  const [stage, setStage] = useState<ManualStage>('not_started');
  const [hydrated, setHydrated] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    // Keep permit draft local to the device; never send numbers to a search provider.
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data: unknown = JSON.parse(saved);
        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          if (typeof d.city === 'string') setCity(d.city.slice(0, 120));
          if (typeof d.state === 'string' && US_STATES.some(([code]) => code === d.state))
            setState(d.state);
          if (typeof d.permitNumber === 'string') setPermitNumber(d.permitNumber.slice(0, 100));
          if (isManualStage(d.stage)) setStage(d.stage);
        }
      }
    } catch {
      // Private browsing and full storage must not break the permit section.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ city, state, permitNumber, stage }),
      );
    } catch {
      // The functionality still works without device persistence.
    }
  }, [city, state, permitNumber, stage, hydrated]);

  const result = useMemo(() => permitLinksFor(city, state), [city, state]);

  const setLocation = (nextCity: string, nextState: string) => {
    if (nextCity !== city || nextState !== state) {
      setPermitNumber('');
      setStage('not_started');
      setCopyNotice('');
    }
    setCity(nextCity);
    setState(nextState);
  };

  const copyNumber = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(permitNumber);
      setCopyNotice('Permit reference copied.');
    } catch {
      setCopyNotice('Select and copy the reference from its field.');
    }
  };

  return (
    <section className="cc-permits" id="permit-center" aria-labelledby="permit-center-heading">
      <div className="cc-permits__header">
        <div>
          <div className="cc-eyebrow">Permitting // Municipality + right of way</div>
          <h2 id="permit-center-heading">Permit Center</h2>
          <p>
            Find the city&apos;s application and permit-status pages for your curb-cutting job.
            Keep your permit reference here while you work.
          </p>
        </div>
        <span className="cc-permits__header-badge">CITY PORTAL DIRECTORY</span>
      </div>

      <div className="cc-permits__grid">
        <div className="cc-permits__form">
          <div className="cc-permits__step"><span>01</span> Locate the permit office</div>
          <div className="cc-permits__fields">
            <label className="cc-permits__field">
              <span>Job city</span>
              <input
                type="text"
                autoComplete="address-level2"
                list="fieldpro-permit-city-suggestions"
                placeholder="Enter a city"
                value={city}
                maxLength={120}
                onChange={(e) => setLocation(e.target.value, state)}
              />
              <datalist id="fieldpro-permit-city-suggestions">
                {VERIFIED_PERMIT_PORTALS.map((p) => (
                  <option key={p.city + p.state} value={p.city} />
                ))}
              </datalist>
            </label>
            <label className="cc-permits__field cc-permits__field--state">
              <span>State</span>
              <select
                value={state}
                onChange={(e) => setLocation(city, e.target.value)}
                autoComplete="address-level1"
              >
                {US_STATES.map(([code, label]) => (
                  <option key={code} value={code}>{label} ({code})</option>
                ))}
              </select>
            </label>
          </div>

          <div className="cc-permits__quick" aria-label="Quick select a verified city">
            <span>Quick select</span>
            {['Carrollton', 'Dallas', 'Fort Worth', 'Austin', 'Houston'].map((choice) => (
              <button
                type="button"
                key={choice}
                className={city.toLowerCase() === choice.toLowerCase() && state === 'TX' ? 'cc-permits__chip cc-permits__chip--active' : 'cc-permits__chip'}
                onClick={() => setLocation(choice, 'TX')}
                aria-pressed={city.toLowerCase() === choice.toLowerCase() && state === 'TX'}
              >
                {choice}
              </button>
            ))}
          </div>

          <div className="cc-permits__divider" />

          <div className="cc-permits__step"><span>02</span> Save your permit reference</div>
          <div className="cc-permits__fields">
            <label className="cc-permits__field">
              <span>Permit / application number <small>(optional)</small></span>
              <input
                type="text"
                value={permitNumber}
                onChange={(e) => { setPermitNumber(e.target.value); setCopyNotice(''); }}
                placeholder="e.g. city-issued reference"
                maxLength={100}
                autoComplete="off"
              />
            </label>
            <div className="cc-permits__copy-wrap">
              <button
                type="button"
                className="cc-permits__secondary-button"
                disabled={!permitNumber.trim()}
                onClick={() => void copyNumber()}
              >
                Copy number
              </button>
            </div>
          </div>
          {copyNotice && <p role="status" className="cc-permits__small">{copyNotice}</p>}
          <label className="cc-permits__field cc-permits__stage">
            <span>Your status note <small>(entered by you, not from city records)</small></span>
            <select value={stage} onChange={(e) => setStage(e.target.value as ManualStage)}>
              {STAGES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="cc-permits__small">
            Stored on this device only. Changing the city clears this reference and status note.
          </p>
        </div>

        <div className="cc-permits__portal" aria-live="polite">
          <div className="cc-permits__step"><span>03</span> Apply or check status</div>
          {!result ? (
            <div className="cc-permits__empty">
              <div className="cc-permits__empty-icon" aria-hidden="true">⌕</div>
              <h3>Select your job city</h3>
              <p>The city&apos;s permit resources will appear here when you enter a location.</p>
            </div>
          ) : (
            <>
              <div className="cc-permits__portal-top">
                <div>
                  <span className={result.verified ? 'cc-permits__tag cc-permits__tag--verified' : 'cc-permits__tag cc-permits__tag--search'}>
                    {result.verified ? 'Verified city resource' : 'Search required'}
                  </span>
                  <h3>{result.name}</h3>
                  <p>{result.city}, {result.state}</p>
                </div>
                <span className="cc-permits__portal-icon" aria-hidden="true">↗</span>
              </div>
              <div className="cc-permits__actions">
                <a href={result.applyUrl} target="_blank" rel="noopener noreferrer" className="cc-permits__primary-button">
                  {result.verified ? 'Apply for a permit ↗' : 'Find application portal ↗'}
                </a>
                <a href={result.statusUrl} target="_blank" rel="noopener noreferrer" className="cc-permits__secondary-button">
                  {result.verified ? 'Check permit status ↗' : 'Find status lookup ↗'}
                </a>
              </div>
              <div className="cc-permits__guidance">
                <strong>{result.verified ? 'City portal guidance' : 'Portal not yet verified'}</strong>
                <p>{result.guidance}</p>
              </div>
              {result.sourceUrl && (
                <a className="cc-permits__source" href={result.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View published city permit information ↗
                </a>
              )}
              <p className="cc-permits__small">
                {result.verified
                  ? 'These are external city resources, not live permit-status data inside Field Pro.'
                  : 'These buttons open search results, not a confirmed city application or status page.'}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="cc-permits__safety" role="note">
        <strong>Before cutting:</strong> Verify the exact permitting authority for the property (city,
        county, or other agency), right-of-way/driveway approval, inspection requirements, and 811
        utility locates. A submitted application is not permission to begin work.
      </div>
    </section>
  );
}
