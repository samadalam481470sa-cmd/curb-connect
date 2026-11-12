'use client';

import { useEffect, useState } from 'react';
import type { RFI, RFIStatus } from './types';
import { RFI_TRANSITIONS } from './types';

interface Props {
  rfis: readonly RFI[];
  busy: boolean;
  canEdit: boolean;
  canReview: boolean;
  onUpdateStatus: (rfi: RFI, status: RFIStatus, response?: string) => Promise<void>;
}

const labels: Record<RFIStatus, string> = {
  draft: 'Draft', open: 'Open', answered: 'Answered', closed: 'Closed',
};

export function RFITracker({ rfis, busy, canEdit, canReview, onUpdateStatus }: Props) {
  const [selected, setSelected] = useState<RFI | null>(null);
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const latest = rfis.find((r) => r.id === selected.id);
    if (latest && latest.revision !== selected.revision) setSelected(latest);
  }, [rfis, selected]);

  async function submit(next: RFIStatus) {
    if (!selected || saving || !canEdit) return;
    setError('');
    if (next !== 'open' && !canReview) {
      setError('You need reviewer permission to answer or close this RFI.');
      return;
    }
    if (next === 'answered' || (selected.status === 'open' && next === 'closed')) {
      if (!response.trim()) {
        setError('Enter an official response before submitting.');
        return;
      }
    }
    setSaving(true);
    try {
      await onUpdateStatus(selected, next, response.trim() || undefined);
      setSelected(null); setResponse('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The RFI update could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="enterprise-panel enterprise-control-card">
      <header className="enterprise-control-head">
        <div><h2>Requests for Information</h2><p>Track design questions, assignments, and official responses.</p></div>
        <span className="enterprise-count">{rfis.length} total</span>
      </header>
      <div className="enterprise-scroll">
        <table className="enterprise-control-table">
          <thead><tr><th scope="col">RFI #</th><th scope="col">Subject</th>
            <th scope="col">Cost / schedule</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {rfis.map((rfi) => (
              <tr key={rfi.id}>
                <td className="enterprise-mono">RFI-{rfi.rfiNumber}</td>
                <td><strong>{rfi.subject}</strong><small>Ball in court: {rfi.ballInCourt}</small></td>
                <td>{rfi.costImpact ? 'Cost impact' : 'No cost flag'}
                  {rfi.scheduleImpactDays !== 0 && <small>Schedule: {rfi.scheduleImpactDays} days</small>}</td>
                <td><span className={'enterprise-status enterprise-status--' + rfi.status}>{labels[rfi.status]}</span></td>
                <td><button type="button" disabled={busy} onClick={() => {
                  setSelected(rfi); setResponse(rfi.officialResponse ?? ''); setError('');
                }}>View / {rfi.status === 'open' ? 'Answer' : 'Details'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rfis.length && <p className="enterprise-empty">No RFIs yet. Create one using the form above.</p>}
      {selected && (
        <div className="enterprise-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setSelected(null);
        }}>
          <div className="enterprise-modal" role="dialog" aria-modal="true"
            aria-label={'RFI ' + selected.rfiNumber + ' details'}>
            <div className="enterprise-control-head">
              <div><span className="enterprise-kicker">RFI-{selected.rfiNumber}</span><h2>{selected.subject}</h2></div>
              <button type="button" className="enterprise-quiet" disabled={saving} onClick={() => setSelected(null)}
                aria-label="Close RFI details">Close</button>
            </div>
            <p>{selected.question}</p>
            <p className="enterprise-muted">Assigned reviewer: {selected.ballInCourt} · Status: {labels[selected.status]}</p>
            {selected.officialResponse && <p><strong>Official response:</strong> {selected.officialResponse}</p>}
            {RFI_TRANSITIONS[selected.status].length > 0 && (
              <label className="enterprise-response">Official architect / engineer response
                <textarea rows={4} value={response} onChange={(event) => setResponse(event.target.value)}
                  placeholder="Describe the official resolution" disabled={!canReview || saving} />
              </label>
            )}
            {error && <p role="alert" className="enterprise-error">{error}</p>}
            <div className="enterprise-actions enterprise-modal-actions">
              <button type="button" className="enterprise-quiet" disabled={saving}
                onClick={() => setSelected(null)}>Cancel</button>
              {RFI_TRANSITIONS[selected.status].map((next) => (
                <button type="button" key={next} disabled={saving || busy || !canEdit || (next !== 'open' && !canReview)}
                  onClick={() => void submit(next)}>{saving ? 'Saving…' : next === 'answered' ? 'Submit official answer' : labels[next]}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
