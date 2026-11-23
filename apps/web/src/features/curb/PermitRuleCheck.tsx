'use client';

// City permit rule checks (Phase D, item 18). Rendered only when the platform-controlled
// `curb.permit_rules` flag is on (off by default); while off this renders nothing and no
// rules are shown. Results cite city-published sources; unknown cities load no rules.
import { useMemo, useState } from 'react';
import { useSession } from '../../lib/session';
import { checkPermitRules, WORK_TYPE_LABELS, type PermitWorkType } from './permitRules';

const WORK_OPTIONS = (Object.keys(WORK_TYPE_LABELS) as PermitWorkType[]).map((value) => ({
  value, label: WORK_TYPE_LABELS[value],
}));

export function PermitRuleCheck({ city, state }: { city: string; state: string }) {
  const session = useSession();
  const [workType, setWorkType] = useState<PermitWorkType>('curb_cut');
  const result = useMemo(
    () => checkPermitRules(city, state, workType),
    [city, state, workType],
  );

  if (!session.flag('curb.permit_rules')) return null;

  return (
    <div className="cc-permits__guidance">
      <strong>Permit rule checks (confirm with the city)</strong>
      <label className="cc-field">
        <span>Work type</span>
        <select
          className="cc-input"
          value={workType}
          onChange={(e) => setWorkType(e.currentTarget.value as PermitWorkType)}
        >
          {WORK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <p>{result.message}</p>
      {result.status === 'checks_found' && (
        <ul>
          {result.checks.map((c) => (
            <li key={c.id}>
              <strong>{c.title}.</strong> {c.detail}{' '}
              <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                City source ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
