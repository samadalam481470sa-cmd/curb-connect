'use client';

// Roof workbench (RF-023, RF-025, RF-027, RF-028, RR-032, COS-204..COS-210, ADD-027..ADD-031,
// ADD-034): trace facets on fixture/permitted imagery or a calibrated blueprint, snap vertices,
// relabel edges, set per-facet pitch (rise/12, degrees or factor, with method/source/confidence),
// cut exclusions, undo/redo through the server command log, and see live totals with an
// uncertainty and scale legend. Every action has a keyboard path and the facet/edge tables are the
// screen-reader alternative to the canvas. Autosave state is shown exactly as one of the four
// SAVE_STATUS_TEXT strings; a conflict never silently discards the local draft.
import type { MeasurementSource, RoofEdgeType, RoofGeometryCommand, RoofGeometryState } from '@fieldline/contracts';
import { Button, Checkbox, Field, Select, Skeleton, TextInput, useToast } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { useApi } from '../../lib/session';
import { ErrorNotice, PageHeader } from '../common';
import { BlueprintCalibration, ImageryBackdrop, type Backdrop } from './ImageryBackdrop';
import { EDGE_LABELS, EDGE_STYLE, buildPreview, describePitch, facetCommands, fmtFt, fmtFt2, fmtSquares, localId, parsePitch, uncertaintySummary, type PitchInputMode, type Pt } from './model';
import { RoofCanvas, viewBoxFor, type Tool } from './RoofCanvas';
import { roofEndpoints, type RoofApi, type RoofEndpoints } from './roofApi';
import { GeometrySync, SAVE_STATUS_TEXT, type DraftStore, type SyncSnapshot } from './sync';
import styles from './roof.module.css';

const EDGE_TYPES = Object.keys(EDGE_LABELS) as RoofEdgeType[];
const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'select', label: 'Select / move', key: 'V' },
  { id: 'draw', label: 'Draw facet', key: 'D' },
  { id: 'edge', label: 'Label edge', key: 'E' },
  { id: 'exclude', label: 'Cut exclusion', key: 'X' },
];
const PITCH_METHODS = [
  { value: 'manual_entry', label: 'Manual entry' },
  { value: 'field_measured', label: 'Measured on site' },
  { value: 'plan_document', label: 'From plans' },
  { value: 'provider_3d', label: 'Provider 3D model' },
  { value: 'verified_model', label: 'Verified model' },
] as const;
const SOURCE_FOR_METHOD: Record<string, MeasurementSource> = {
  manual_entry: 'user_entered',
  field_measured: 'field_verified',
  plan_document: 'survey_supplied',
  provider_3d: 'imagery_derived',
  verified_model: 'machine_estimated',
};

export function RoofWorkbenchPage({ reportId, apiOverride, store }: { reportId: string; apiOverride?: RoofApi; store?: DraftStore }) {
  const { api } = useApi();
  const roof = useMemo(() => roofEndpoints(apiOverride ?? api), [apiOverride, api]);
  const report = useQuery({ queryKey: ['roof', 'report', reportId], queryFn: () => roof.report(reportId), staleTime: Infinity });
  if (report.isPending) return <Skeleton lines={8} />;
  if (report.isError) return <ErrorNotice error={report.error} onRetry={() => void report.refetch()} />;
  return <Workbench key={report.data.versionId} initial={report.data} roof={roof} store={store} />;
}

