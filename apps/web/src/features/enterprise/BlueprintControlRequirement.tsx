'use client';

import { CONTROL_EVIDENCE_MAX_BYTES, controlComplianceLabel } from '@fieldline/contracts';
import { useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import type { ControlEvidenceType, ControlRequirementType } from './controlSchemas';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(index, index + chunk)));
  }
  return btoa(binary);
}

function reviewLabel(status: ControlEvidenceType['reviewStatus']): string {
  if (status === 'accepted') return 'Accepted';
  if (status === 'rejected') return 'Rejected';
  return 'Pending review';
}

function ExternalReference({ value }: { value: string }) {
  if (/^https?:\/\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer" className="blueprint-link">
        {value}
      </a>
    );
  }
  return <code className="blueprint-table-chip">{value}</code>;
}

export function BlueprintControlRequirement({
  requirement,
  members,
  page,
  onChanged,
}: {
  requirement: ControlRequirementType;
  members: { userId: string; displayName: string }[];
  page: number | null;
  onChanged: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const canWrite = session.can('job:write');
  const canReview = session.can('review_task:decide');
  const [ownerUserId, setOwnerUserId] = useState(requirement.ownerUserId ?? '');
  const [expiresOn, setExpiresOn] = useState(requirement.expiresOn ?? '');
  const [notes, setNotes] = useState(requirement.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [evidenceTitle, setEvidenceTitle] = useState('');
  const [evidenceOn, setEvidenceOn] = useState(todayIso());
  const [evidenceExpiresOn, setEvidenceExpiresOn] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadMessage, setUploadMessage] = useState('');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState('');
  const [reviewError, setReviewError] = useState('');
  const ownerChoices =
    requirement.ownerUserId && !members.some((member) => member.userId === requirement.ownerUserId)
      ? [
          ...members,
          {
            userId: requirement.ownerUserId,
            displayName: `${requirement.ownerName ?? 'Former member'} (inactive)`,
          },
        ]
      : members;

  // A saved assignment returns a new revision: re-seed the editable fields without remounting the
  // open details element (React's adjust-state-during-render pattern).
  const [syncedRevision, setSyncedRevision] = useState(requirement.revision);
  if (syncedRevision !== requirement.revision) {
    setSyncedRevision(requirement.revision);
    setOwnerUserId(requirement.ownerUserId ?? '');
    setExpiresOn(requirement.expiresOn ?? '');
    setNotes(requirement.notes ?? '');
  }

  const basePath = `/v1/enterprise/blueprint/controls/${encodeURIComponent(
    requirement.moduleKey,
  )}/${encodeURIComponent(requirement.gateKey)}`;

  const saveAssignment = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      await api.put(
        basePath,
        {
          ownerUserId: ownerUserId || null,
          expiresOn: expiresOn || null,
          notes: notes.trim() || null,
        },
        requirement.revision > 0 ? { ifMatch: requirement.revision } : {},
      );
      await onChanged();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setSaving(false);
    }
  };

  const addEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setUploadError('');
    setUploadMessage('');
    try {
      if (attachment && attachment.size > CONTROL_EVIDENCE_MAX_BYTES)
        throw new Error('Evidence attachments must be 8 MiB or smaller.');
      const contentBase64 = attachment ? await fileToBase64(attachment) : undefined;
      await api.post(basePath + '/evidence', {
        title: evidenceTitle.trim(),
        evidenceOn,
        expiresOn: evidenceExpiresOn || null,
        sourceReference: sourceReference.trim() || null,
        note: evidenceNote.trim() || undefined,
        ...(attachment && contentBase64 ? { filename: attachment.name, contentBase64 } : {}),
      });
      setEvidenceTitle('');
      setEvidenceExpiresOn('');
      setSourceReference('');
      setEvidenceNote('');
      setAttachment(null);
      form.reset();
      setUploadMessage('Evidence added. It is not proof until an independent reviewer accepts it.');
      await onChanged();
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setUploading(false);
    }
  };

  const review = async (item: ControlEvidenceType, decision: 'accepted' | 'rejected') => {
    setReviewBusy(item.id);
    setReviewError('');
    try {
      await api.post(`/v1/enterprise/blueprint/control-evidence/${item.id}/review`, {
        decision,
        note: (reviewNotes[item.id] ?? '').trim(),
      });
      setReviewNotes((current) => ({ ...current, [item.id]: '' }));
      await onChanged();
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setReviewBusy('');
    }
  };

  return (
    <details className="enterprise-panel blueprint-requirement">
      <summary>
        <span className="blueprint-requirement-order">
          {String(requirement.order).padStart(2, '0')}
        </span>
        <span className="blueprint-requirement-heading">
          <strong>{requirement.title}</strong>
          <small>
            {page ? `p. ${page} · ` : ''}
            {requirement.ownerName ? `Owner ${requirement.ownerName}` : 'No owner'} · Expires{' '}
            {requirement.expiresOn ?? 'not set'} · {requirement.evidence.length} evidence
          </small>
        </span>
        <span
          className={`blueprint-requirement-status blueprint-requirement-status--${requirement.status}`}
        >
          {controlComplianceLabel(requirement.status)}
        </span>
      </summary>

      <div className="blueprint-requirement-body">
        <p>{requirement.requirement}</p>
        <p className="enterprise-muted">
          <strong>Evidence required:</strong> {requirement.evidenceStandard} Accepted evidence stays
          valid for {requirement.validityDays} days.
        </p>
        <p className="enterprise-muted blueprint-requirement-reason">
          {requirement.reasons.join(' ')}
        </p>

        <form className="blueprint-requirement-form" onSubmit={saveAssignment}>
          <h4>Requirement owner and refresh</h4>
          {saveError && (
            <p className="enterprise-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="blueprint-form-fields">
            <label>
              Owner
              <select
                value={ownerUserId}
                onChange={(event) => setOwnerUserId(event.target.value)}
                disabled={!canWrite}
              >
                <option value="">Unassigned</option>
                {ownerChoices.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Requirement expires
              <input
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
                disabled={!canWrite}
              />
            </label>
          </div>
          <label>
            Requirement note
            <textarea
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
              disabled={!canWrite}
              placeholder="Scope, reviewer expectation or renewal instructions"
            />
          </label>
          <button type="submit" disabled={saving || !canWrite}>
            {saving ? 'Saving…' : 'Save requirement'}
          </button>
        </form>

        <div className="blueprint-evidence">
          <h4>Evidence ({requirement.evidence.length})</h4>
          {reviewError && (
            <p className="enterprise-error" role="alert">
              {reviewError}
            </p>
          )}
          {requirement.evidence.length === 0 && (
            <p className="enterprise-empty">
              No evidence attached. A gate cannot be satisfied until reviewed evidence is accepted.
            </p>
          )}
          <ul className="blueprint-evidence-list">
            {requirement.evidence.map((item) => {
              const ownEvidence = item.createdByUserId === session.me.user.id;
              return (
                <li key={item.id} className="blueprint-evidence-item">
                  <div className="blueprint-evidence-head">
                    <strong>{item.title}</strong>
                    <span
                      className={`blueprint-evidence-status blueprint-evidence-status--${item.reviewStatus}`}
                    >
                      {reviewLabel(item.reviewStatus)}
                    </span>
                  </div>
                  <p className="enterprise-muted">
                    Evidence date {item.evidenceOn} · Expires {item.expiresOn ?? 'not set'}
                    {item.byteSize ? ` · ${Math.ceil(item.byteSize / 1024)} KiB` : ''}
                  </p>
                  {item.note && <p>{item.note}</p>}
                  {item.sourceReference && (
                    <p className="blueprint-evidence-source">
                      <ExternalReference value={item.sourceReference} />
                    </p>
                  )}
                  <div className="blueprint-evidence-links">
                    {item.hasAttachment && (
                      <a
                        className="blueprint-link"
                        href={`/v1/enterprise/blueprint/control-evidence/${item.id}/download`}
                      >
                        Download {item.filename ?? 'attachment'}
                      </a>
                    )}
                    {item.sha256Hex && (
                      <code className="blueprint-table-chip" title={item.sha256Hex}>
                        SHA-256 {item.sha256Hex.slice(0, 12)}…
                      </code>
                    )}
                  </div>
                  {item.reviewStatus !== 'pending' && (
                    <p className="enterprise-muted">
                      Reviewed{item.reviewNote ? `: ${item.reviewNote}` : '.'}
                    </p>
                  )}
                  {item.reviewStatus === 'pending' && canReview && (
                    <div className="blueprint-evidence-review">
                      <input
                        value={reviewNotes[item.id] ?? ''}
                        onChange={(event) =>
                          setReviewNotes((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        placeholder="Review note (required)"
                        maxLength={2000}
                        aria-label={`Review note for ${item.title}`}
                      />
                      <button
                        type="button"
                        disabled={reviewBusy === item.id || ownEvidence}
                        title={
                          ownEvidence
                            ? 'An independent reviewer must accept your own evidence.'
                            : undefined
                        }
                        onClick={() => void review(item, 'accepted')}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="enterprise-quiet"
                        disabled={reviewBusy === item.id}
                        onClick={() => void review(item, 'rejected')}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {item.reviewStatus === 'pending' && !canReview && (
                    <p className="enterprise-muted">
                      A reviewer with decision permission must accept or reject this evidence.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {canWrite && (
            <form className="blueprint-evidence-form" onSubmit={addEvidence}>
              <h4>Add evidence</h4>
              {uploadError && (
                <p className="enterprise-error" role="alert">
                  {uploadError}
                </p>
              )}
              {uploadMessage && (
                <p className="enterprise-success" role="status">
                  {uploadMessage}
                </p>
              )}
              <div className="blueprint-form-fields">
                <label>
                  Evidence title
                  <input
                    value={evidenceTitle}
                    onChange={(event) => setEvidenceTitle(event.target.value)}
                    minLength={2}
                    maxLength={180}
                    required
                    placeholder="Approved permission matrix v3"
                  />
                </label>
                <label>
                  Evidence date
                  <input
                    type="date"
                    value={evidenceOn}
                    onChange={(event) => setEvidenceOn(event.target.value)}
                    required
                  />
                </label>
                <label>
                  Evidence expires
                  <input
                    type="date"
                    value={evidenceExpiresOn}
                    onChange={(event) => setEvidenceExpiresOn(event.target.value)}
                    placeholder={`${requirement.validityDays} days`}
                  />
                  <small className="enterprise-muted">
                    Leave blank for the gate&apos;s {requirement.validityDays}-day validity.
                  </small>
                </label>
              </div>
              <label>
                Source reference
                <input
                  value={sourceReference}
                  onChange={(event) => setSourceReference(event.target.value)}
                  maxLength={1000}
                  placeholder="Test run URL, ticket or document identifier"
                />
              </label>
              <label>
                Note
                <textarea
                  value={evidenceNote}
                  onChange={(event) => setEvidenceNote(event.target.value)}
                  maxLength={4000}
                  placeholder="What this evidence demonstrates"
                />
              </label>
              <label>
                PDF attachment (optional, up to 8 MiB)
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
                />
              </label>
              <button type="submit" disabled={uploading || evidenceTitle.trim().length < 2}>
                {uploading ? 'Adding…' : 'Add evidence for review'}
              </button>
            </form>
          )}
        </div>
      </div>
    </details>
  );
}
