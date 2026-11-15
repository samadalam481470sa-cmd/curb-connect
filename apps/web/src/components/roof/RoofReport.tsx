'use client';

// Roof report (RF-025, RF-026, RF-028..RF-030, RR-033..RR-038, RR-040, COS-208..COS-225,
// ADD-032..ADD-039): totals of the current version, the review checklist and decision, append-only
// overrides with reasons, the material takeoff showing exact vs order quantities with formulas,
// version history + compare, PDF/CSV/JSON exports with checksums, and the good/better/best quote
// preview and conversion (explicit pricing-date + waste confirmation).
import type { ExportFormat, ReviewDecision, RoofEdgeType, RoofGeometryState } from '@fieldline/contracts';
import { Button, Checkbox, Field, Select, Skeleton, StatusPill, Tabs, TextInput, useToast } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { newIdempotencyKey } from '../../lib/api';
import { useApi } from '../../lib/session';
import { ButtonLink, ErrorNotice, PageHeader } from '../common';
import { EDGE_LABELS, FT2_PER_M2, FT_PER_M, MATERIAL_PRESETS, QUOTE_QUANTITY_KEYS, fmtFt, fmtFt2, fmtSquares, money, quoteRequest, takeoffRequest, describePitch, type MaterialRow, type TierInput } from './model';
import { roofEndpoints, type ExportRecord, type RoofApi, type RoofEndpoints, type ReviewTask, type TakeoffDto } from './roofApi';
import styles from './roof.module.css';

type Tab = 'summary' | 'review' | 'takeoff' | 'versions' | 'exports' | 'quote';

export function RoofReportPage({ reportId, apiOverride }: { reportId: string; apiOverride?: RoofApi }) {
  const { api } = useApi();
  const roof = useMemo(() => roofEndpoints(apiOverride ?? api), [apiOverride, api]);
  const report = useQuery({ queryKey: ['roof', 'report', reportId, 'view'], queryFn: () => roof.report(reportId) });
  const [tab, setTab] = useState<Tab>('summary');
  if (report.isPending) return <Skeleton lines={8} />;
  if (report.isError) return <ErrorNotice error={report.error} onRetry={() => void report.refetch()} />;
  const s = report.data;
  const frozen = s.versionStatus !== 'draft';
  return (
    <>
      <PageHeader title={`Roof report v${s.versionNumber}`} description="Measured totals, review, material takeoff, exports and quote." />
      <div className={styles.row}>
        <StatusPill status={s.versionStatus} label={s.versionStatus.replace(/_/g, ' ')} />
        <ButtonLink href={`/roof/reports/${reportId}/edit`} variant="secondary">
          {s.versionStatus === 'draft' ? 'Edit sketch' : 'View sketch'}
        </ButtonLink>
      </div>
      <Tabs<Tab>
        label="Report sections"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'summary', label: 'Summary', panel: <Summary s={s} /> },
          { value: 'review', label: 'Review', panel: <ReviewPanel s={s} roof={roof} onChanged={() => void report.refetch()} /> },
          { value: 'takeoff', label: 'Takeoff', panel: <TakeoffPanel s={s} roof={roof} />, disabled: !frozen },
          { value: 'versions', label: 'Versions', panel: <VersionsPanel s={s} roof={roof} onChanged={() => void report.refetch()} /> },
          { value: 'exports', label: 'Exports', panel: <ExportsPanel s={s} roof={roof} />, disabled: !frozen },
          { value: 'quote', label: 'Quote', panel: <QuotePanel s={s} roof={roof} />, disabled: s.versionStatus !== 'approved' && s.versionStatus !== 'issued' },
        ]}
      />
    </>
  );
}