function useSync(initial: RoofGeometryState, roof: RoofEndpoints, store?: DraftStore) {
  const [sync] = useState(() => new GeometrySync(initial, async ({ clientOpId, commands, ifMatch }) => (await roof.editGeometry(initial.reportId, clientOpId, commands, ifMatch)).geometry, store));
  const [snap, setSnap] = useState<SyncSnapshot>(() => sync.snapshot());
  useEffect(() => sync.subscribe(setSnap), [sync]);
  // Retry a failed save when the browser comes back online (same clientOpId => replay-safe).
  useEffect(() => {
    const on = () => void sync.flush();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [sync]);
  return { sync, snap };
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

export function Workbench({ initial, roof, store }: { initial: RoofGeometryState; roof: RoofEndpoints; store?: DraftStore }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { sync, snap } = useSync(initial, roof, store);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const server = snap.server;
  const preview = useMemo(() => buildPreview(server, snap.pending), [server, snap.pending]);
  const readOnly = server.versionStatus !== 'draft';
  const [tool, setTool] = useState<Tool>('draw');
  const [facetId, setFacetId] = useState<string | null>(null);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [structureId, setStructureId] = useState<string>(initial.structures.find((s) => s.included)?.structureId ?? initial.structures[0]?.structureId ?? 'main');
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const viewBox = useMemo(() => viewBoxFor(server.vertices.length ? server.vertices : preview.vertices), [server.vertices, preview.vertices]);
  const uncertainty = uncertaintySummary(server, backdrop?.metersPerPixel ?? null);

  const order = useQuery({ queryKey: ['roof', 'orders'], queryFn: () => roof.listOrders(), select: (d) => d.items.find((o) => o.reportId === initial.reportId) ?? null });

  const push = (cmds: RoofGeometryCommand[]) => {
    setError(null);
    try {
      void sync.push(cmds);
    } catch (e) {
      setError(e);
    }
  };

  const onPolygon = (pts: { point: Pt; vertexId: string | null }[]) => {
    try {
      if (tool === 'exclude') {
        if (!facetId) throw new Error('Select the facet to cut the exclusion from first.');
        push([{ type: 'exclude_region', facetId, regionId: localId('x'), points: pts.map((p) => p.point) }]);
      } else {
        const id = localId('f');
        push(facetCommands(pts, structureId, id));
        setFacetId(id);
      }
    } catch (e) {
      setError(e);
    }
  };

  const selectedFacet = preview.facets.find((f) => f.id === facetId) ?? null;
  const serverFacet = server.facets.find((f) => f.id === facetId) ?? null;
  const selectedEdge = preview.edges.find((e) => e.id === edgeId) ?? null;

  const relabel = (a: string, b: string, t: RoofEdgeType | '') => push([{ type: 'relabel_edge', vertexIds: [a, b], edgeType: t === '' ? null : t }]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await roof.submit(server.reportId, server.geometryRevision);
      sync.replaceServer(r.version);
      toast.show({ message: r.requiresSecondReview ? 'Submitted for review (a second reviewer is required).' : 'Submitted for review.', tone: 'success' });
      void qc.invalidateQueries({ queryKey: ['roof'] });
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const resolveConflict = async (mode: 'reapply' | 'discard') => {
    setError(null);
    try {
      const fresh = await roof.report(server.reportId);
      if (mode === 'discard') sync.discardLocal(fresh);
      else await sync.reapplyOnto(fresh);
    } catch (e) {
      setError(e);
    }
  };

  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (!readOnly) void (e.shiftKey ? sync.redo() : sync.undo());
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (!readOnly) void sync.redo();
      return;
    }
    if (mod || e.altKey) return;
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && target.getAttribute('role') !== 'application') setTool(t.id);
  };

  const submitBlockers = [
    ...preview.facets.filter((f) => !f.pitch).map((f) => `Facet ${f.id} has no pitch.`),
    ...preview.edges.filter((e) => e.conflict).map((e) => `Edge ${EDGE_LABELS[e.type]} has a label conflict.`),
    ...server.structures.filter((s) => s.included && !s.measured).map((s) => `Structure ${s.structureId} is unmeasured.`),
    ...preview.issues.filter((i) => i.severity === 'error').map((i) => i.message),
  ];

  return (
    <div onKeyDown={onKeys}>
      <PageHeader
        title={`Roof sketch, version ${server.versionNumber}`}
        description={readOnly ? `This version is ${server.versionStatus}; it is read-only.` : 'Trace each roof plane, set its pitch, and check edge labels before submitting for review.'}
      />
      <div className={styles.row}>
        <span className={styles.status} data-status={snap.status} role="status" aria-live="polite" data-testid="save-status">
          {SAVE_STATUS_TEXT[snap.status]}
        </span>
        {!online && <span className={styles.muted}>Offline: edits are kept on this device.</span>}
        <span className={styles.muted}>Server revision {server.geometryRevision}</span>
        <Link href={`/roof/reports/${server.reportId}`}>Report</Link>
      </div>
      {snap.status === 'failed' && (
        <div className={styles.panel} role="alert">
          <p>Your edits are kept on this device. They have not reached the server.</p>
          <Button size="sm" onClick={() => void sync.flush()}>
            Retry save
          </Button>
        </div>
      )}
      {snap.status === 'conflict' && (
        <div className={styles.panel} role="alert" data-testid="conflict-panel">
          <p>
            Someone else changed this sketch (or your draft was made against an older revision). Your {snap.pending.length} unsaved change
            {snap.pending.length === 1 ? '' : 's'} are kept. Choose how to continue:
          </p>
          <div className={styles.row}>
            <Button size="sm" onClick={() => void resolveConflict('reapply')}>
              Load latest and re-apply my changes
            </Button>
            <Button size="sm" variant="danger" onClick={() => void resolveConflict('discard')}>
              Discard my changes
            </Button>
          </div>
        </div>
      )}
      {error !== null && <ErrorNotice error={error} title="That edit was not applied" />}

      <div className={styles.workbench}>
        <div className={styles.stack}>
          {!readOnly && (
            <div className={styles.row} role="toolbar" aria-label="Sketch tools">
              {TOOLS.map((t) => (
                <Button key={t.id} size="sm" variant={tool === t.id ? 'primary' : 'secondary'} aria-pressed={tool === t.id} aria-keyshortcuts={t.key} onClick={() => setTool(t.id)}>
                  {t.label}
                </Button>
              ))}
              <Button size="sm" variant="ghost" aria-keyshortcuts="Control+Z" disabled={!server.canUndo && snap.pending.length === 0} onClick={() => void sync.undo()}>
                Undo
              </Button>
              <Button size="sm" variant="ghost" aria-keyshortcuts="Control+Shift+Z" disabled={!server.canRedo} onClick={() => void sync.redo()}>
                Redo
              </Button>
              <Field label="New facets belong to">
                <Select value={structureId} onChange={(e) => setStructureId(e.target.value)} options={server.structures.map((s) => ({ value: s.structureId, label: `Structure ${s.structureId.slice(0, 8)}${s.included ? '' : ' (excluded)'}` }))} />
              </Field>
            </div>
          )}
          <RoofCanvas
            preview={preview}
            viewBox={viewBox}
            tool={readOnly ? 'select' : tool}
            selectedFacetId={facetId}
            selectedEdgeId={edgeId}
            readOnly={readOnly}
            backdrop={<ImageryBackdrop backdrop={backdrop} viewBox={viewBox} />}
            legend={<Legend scale={uncertainty.scale} lowest={uncertainty.lowestConfidence} unknown={uncertainty.unknownPitches} local={snap.pending.length > 0} backdrop={backdrop} />}
            onSelectFacet={(id) => {
              setFacetId(id);
              setEdgeId(null);
            }}
            onSelectEdge={(id) => setEdgeId(id)}
            onMoveVertex={(id, p) => push([{ type: 'move_vertex', id, x: p.x, y: p.y }])}
            onPolygon={onPolygon}
          />
          <ImagerySource orderImageryId={order.data?.imageryAssetId ?? null} propertyId={order.data?.propertyId ?? null} roof={roof} onBackdrop={setBackdrop} />
          <FacetTable preview={preview} selected={facetId} onSelect={setFacetId} />
          <EdgeTable preview={preview} readOnly={readOnly} selected={edgeId} onSelect={setEdgeId} onRelabel={relabel} />
        </div>

        <aside className={styles.stack} aria-label="Sketch details">
          <Totals preview={preview} server={server} />
          {selectedFacet && (
            <PitchEditor
              key={selectedFacet.id}
              facetId={selectedFacet.id}
              current={serverFacet?.pitch ?? null}
              localPitch={selectedFacet.pitch}
              readOnly={readOnly}
              onSet={(cmd) => push([cmd])}
              onDelete={() => {
                push([{ type: 'delete_facet', id: selectedFacet.id }]);
                setFacetId(null);
              }}
            />
          )}
          {selectedEdge && !readOnly && (
            <section className={styles.panel} aria-labelledby="edge-h">
              <h2 id="edge-h">Edge</h2>
              <p>
                {fmtFt(selectedEdge.trueLengthM ?? selectedEdge.planLengthM)} {selectedEdge.trueLengthM == null && '(plan length; pitch unknown)'}
              </p>
              {selectedEdge.conflict && <p className={styles.issue}>Conflict: {selectedEdge.conflict}</p>}
              <Field label="Edge type">
                <Select
                  value={selectedEdge.type}
                  onChange={(e) => relabel(selectedEdge.a, selectedEdge.b, e.target.value as RoofEdgeType)}
                  options={EDGE_TYPES.map((t) => ({ value: t, label: EDGE_LABELS[t] }))}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => relabel(selectedEdge.a, selectedEdge.b, '')}>
                Use the derived type
              </Button>
            </section>
          )}
          {preview.issues.length > 0 && (
            <section className={styles.panel} aria-labelledby="issues-h">
              <h2 id="issues-h">Checks</h2>
              <ul>
                {preview.issues.map((i, n) => (
                  <li key={`${i.code}-${n}`} className={i.severity === 'error' ? styles.issue : undefined}>
                    {i.severity === 'error' ? 'Blocks submit: ' : 'Warning: '}
                    {i.message}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!readOnly && <BlueprintCalibration propertyId={order.data?.propertyId ?? null} roof={roof} onBackdrop={setBackdrop} />}
          {!readOnly && (
            <section className={styles.panel} aria-labelledby="submit-h">
              <h2 id="submit-h">Submit for review</h2>
              {submitBlockers.length > 0 ? (
                <ul aria-label="What blocks submitting">
                  {submitBlockers.slice(0, 8).map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>Submitting freezes this version and sends it to a reviewer.</p>
              )}
              <Button loading={submitting} disabled={submitBlockers.length > 0 || snap.status !== 'saved'} onClick={() => void submit()}>
                Submit for review
              </Button>
              {snap.status !== 'saved' && <p className={styles.muted}>Wait until every change is saved to the server.</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({ scale, lowest, unknown, local, backdrop }: { scale: string; lowest: number | null; unknown: number; local: boolean; backdrop: Backdrop | null }) {
  return (
    <div className={styles.legend} data-testid="roof-legend">
      <ul aria-label="Edge types">
        {(['eave', 'rake', 'ridge', 'hip', 'valley', 'flashing'] as RoofEdgeType[]).map((t) => (
          <li key={t}>
            <span className={styles.swatch} style={{ borderTopColor: EDGE_STYLE[t].color, borderTopStyle: EDGE_STYLE[t].dash ? 'dashed' : 'solid' }} aria-hidden="true" />
            {EDGE_LABELS[t]}
          </li>
        ))}
      </ul>
      <div>Scale: {backdrop?.calibrationNote ?? scale}</div>
      <div>
        Pitch confidence: {lowest === null ? 'no confidence recorded' : `lowest ${Math.round(lowest * 100)}%`}
        {unknown > 0 ? `; ${unknown} facet${unknown === 1 ? '' : 's'} without pitch` : ''}
      </div>
      {local && <div>Totals include unsaved local edits (preview).</div>}
    </div>
  );
}

function Totals({ preview, server }: { preview: ReturnType<typeof buildPreview>; server: RoofGeometryState }) {
  return (
    <section className={styles.panel} aria-labelledby="totals-h" aria-live="polite">
      <h2 id="totals-h">Totals</h2>
      <dl className={styles.kv}>
        <dt>Facets</dt>
        <dd>{preview.totals.facetCount}</dd>
        <dt>Plan area</dt>
        <dd data-testid="total-plan">{fmtFt2(preview.totals.netPlanAreaM2)}</dd>
        <dt>Sloped area</dt>
        <dd data-testid="total-sloped">{preview.totals.slopedAreaM2 == null ? 'Unknown until every facet has a pitch' : fmtFt2(preview.totals.slopedAreaM2)}</dd>
        <dt>Squares</dt>
        <dd>{preview.totals.slopedAreaM2 == null ? 'Unknown' : fmtSquares((preview.totals.slopedAreaM2 * 10.763910416709722) / 100)}</dd>
      </dl>
      <h3>Edges</h3>
      <dl className={styles.kv}>
        {Object.entries(server.edgeTotals).map(([t, v]) => (
          <div key={t} style={{ display: 'contents' }}>
            <dt>{EDGE_LABELS[t as RoofEdgeType] ?? t}</dt>
            <dd>
              {v.count} · {fmtFt(v.trueLengthM ?? v.planLengthM)}
            </dd>
          </div>
        ))}
      </dl>
      <h3>Structures</h3>
      <ul>
        {server.structures.map((s) => (
          <li key={s.structureId}>
            {s.structureId.slice(0, 8)}: {!s.included ? 'excluded' : !s.measured ? 'unmeasured' : `${s.facetCount} facets, ${fmtFt2(s.slopedAreaM2 ?? s.netPlanAreaM2)}${s.slopedAreaM2 == null ? ' (plan)' : ''}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PitchEditor({
  facetId,
  current,
  localPitch,
  readOnly,
  onSet,
  onDelete,
}: {
  facetId: string;
  current: RoofGeometryState['facets'][number]['pitch'];
  localPitch: { rise: number; run: number } | null;
  readOnly: boolean;
  onSet: (cmd: RoofGeometryCommand) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<PitchInputMode>('rise12');
  const [raw, setRaw] = useState('');
  const [method, setMethod] = useState<string>(current?.method && current.method !== 'single_overhead_photo' ? current.method : 'manual_entry');
  const [confidence, setConfidence] = useState(current?.confidence != null ? String(current.confidence) : '');
  const [err, setErr] = useState<string | null>(null);
  const d = describePitch(localPitch);
  const apply = () => {
    try {
      const p = parsePitch(mode, raw);
      const c = confidence.trim() === '' ? undefined : Number(confidence);
      if (c !== undefined && (!Number.isFinite(c) || c < 0 || c > 1)) throw new Error('Confidence is a number from 0 to 1.');
      setErr(null);
      onSet({ type: 'set_pitch', facetId, pitch: p, method: method as 'manual_entry', source: SOURCE_FOR_METHOD[method] ?? 'user_entered', ...(c !== undefined && { confidence: c }) });
      setRaw('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="pitch-h">
      <h2 id="pitch-h">Facet {facetId}</h2>
      <dl className={styles.kv}>
        <dt>Pitch</dt>
        <dd data-testid="pitch-current">
          {d.rise12} · {d.degrees} · factor {d.factor}
        </dd>
        <dt>Method</dt>
        <dd>{current ? `${current.method.replace(/_/g, ' ')} (${current.source.replace(/_/g, ' ')})` : 'Not set'}</dd>
        <dt>Confidence</dt>
        <dd>{current?.confidence == null ? 'Not recorded' : `${Math.round(current.confidence * 100)}%`}</dd>
      </dl>
      {!readOnly && (
        <form
          className={styles.stack}
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Field label="Enter pitch as">
            <Select
              value={mode}
              onChange={(e) => setMode(e.target.value as PitchInputMode)}
              options={[
                { value: 'rise12', label: 'Rise per 12 (e.g. 6)' },
                { value: 'degrees', label: 'Degrees (e.g. 26.57)' },
                { value: 'factor', label: 'Slope factor (e.g. 1.118)' },
              ]}
            />
          </Field>
          <Field label="Pitch value" hint="Leave blank to mark the pitch unknown." error={err ?? undefined}>
            <TextInput inputMode="decimal" value={raw} onChange={(e) => setRaw(e.target.value)} />
          </Field>
          <Field label="How was it determined?" hint="A single overhead photo cannot establish pitch.">
            <Select value={method} onChange={(e) => setMethod(e.target.value)} options={PITCH_METHODS.map((m) => ({ value: m.value, label: m.label }))} />
          </Field>
          <Field label="Confidence (0 to 1, optional)">
            <TextInput inputMode="decimal" value={confidence} onChange={(e) => setConfidence(e.target.value)} />
          </Field>
          <div className={styles.row}>
            <Button size="sm" type="submit">
              Set pitch
            </Button>
            <Button size="sm" variant="danger" type="button" onClick={onDelete}>
              Delete facet
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function FacetTable({ preview, selected, onSelect }: { preview: ReturnType<typeof buildPreview>; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <table className={styles.table} data-testid="facet-table">
      <caption>Facets (table view of the sketch)</caption>
      <thead>
        <tr>
          <th scope="col">Facet</th>
          <th scope="col">Structure</th>
          <th scope="col">Pitch</th>
          <th scope="col" className={styles.num}>
            Plan area
          </th>
          <th scope="col" className={styles.num}>
            Sloped area
          </th>
        </tr>
      </thead>
      <tbody>
        {preview.facets.length === 0 && (
          <tr>
            <td colSpan={5}>No facets yet. Choose Draw facet and place corners on the surface.</td>
          </tr>
        )}
        {preview.facets.map((f) => (
          <tr key={f.id} aria-selected={f.id === selected}>
            <th scope="row">
              <Button size="sm" variant={f.id === selected ? 'primary' : 'ghost'} onClick={() => onSelect(f.id)}>
                {f.id}
              </Button>
            </th>
            <td>{f.structureId.slice(0, 8)}</td>
            <td>{describePitch(f.pitch).rise12}</td>
            <td className={styles.num}>{fmtFt2(f.netPlanAreaM2)}</td>
            <td className={styles.num}>{f.slopedAreaM2 == null ? 'Unknown' : fmtFt2(f.slopedAreaM2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EdgeTable({
  preview,
  readOnly,
  selected,
  onSelect,
  onRelabel,
}: {
  preview: ReturnType<typeof buildPreview>;
  readOnly: boolean;
  selected: string | null;
  onSelect: (id: string) => void;
  onRelabel: (a: string, b: string, t: RoofEdgeType) => void;
}) {
  if (preview.edges.length === 0) return null;
  return (
    <table className={styles.table} data-testid="edge-table">
      <caption>Edges</caption>
      <thead>
        <tr>
          <th scope="col">Edge</th>
          <th scope="col">Type</th>
          <th scope="col" className={styles.num}>
            Length
          </th>
          <th scope="col">Check</th>
        </tr>
      </thead>
      <tbody>
        {preview.edges.map((e) => (
          <tr key={e.id} aria-selected={e.id === selected} onFocus={() => onSelect(e.id)}>
            <th scope="row">
              {e.a}–{e.b}
            </th>
            <td>
              {readOnly ? (
                EDGE_LABELS[e.type]
              ) : (
                <Select aria-label={`Type of edge ${e.a}–${e.b}`} value={e.type} onChange={(ev) => onRelabel(e.a, e.b, ev.target.value as RoofEdgeType)} options={EDGE_TYPES.map((t) => ({ value: t, label: EDGE_LABELS[t] }))} />
              )}
            </td>
            <td className={styles.num}>{fmtFt(e.trueLengthM ?? e.planLengthM)}</td>
            <td>{e.conflict ? <span className={styles.issue}>Conflict: {e.conflict}</span> : 'OK'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImagerySource({ orderImageryId, propertyId, roof, onBackdrop }: { orderImageryId: string | null; propertyId: string | null; roof: RoofEndpoints; onBackdrop: (b: Backdrop | null) => void }) {
  const asset = useQuery({ queryKey: ['imagery', orderImageryId], queryFn: () => roof.imageryAsset(orderImageryId!), enabled: Boolean(orderImageryId) });
  const [show, setShow] = useState(true);
  const a = asset.data;
  const visualize = a?.decisions.find((d) => d.use === 'visualize')?.allowed ?? false;
  useEffect(() => {
    if (!a || !show || !visualize) {
      onBackdrop(null);
      return;
    }
    const g = a.georef as { origin?: [number, number]; metersPerPixel?: number } | null;
    onBackdrop({ kind: a.isSynthetic ? 'synthetic' : 'map', origin: g?.origin ?? null, metersPerPixel: g?.metersPerPixel ?? a.gsdM, attribution: a.attribution, calibrationNote: null, imageUrl: null });
  }, [a, show, visualize, onBackdrop]);
  if (!orderImageryId) return <p className={styles.muted}>No imagery is attached to this order{propertyId ? '; trace from a calibrated blueprint or attach imagery on the order page' : ''}. Lengths come from your traced coordinates.</p>;
  if (!a) return null;
  return (
    <div className={styles.row}>
      <Checkbox label="Show imagery behind the sketch" checked={show} disabled={!visualize} onChange={(e) => setShow(e.target.checked)} />
      <span className={styles.muted}>
        {a.provider.replace(/_/g, ' ')}
        {a.isSynthetic ? ' (synthetic test imagery)' : ''}. {visualize ? a.attribution : 'Display not permitted by the license.'}
      </span>
    </div>
  );
}
