'use client';

// CP-056 / ADD-045 / ADD-051 risk and permit checklist. Rule-engine flags (right-of-way, permits,
// utilities, unknown depth, traffic, silica, accessible route, jurisdiction) close only when the
// evidence is recorded (permit, review, locate, field measurement); only drainage, engineering
// and scope flags can be closed by a reviewer with a note. Status is evidence-based: the UI never
// says work is "authorized" or "safe to cut".
import { PERMIT_STATUSES, RISK_FLAG_KINDS, type PermitStatus, type RiskFlagKind, type SafetyReviewKind } from '@fieldline/contracts';
import { Button, Checkbox, Field, Select, StatusPill, TextInput } from '@fieldline/ui';
import { useState } from 'react';
import { useSession } from '../../lib/session';
import { ErrorNotice } from '../common';
import type { CurbDetail } from './curbApi';
import { Panel } from './CurbCommon';
import { useCurbProject } from './useCurbProject';

/** Flags a reviewer may close with a note; all others need recorded evidence (API: gate_blocked). */
export const NOTE_RESOLVABLE: ReadonlySet<string> = new Set(['drainage_impact', 'external_engineering', 'scope_ambiguous']);

const EVIDENCE_HINT: Partial<Record<RiskFlagKind, string>> = {
  public_right_of_way: 'Clears when the right-of-way permit is recorded as approved.',
  road_work_permit: 'Clears when the permit is recorded as approved or not required by the city.',
  underground_utility_risk: 'Clears when the utility clearance review is signed with the locate ticket.',
  utility_conflict: 'Clears when the utility clearance review is signed.',
  unknown_depth: 'Clears when cut depth or thickness is field verified.',
  unknown_reinforcement: 'Clears when reinforcement is field verified.',
  traffic_control: 'Clears when the traffic control plan review is signed.',
  silica_exposure: 'Clears when the silica exposure control review is signed.',
  accessible_route: 'Clears when the pedestrian access review is signed.',
  unsafe_pedestrian_access: 'Clears when the pedestrian access review is signed.',
  jurisdiction_unresolved: 'Clears when the property jurisdiction is confirmed.',
};

const DEFAULT_REVIEW_CHECKLIST: Record<SafetyReviewKind, string[]> = {
  job_site_safety_plan: ['Site hazards walked and recorded', 'Crew briefed'],
  traffic_control_plan: ['Plan matches the lane/parking impact', 'Devices and flaggers scheduled'],
  silica_exposure_control: ['Wet cutting or vacuum dust control planned', 'Respiratory protection available'],
  pedestrian_access: ['Detour or protected path planned', 'Accessible route maintained'],
  utility_clearance: ['Locate ticket number recorded', 'Markings checked against work area'],
  competent_person: ['Competent person named for the job'],
};

const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function RiskPermitChecklist() {
  const { detail, save, lastError } = useCurbProject();
  if (!detail) return null;
  return (
    <>
      <RiskFlags flags={detail.riskFlags} />
      <Permits permits={detail.permits} />
      <SafetyReviews reviews={detail.safetyReviews} />
      {save === 'error' && lastError !== null && <ErrorNotice error={lastError} title="Change not saved" />}
    </>
  );
}

