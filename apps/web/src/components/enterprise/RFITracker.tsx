'use client';

import { useEffect, useRef, useState } from 'react';
import {
  mayTransitionRFI,
  type RFI,
  type RFIStatus,
} from '../../types/enterprise';

interface RFITrackerProps {
  rfis: RFI[];
  canRespond: boolean;
  pendingId: string | null;
  onUpdateStatus: (id: string, status: RFIStatus, response?: string) => Promise<unknown>;
}

const STATUS_LABEL: Record<RFIStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
};

export function RFITracker({
  rfis,
  canRespond,
  pendingId,
  onUpdateStatus,
}: RFITrackerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = rfis.find((rfi) => rfi.id === selectedId);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [selectedId]);

  const close = () => {
    if (pendingId) return;
    setSelectedId(null);
    setResponseText('');
    setSaveError(null);
  };

  const open = (rfi: RFI) => {
    setResponseText(rfi.official_response ?? '');
    setSelectedId(rfi.id);
    setSaveError(null);
  };

  const submit = async () => {
    if (!selected || !responseText.trim() || pendingId) return;
    setSaveError(null);
    try {
      await onUpdateStatus(selected.id, 'answered', responseText.trim());
      setSelectedId(null);
      setResponseText('');
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save the response.');
    }
  };

  return (
    <section className="ec-panel" aria-labelledby="ec-rfi-heading">
      <header className="ec-panel__heading">
        <div>
          <h2 id="ec-rfi-heading">Requests for information</h2>
          <p>Track questions, ownership and documented answers.</p>
        </div>
        <span className="ec-count">{rfis.length} total</span>
      </header>
      {rfis.length === 0 ? (
        <p className="ec-empty">No RFIs have been recorded for this project.</p>
      ) : (
        <div className="ec-table-scroll">
          <table className="ec-table">
            <thead>
              <tr>
                <th scope="col">RFI #</th>
                <th scope="col">Subject</th>
                <th scope="col">Impact</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="ec-sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rfis.map((rfi) => (
                <tr key={rfi.id}>
                  <td className="ec-mono">RFI-{rfi.rfi_number}</td>
                  <td><strong>{rfi.subject}</strong></td>
                  <td>
                    <div className="ec-impacts">
                      {rfi.cost_impact && <span className="ec-impact ec-impact--cost">Cost</span>}
                      {rfi.schedule_impact_days !== 0 && (
                        <span className="ec-impact ec-impact--schedule">
                          {rfi.schedule_impact_days > 0 ? '+' : ''}{rfi.schedule_impact_days}d
                        </span>
                      )}
                      {!rfi.cost_impact && rfi.schedule_impact_days === 0 && <span>None</span>}
                    </div>
                  </td>
                  <td>
                    <span className={`ec-status ec-status--${rfi.status}`}>
                      {STATUS_LABEL[rfi.status]}
                    </span>
                  </td>
                  <td>
                    <button className="ec-button ec-button--secondary" type="button"
                      onClick={() => open(rfi)}>
                      View / answer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <dialog
          ref={dialogRef}
          className="ec-dialog"
          aria-labelledby="ec-dialog-title"
          onClose={close}
          onCancel={(event) => {
            if (pendingId) event.preventDefault();
          }}
        >
          <h2 id="ec-dialog-title">RFI-{selected.rfi_number}: {selected.subject}</h2>
          <p className="ec-dialog__question">{selected.question}</p>
          {selected.suggested_solution && (
            <p><strong>Suggested solution:</strong> {selected.suggested_solution}</p>
          )}
          {selected.official_response && (
            <p><strong>Recorded response:</strong> {selected.official_response}</p>
          )}
          {mayTransitionRFI(selected.status, 'answered') && canRespond && (
            <label className="ec-field">
              <span>Official response</span>
              <textarea
                rows={5}
                maxLength={10000}
                value={responseText}
                onChange={(event) => setResponseText(event.target.value)}
                placeholder="Enter the authorized architect / engineer response…"
              />
            </label>
          )}
          {!canRespond && mayTransitionRFI(selected.status, 'answered') && (
            <p className="ec-info">Your role cannot submit an official response.</p>
          )}
          {saveError && <p className="ec-error" role="alert">{saveError}</p>}
          <div className="ec-actions">
            <button className="ec-button ec-button--secondary" type="button"
              disabled={Boolean(pendingId)} onClick={close}>Close</button>
            {mayTransitionRFI(selected.status, 'answered') && canRespond && (
              <button className="ec-button ec-button--primary" type="button"
                disabled={!responseText.trim() || Boolean(pendingId)} onClick={() => void submit()}>
                {pendingId === selected.id ? 'Saving…' : 'Submit response'}
              </button>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}