export function Summary({ s }: { s: RoofGeometryState }) {
  return (
    <div className={styles.stack}>
      <dl className={styles.kv} data-testid="report-summary">
        <dt>Facets</dt>
        <dd>{s.property.facetCount}</dd>
        <dt>Plan area</dt>
        <dd>{fmtFt2(s.property.netPlanAreaM2)}</dd>
        <dt>Sloped area</dt>
        <dd>{fmtFt2(s.property.slopedAreaM2)}</dd>
        <dt>Squares</dt>
        <dd>{fmtSquares(s.property.squares)}</dd>
      </dl>
      <table className={styles.table}>
        <caption>Edge totals</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col" className={styles.num}>
              Count
            </th>
            <th scope="col" className={styles.num}>
              True length
            </th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(s.edgeTotals).map(([t, v]) => (
            <tr key={t}>
              <th scope="row">{EDGE_LABELS[t as RoofEdgeType] ?? t}</th>
              <td className={styles.num}>{v.count}</td>
              <td className={styles.num}>{fmtFt(v.trueLengthM)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className={styles.table}>
        <caption>Facets</caption>
        <thead>
          <tr>
            <th scope="col">Facet</th>
            <th scope="col">Pitch</th>
            <th scope="col">Pitch source</th>
            <th scope="col" className={styles.num}>
              Sloped area
            </th>
          </tr>
        </thead>
        <tbody>
          {s.facets.map((f) => (
            <tr key={f.id}>
              <th scope="row">{f.id}</th>
              <td>{f.pitch ? describePitch(f.pitch).rise12 : 'Unknown'}</td>
              <td>{f.pitch ? `${f.pitch.method.replace(/_/g, ' ')}${f.pitch.confidence == null ? '' : `, ${Math.round(f.pitch.confidence * 100)}%`}` : '—'}</td>
              <td className={styles.num}>{fmtFt2(f.slopedAreaM2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.issues.length > 0 && (
        <ul aria-label="Checks">
          {s.issues.map((i, n) => (
            <li key={n} className={i.severity === 'error' ? styles.issue : undefined}>
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CHECK_LABEL: Record<string, string> = {
  facets_match_imagery: 'Facets match the imagery or plans',
  pitches_supported: 'Each pitch has a supported method',
  edges_classified: 'Edges are classified with no conflicts',
  scope_confirmed: 'Structures in scope are all measured or marked unmeasured',
};
const DECISIONS: { d: ReviewDecision; label: string; variant: 'primary' | 'secondary' | 'danger' }[] = [
  { d: 'approved', label: 'Approve', variant: 'primary' },
  { d: 'changes_requested', label: 'Request changes', variant: 'secondary' },
  { d: 'clarification_requested', label: 'Ask for clarification', variant: 'secondary' },
  { d: 'recapture_requested', label: 'Request new imagery', variant: 'secondary' },
  { d: 'escalated', label: 'Escalate', variant: 'secondary' },
  { d: 'rejected', label: 'Reject', variant: 'danger' },
];

export function ReviewPanel({ s, roof, onChanged }: { s: RoofGeometryState; roof: RoofEndpoints; onChanged: () => void }) {
  const tasks = useQuery({ queryKey: ['roof', 'review', s.versionId], queryFn: () => roof.reviewTasks({ subjectId: s.versionId, includeDone: 'true' }) });
  const task = tasks.data?.items.find((t) => t.status !== 'cancelled') ?? null;
  return (
    <div className={styles.stack}>
      {tasks.isPending && <Skeleton lines={3} />}
      {tasks.isError && <ErrorNotice error={tasks.error} onRetry={() => void tasks.refetch()} />}
      {tasks.data && !task && <p>{s.versionStatus === 'draft' ? 'This version has not been submitted for review yet.' : 'No review task for this version.'}</p>}
      {task && (
        <ReviewTaskView
          key={`${task.id}-${task.revision}`}
          task={task}
          roof={roof}
          onChanged={() => {
            void tasks.refetch();
            onChanged();
          }}
        />
      )}
      <OverrideForm s={s} roof={roof} />
    </div>
  );
}

export function ReviewTaskView({ task, roof, onChanged }: { task: ReviewTask; roof: RoofEndpoints; onChanged: () => void }) {
  const [checklist, setChecklist] = useState<Record<string, boolean>>(task.checklist ?? {});
  const [comments, setComments] = useState('');
  const [current, setCurrent] = useState(task);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = current.status === 'completed';
  const allChecked = Object.values(checklist).every(Boolean);
  const run = async (fn: () => Promise<ReviewTask>) => {
    setBusy(true);
    setError(null);
    try {
      setCurrent(await fn());
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="rv-h">
      <h2 id="rv-h">Review</h2>
      <dl className={styles.kv}>
        <dt>Status</dt>
        <dd>{current.status.replace(/_/g, ' ')}</dd>
        <dt>Priority</dt>
        <dd>{current.priority}</dd>
        <dt>Due</dt>
        <dd>{current.dueAt ? `${new Date(current.dueAt).toLocaleString()}${current.overdue ? ' (overdue)' : ''}` : 'No target'}</dd>
        <dt>Second review</dt>
        <dd>{current.requiresSecondReview ? 'Required (a different person must also review)' : 'Not required'}</dd>
        {current.decision && (
          <>
            <dt>Decision</dt>
            <dd>{current.decision.replace(/_/g, ' ')}</dd>
          </>
        )}
      </dl>
      {error !== null && <ErrorNotice error={error} title="The review was not updated" />}
      {!done && !current.claimedByMembershipId && (
        <Button loading={busy} onClick={() => void run(() => roof.claimReview(current.id))}>
          Claim for 30 minutes
        </Button>
      )}
      {!done && current.claimedByMembershipId && (
        <div className={styles.stack}>
          <p className={styles.muted}>Claimed until {current.leaseExpiresAt ? new Date(current.leaseExpiresAt).toLocaleTimeString() : 'unknown'}. Decisions use the task revision you see ({current.revision}); if it changed, reload.</p>
          <fieldset className={styles.stack}>
            <legend>Checklist</legend>
            {Object.keys(checklist).map((k) => (
              <Checkbox key={k} label={CHECK_LABEL[k] ?? k.replace(/_/g, ' ')} checked={checklist[k] ?? false} onChange={(e) => setChecklist((c) => ({ ...c, [k]: e.target.checked }))} />
            ))}
          </fieldset>
          <Field label="Comments" hint="Required when requesting changes, clarification, new imagery or rejecting.">
            <TextInput value={comments} maxLength={4000} onChange={(e) => setComments(e.target.value)} />
          </Field>
          <div className={styles.row}>
            {DECISIONS.map(({ d, label, variant }) => (
              <Button
                key={d}
                size="sm"
                variant={variant}
                disabled={busy || (d === 'approved' ? !allChecked : d !== 'escalated' && comments.trim().length < 3)}
                onClick={() => void run(() => roof.decideReview(current.id, { decision: d, expectedRevision: current.revision, checklist, ...(comments.trim() && { comments: comments.trim() }) }))}
              >
                {label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => roof.releaseReview(current.id))}>
              Release
            </Button>
          </div>
          {!allChecked && <p className={styles.muted}>Approve is available once every checklist item is ticked.</p>}
        </div>
      )}
    </section>
  );
}

/** RF-030: append-only override; the reason is required and the prior value is kept. */
export function OverrideForm({ s, roof }: { s: RoofGeometryState; roof: RoofEndpoints }) {
  const [field, setField] = useState<'facet.planAreaM2' | 'edges.lengthM'>('edges.lengthM');
  const [target, setTarget] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  if (s.versionStatus === 'draft') return null;
  const targets = field === 'facet.planAreaM2' ? s.facets.map((f) => ({ value: f.id, label: `Facet ${f.id}` })) : Object.keys(s.edgeTotals).map((t) => ({ value: t, label: EDGE_LABELS[t as RoofEdgeType] ?? t }));
  const save = async () => {
    setError(null);
    try {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0) throw new Error('Enter a non-negative number.');
      if (!target) throw new Error('Choose what to override.');
      const si = field === 'facet.planAreaM2' ? v / FT2_PER_M2 : v / FT_PER_M;
      const r = await roof.override(s.versionId, {
        field,
        target,
        reason: reason.trim(),
        newValue: { state: 'known', value: si, unit: field === 'facet.planAreaM2' ? 'm2' : 'm', source: 'user_entered', measuredAt: new Date().toISOString(), precision: 0 },
      });
      setDone(r.approvedByUserId ? 'Override recorded and approved.' : 'Override recorded; it is pending review approval.');
      setValue('');
      setReason('');
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="ov-h">
      <h2 id="ov-h">Override a measurement</h2>
      <p className={styles.muted}>Overrides never replace history: the previous value, your reason and the approver are recorded.</p>
      <div className={styles.row}>
        <Field label="Value">
          <Select
            value={field}
            onChange={(e) => {
              setField(e.target.value as typeof field);
              setTarget('');
            }}
            options={[
              { value: 'edges.lengthM', label: 'Edge type total length (ft)' },
              { value: 'facet.planAreaM2', label: 'Facet plan area (ft²)' },
            ]}
          />
        </Field>
        <Field label="Applies to">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose…" options={targets} />
        </Field>
        <Field label={field === 'facet.planAreaM2' ? 'New area (ft²)' : 'New length (ft)'}>
          <TextInput inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason (required)">
        <TextInput value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {error !== null && <ErrorNotice error={error} title="The override was not recorded" />}
      {done && <p role="status">{done}</p>}
      <Button size="sm" disabled={reason.trim().length < 3} onClick={() => void save()}>
        Record override
      </Button>
    </section>
  );
}

export function TakeoffPanel({ s, roof }: { s: RoofGeometryState; roof: RoofEndpoints }) {
  const [rows, setRows] = useState<MaterialRow[]>(MATERIAL_PRESETS);
  const [wasteRate, setWasteRate] = useState('');
  const [wasteReason, setWasteReason] = useState('');
  const [result, setResult] = useState<TakeoffDto | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await roof.takeoff(s.versionId, takeoffRequest(rows, wasteRate.trim() ? { rate: wasteRate, reason: wasteReason } : undefined)));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>Enter each material&apos;s coverage per pack from your supplier. A blank coverage stays unresolved; nothing is assumed.</p>
      <table className={styles.table}>
        <caption>Materials</caption>
        <thead>
          <tr>
            <th scope="col">Material</th>
            <th scope="col">Measured from</th>
            <th scope="col">Coverage per pack</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code}>
              <th scope="row">{r.description}</th>
              <td>{r.basis.kind === 'sloped_area' ? 'Sloped area (ft²)' : `${r.basis.edgeTypes.map((t) => EDGE_LABELS[t]).join(' + ')} (lf)`}</td>
              <td>
                <TextInput
                  aria-label={`Coverage per ${r.packUnit} for ${r.description} (${r.basis.kind === 'sloped_area' ? 'ft²' : 'lf'})`}
                  inputMode="decimal"
                  size={8}
                  value={r.coverage}
                  onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, coverage: e.target.value } : x)))}
                />{' '}
                per {r.packUnit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.row}>
        <Field label="Waste override (fraction, optional)" hint="Leave blank to use your waste rules. Applied once.">
          <TextInput inputMode="decimal" value={wasteRate} onChange={(e) => setWasteRate(e.target.value)} placeholder="0.12" />
        </Field>
        <Field label="Waste reason">
          <TextInput value={wasteReason} onChange={(e) => setWasteReason(e.target.value)} disabled={!wasteRate.trim()} />
        </Field>
      </div>
      {error !== null && <ErrorNotice error={error} title="The takeoff was not calculated" />}
      <Button loading={busy} disabled={Boolean(wasteRate.trim()) && wasteReason.trim().length < 3} onClick={() => void run()}>
        Calculate takeoff
      </Button>
      {result && <TakeoffResult t={result} />}
    </div>
  );
}

export function TakeoffResult({ t }: { t: TakeoffDto }) {
  const pct = (Number(t.wasteFraction) * 100).toFixed(1);
  return (
    <section aria-labelledby="to-h" className={styles.stack} data-testid="takeoff-result">
      <h3 id="to-h">Takeoff</h3>
      <p>
        Waste {pct}% ({t.wasteSource === 'human_entered' ? 'entered by a person' : 'from your waste rules'}), applied once. Sloped area {t.area.slopedFt2 ?? 'unknown'} ft²
        {t.area.squares ? ` (${Number(t.area.squares).toFixed(4)} squares)` : ''}. Engine {t.engineVersion}.
      </p>
      {t.unresolvedCount > 0 && <p className={styles.issue}>{t.unresolvedCount} line(s) unresolved; they are not priced until resolved.</p>}
      <table className={styles.table}>
        <caption>Exact vs order quantities</caption>
        <thead>
          <tr>
            <th scope="col">Material</th>
            <th scope="col" className={styles.num}>
              Measured
            </th>
            <th scope="col" className={styles.num}>
              With waste
            </th>
            <th scope="col" className={styles.num}>
              Exact packs
            </th>
            <th scope="col" className={styles.num}>
              Order
            </th>
            <th scope="col">Formula</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l, i) => {
            const g = (k: string) => (l[k] === null || l[k] === undefined ? null : String(l[k]));
            const unresolved = g('status') === 'unresolved';
            return (
              <tr key={g('code') ?? i}>
                <th scope="row">{g('code')}</th>
                <td className={styles.num}>{g('baseQuantity') ? `${fix(g('baseQuantity'))} ${g('baseUnit')}` : 'Unknown'}</td>
                <td className={styles.num}>{fix(g('quantityWithWaste')) ?? '—'}</td>
                <td className={styles.num}>{fix(g('exactPacks'), 4) ?? '—'}</td>
                <td className={styles.num}>{unresolved ? <span className={styles.issue}>Unresolved</span> : `${g('orderPacks')} ${g('packUnit')}`}</td>
                <td>
                  <span className={styles.formula}>{unresolved ? g('unresolvedReason') : g('formula')}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function fix(v: string | null, d = 2): string | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : v;
}

export function VersionsPanel({ s, roof, onChanged }: { s: RoofGeometryState; roof: RoofEndpoints; onChanged: () => void }) {
  const versions = useQuery({ queryKey: ['roof', 'versions', s.reportId], queryFn: () => roof.versions(s.reportId) });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const router = useRouter();
  const cmp = useQuery({ queryKey: ['roof', 'compare', s.reportId, from, to], queryFn: () => roof.compare(s.reportId, from, to), enabled: Boolean(from && to && from !== to) });
  const items = versions.data?.items ?? [];
  const revise = async () => {
    setError(null);
    try {
      await roof.startRevision(s.reportId, reason.trim());
      onChanged();
      router.push(`/roof/reports/${s.reportId}/edit`);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className={styles.stack}>
      {versions.isPending && <Skeleton lines={3} />}
      <table className={styles.table}>
        <caption>Versions</caption>
        <thead>
          <tr>
            <th scope="col">Version</th>
            <th scope="col">Status</th>
            <th scope="col">Submitted</th>
            <th scope="col">Approved</th>
          </tr>
        </thead>
        <tbody>
          {items.map((v) => (
            <tr key={v.id}>
              <th scope="row">v{v.versionNumber}</th>
              <td>{v.status}</td>
              <td>{v.submittedAt ? new Date(v.submittedAt).toLocaleString() : '—'}</td>
              <td>{v.approvedAt ? new Date(v.approvedAt).toLocaleString() : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length > 1 && (
        <div className={styles.row}>
          <Field label="Compare from">
            <Select value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Choose…" options={items.map((v) => ({ value: v.id, label: `v${v.versionNumber}` }))} />
          </Field>
          <Field label="to">
            <Select value={to} onChange={(e) => setTo(e.target.value)} placeholder="Choose…" options={items.map((v) => ({ value: v.id, label: `v${v.versionNumber}` }))} />
          </Field>
        </div>
      )}
      {cmp.isError && <ErrorNotice error={cmp.error} />}
      {cmp.data && <CompareView c={cmp.data} />}
      {(s.versionStatus === 'approved' || s.versionStatus === 'issued') && (
        <section className={styles.panel} aria-labelledby="rev-h">
          <h3 id="rev-h">Correct this report</h3>
          <p className={styles.muted}>Starts a new draft version. History is kept and any roof estimate built from this report is marked stale.</p>
          <Field label="Reason">
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error !== null && <ErrorNotice error={error} />}
          <Button size="sm" variant="secondary" disabled={reason.trim().length < 3} onClick={() => void revise()}>
            Start corrected revision
          </Button>
        </section>
      )}
    </div>
  );
}

export function CompareView({ c }: { c: { from: number; to: number; facets: Record<string, unknown>[]; edgeTotals: Record<string, unknown>; property: Record<string, unknown> } }) {
  const p = c.property as { before?: { slopedAreaM2?: number | null; netPlanAreaM2?: number }; after?: { slopedAreaM2?: number | null; netPlanAreaM2?: number } };
  return (
    <section aria-labelledby="cmp-h" className={styles.stack} data-testid="compare">
      <h3 id="cmp-h">
        v{c.from} → v{c.to}
      </h3>
      <p>
        Sloped area {fmtFt2(p.before?.slopedAreaM2)} → {fmtFt2(p.after?.slopedAreaM2)}; plan area {fmtFt2(p.before?.netPlanAreaM2)} → {fmtFt2(p.after?.netPlanAreaM2)}
      </p>
      {c.facets.length === 0 && Object.keys(c.edgeTotals).length === 0 && <p>No differences in facets or edges.</p>}
      <ul>
        {c.facets.map((f) => (
          <li key={String(f.id)} className={f.change === 'added' ? styles.diffAdded : f.change === 'removed' ? styles.diffRemoved : undefined}>
            Facet {String(f.id)}: {String(f.change)}
          </li>
        ))}
        {Object.entries(c.edgeTotals).map(([t, d]) => {
          const dd = d as { before: number | null; after: number | null };
          return (
            <li key={t}>
              {EDGE_LABELS[t as RoofEdgeType] ?? t}: {fmtFt(dd.before)} → {fmtFt(dd.after)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ExportsPanel({ s, roof }: { s: RoofGeometryState; roof: RoofEndpoints }) {
  const [records, setRecords] = useState<ExportRecord[]>([]);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const poll = (id: string, n = 0) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await roof.exportRecord(id);
        setRecords((cur) => cur.map((x) => (x.id === id ? r : x)));
        if (r.status === 'pending' && n < 30) poll(id, n + 1);
      } catch (e) {
        setError(e);
      }
    }, 1000);
  };
  const create = async (format: ExportFormat) => {
    setError(null);
    try {
      const r = await roof.createExport(s.reportId, format, s.versionId);
      setRecords((cur) => [r, ...cur]);
      if (r.status === 'pending') poll(r.id);
    } catch (e) {
      setError(e);
    }
  };
  const download = async (id: string) => {
    setError(null);
    try {
      const l = await roof.downloadLink(id);
      window.open(l.url, '_blank', 'noopener');
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className={styles.stack}>
      <p className={styles.muted}>Exports are made from this frozen version. Imagery appears in the PDF only when its license allows it; otherwise the diagram and a disclosure are shown.</p>
      <div className={styles.row}>
        <Button onClick={() => void create('pdf')}>Create PDF</Button>
        <Button variant="secondary" onClick={() => void create('csv')}>
          Create CSV
        </Button>
        <Button variant="secondary" onClick={() => void create('json')}>
          Create JSON
        </Button>
      </div>
      {error !== null && <ErrorNotice error={error} />}
      {records.length > 0 && (
        <table className={styles.table}>
          <caption>Exports this session</caption>
          <thead>
            <tr>
              <th scope="col">Format</th>
              <th scope="col">Status</th>
              <th scope="col">Checksum (SHA-256)</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.format.toUpperCase()}</th>
                <td role="status">{r.status === 'pending' ? 'Generating…' : r.status}</td>
                <td>
                  <code>{r.sha256 ? `${r.sha256.slice(0, 16)}…` : '—'}</code>
                </td>
                <td>
                  {r.status === 'completed' && (
                    <Button size="sm" onClick={() => void download(r.id)}>
                      Download {r.format.toUpperCase()}
                    </Button>
                  )}
                  {r.status === 'failed' && (
                    <Button size="sm" variant="secondary" onClick={() => void roof.retryExport(r.id).then((x) => setRecords((cur) => cur.map((y) => (y.id === x.id ? x : y))))}>
                      Retry
                    </Button>
                  )}
                  {r.error && <span className={styles.issue}> {r.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const DEFAULT_TIERS: TierInput[] = [
  { tier: 'good', label: 'Good', enabled: true, lines: [{ code: '', quantityKey: 'roof_order_area' }] },
  { tier: 'better', label: 'Better', enabled: true, lines: [{ code: '', quantityKey: 'roof_order_area' }] },
  { tier: 'best', label: 'Best', enabled: false, lines: [{ code: '', quantityKey: 'roof_order_area' }] },
];

export function QuotePanel({ s, roof }: { s: RoofGeometryState; roof: RoofEndpoints }) {
  const [tiers, setTiers] = useState<TierInput[]>(DEFAULT_TIERS);
  const [conf, setConf] = useState({ pricingDate: false, waste: false });
  const [preview, setPreview] = useState<Awaited<ReturnType<RoofEndpoints['quotePreview']>> | null>(null);
  const [selected, setSelected] = useState<TierInput['tier']>('good');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const setLine = (i: number, patch: Partial<TierInput['lines'][number]>) => setTiers((cur) => cur.map((t, j) => (j === i ? { ...t, lines: [{ ...t.lines[0]!, ...patch }] } : t)));
  const doPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await roof.quotePreview(s.reportId, quoteRequest(tiers, conf, s.versionId)));
      key.current = newIdempotencyKey();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      const est = await roof.convert(s.reportId, quoteRequest(tiers, conf, s.versionId, selected), key.current);
      toast.show({ message: 'Roof estimate created', tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['roof'] });
      router.push(`/estimates/${est.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.stack}>
      <div className={styles.tiers}>
        {tiers.map((t, i) => (
          <fieldset key={t.tier} className={styles.panel}>
            <legend>{t.label}</legend>
            <Checkbox label="Include this tier" checked={t.enabled} onChange={(e) => setTiers((cur) => cur.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
            <Field label="Price book item code">
              <TextInput value={t.lines[0]?.code ?? ''} onChange={(e) => setLine(i, { code: e.target.value })} disabled={!t.enabled} />
            </Field>
            <Field label="Quantity">
              <Select value={t.lines[0]?.quantityKey ?? 'roof_order_area'} onChange={(e) => setLine(i, { quantityKey: e.target.value })} disabled={!t.enabled} options={QUOTE_QUANTITY_KEYS.map((q) => ({ value: q.value, label: q.label }))} />
            </Field>
          </fieldset>
        ))}
      </div>
      <Checkbox label="I confirm the price book date used for this quote." checked={conf.pricingDate} onChange={(e) => setConf((c) => ({ ...c, pricingDate: e.target.checked }))} />
      <Checkbox label="I confirm the waste decision in the takeoff." checked={conf.waste} onChange={(e) => setConf((c) => ({ ...c, waste: e.target.checked }))} />
      {error !== null && <ErrorNotice error={error} title="The quote was not priced" />}
      <Button loading={busy} disabled={!conf.pricingDate || !conf.waste} onClick={() => void doPreview()}>
        Preview quote
      </Button>
      {preview && (
        <section aria-labelledby="qp-h" className={styles.stack} data-testid="quote-preview">
          <h3 id="qp-h">Preview (nothing saved)</h3>
          <div className={styles.tiers}>
            {preview.tiers.map((t) => {
              const total = money(t.totalMinor, t.currency);
              const low = money(t.lowTotalMinor, t.currency);
              const high = money(t.highTotalMinor, t.currency);
              const blockers = Array.isArray(t.blockers) ? (t.blockers as { message?: string }[]) : [];
              return (
                <label key={String(t.tier)} className={styles.choice} data-selected={selected === t.tier || undefined}>
                  <span>
                    <input type="radio" name="tier" checked={selected === t.tier} onChange={() => setSelected(t.tier as TierInput['tier'])} /> <strong>{String(t.label)}</strong>
                  </span>
                  <span>{t.quoteKind === 'range' || !total ? (low && high ? `Range ${low} – ${high}` : 'Not priced') : total}</span>
                  <span className={styles.muted}>{String(t.quoteKind ?? '').replace(/_/g, ' ')}</span>
                  {blockers.map((b, n) => (
                    <span key={n} className={styles.issue}>
                      {b.message ?? JSON.stringify(b)}
                    </span>
                  ))}
                </label>
              );
            })}
          </div>
          <Button loading={busy} onClick={() => void convert()}>
            Create estimate from {selected}
          </Button>
        </section>
      )}
    </div>
  );
}