function RiskFlags({ flags }: { flags: CurbDetail['riskFlags'] }) {
  const { run } = useCurbProject();
  const session = useSession();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [newKind, setNewKind] = useState<RiskFlagKind>('utility_conflict');
  const [newMsg, setNewMsg] = useState('');
  const open = flags.filter((f) => f.status === 'open');
  const closed = flags.filter((f) => f.status !== 'open');
  return (
    <Panel title={`Risk flags (${open.length} open)`} id="risks">
      <ul className="curb-checklist">
        {open.map((f) => (
          <li key={f.id} data-severity={f.severity}>
            <div className="curb-row">
              <StatusPill status={f.severity} tone={f.severity === 'blocking' ? 'danger' : f.severity === 'warning' ? 'warning' : 'info'} label={humanize(f.severity)} />
              <strong>{humanize(f.kind)}</strong>
              <span className="web-muted">({humanize(f.evidenceSource)})</span>
            </div>
            <p>{f.message}</p>
            {NOTE_RESOLVABLE.has(f.kind) || f.evidenceSource !== 'rule_engine' ? (
              <div className="curb-row">
                <Field label="Resolution note" labelHidden>
                  <TextInput placeholder="What was checked and by whom" value={notes[f.id] ?? ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
                </Field>
                <Button size="sm" variant="secondary" disabled={(notes[f.id] ?? '').trim().length < 3 || !session.can('curb_project:write')} onClick={() => void run('CurbRiskFlagResolved', { risk_flag_id: f.id, status: 'resolved', resolution_note: notes[f.id]! })}>
                  Resolve with note
                </Button>
              </div>
            ) : (
              <p className="curb-hint">{EVIDENCE_HINT[f.kind as RiskFlagKind] ?? 'Clears when the evidence is recorded; a note alone cannot close it.'}</p>
            )}
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <details>
          <summary>{closed.length} closed flag(s)</summary>
          <ul className="curb-list">
            {closed.map((f) => (
              <li key={f.id}>
                {humanize(f.kind)}: {humanize(f.status)}
                {f.resolutionNote ? `, ${f.resolutionNote}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="curb-row">
        <Field label="Raise a flag">
          <Select value={newKind} onChange={(e) => setNewKind(e.target.value as RiskFlagKind)} options={RISK_FLAG_KINDS.map((k) => ({ value: k, label: humanize(k) }))} />
        </Field>
        <Field label="What did you see?">
          <TextInput value={newMsg} onChange={(e) => setNewMsg(e.target.value)} />
        </Field>
        <Button size="sm" disabled={newMsg.trim().length < 3} onClick={() => void run('CurbRiskFlagRaised', { kind: newKind, severity: 'blocking', message: newMsg, evidence_source: 'estimator_entry' }).then((ok) => ok && setNewMsg(''))}>
          Raise flag
        </Button>
      </div>
    </Panel>
  );
}

function Permits({ permits }: { permits: CurbDetail['permits'] }) {
  return (
    <Panel title="Permits" id="permits">
      {permits.length === 0 && <p className="web-muted">No permit requirement derived yet. Answer the ownership and permit questions.</p>}
      <ul className="curb-checklist">
        {permits.map((p) => (
          <PermitRow key={p.id} p={p} />
        ))}
      </ul>
      <p className="curb-hint">Permit status records the evidence you have. It is not a legal determination that the work is authorized.</p>
    </Panel>
  );
}

function PermitRow({ p }: { p: CurbDetail['permits'][number] }) {
  const { run } = useCurbProject();
  const [status, setStatus] = useState<PermitStatus>(p.status as PermitStatus);
  const [ref, setRef] = useState(p.applicationReference ?? '');
  const [expires, setExpires] = useState(p.expiresOn ?? '');
  const [checklist, setChecklist] = useState(p.checklist);
  const needsRef = status === 'submitted' || status === 'approved';
  return (
    <li data-status={p.status}>
      <div className="curb-row">
        <strong>{humanize(p.permitType)}</strong>
        <StatusPill status={p.status} machine="permit" />
      </div>
      <div className="curb-row">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as PermitStatus)} options={PERMIT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
        </Field>
        <Field label="Application / permit number" hint={needsRef ? 'Required for submitted or approved.' : undefined}>
          <TextInput value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        <Field label="Expires on">
          <TextInput type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      {checklist.map((c, i) => (
        <Checkbox key={c.item} label={c.item} checked={c.done} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
      ))}
      <Button
        size="sm"
        disabled={needsRef && !ref}
        onClick={() =>
          void run('CurbPermitUpdated', { permit_type: p.permitType, status, ...(ref && { application_reference: ref }), ...(expires && { expires_on: expires }), ...(checklist.length && { checklist }) })
        }
      >
        Save permit
      </Button>
    </li>
  );
}

function SafetyReviews({ reviews }: { reviews: CurbDetail['safetyReviews'] }) {
  return (
    <Panel title="Safety reviews" id="safety">
      {reviews.length === 0 && <p className="web-muted">No safety reviews required yet.</p>}
      <ul className="curb-checklist">
        {reviews.map((r) => (
          <ReviewRow key={r.id} r={r} />
        ))}
      </ul>
      <p className="curb-hint">A signed review records who checked what. Software never certifies a site as safe to cut.</p>
    </Panel>
  );
}

function ReviewRow({ r }: { r: CurbDetail['safetyReviews'][number] }) {
  const { run } = useCurbProject();
  const session = useSession();
  const items = r.checklist.length ? r.checklist : (DEFAULT_REVIEW_CHECKLIST[r.kind as SafetyReviewKind] ?? ['Reviewed']).map((item) => ({ item, done: false }));
  const [checklist, setChecklist] = useState(items);
  const [note, setNote] = useState('');
  const allDone = checklist.every((c) => c.done);
  const decide = (status: 'approved' | 'rejected' | 'not_applicable') => void run('CurbSafetyReviewDecided', { kind: r.kind as SafetyReviewKind, status, checklist, ...(note && { note }) });
  const canSign = session.can('curb_project:write');
  return (
    <li data-status={r.status}>
      <div className="curb-row">
        <strong>{humanize(r.kind)}</strong>
        <StatusPill status={r.status} />
      </div>
      {checklist.map((c, i) => (
        <Checkbox key={c.item} label={c.item} checked={c.done} onChange={(e) => setChecklist(checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
      ))}
      <Field label="Note (locate ticket, plan reference)">
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="curb-row">
        <Button size="sm" disabled={!allDone || !canSign} onClick={() => decide('approved')}>
          Sign as approved
        </Button>
        <Button size="sm" variant="secondary" disabled={!canSign} onClick={() => decide('rejected')}>
          Reject
        </Button>
        <Button size="sm" variant="ghost" disabled={!canSign || note.trim().length < 3} onClick={() => decide('not_applicable')}>
          Not applicable (needs note)
        </Button>
      </div>
    </li>
  );
}
