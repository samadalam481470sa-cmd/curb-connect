'use client';

import dynamic from 'next/dynamic';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RoofMeasurementDetailSchema } from '@fieldline/contracts';
import { AREA_SUMMARIES } from '../../components/AreaPage';
import { RouteGate } from '../../components/RouteGate';
import { AccountDraftStatus, useAccountDraft } from '../../lib/accountDrafts';
import { errorHint } from '../../lib/api';
import { referenceUnitPrice, PRICE_BOOK, type MaterialId } from '../build/prices';
import { SupplierLinks } from '../command/MaterialLookup';
import { Kpi, money, money0, num, NumberField, Panel } from '../command/Panel';
import { measureRoof, type MapFacet } from './map/facetMath';
import {
  AutoDetectResponseSchema,
  confirmFacets,
  fromDetailFacets,
  readSavedRoofRecord,
  snapshotOfFacets,
  toWorkspaceCandidate,
  writeSavedRoofRecord,
  type WorkspaceCandidate,
} from './map/autoDetect';
import { RoofRecordPanel } from './RoofRecordPanel';
import { RoofQuoteBuilder } from './RoofQuoteBuilder';
import { fetchLivePrices } from '../build/live';
import { useApi } from '../../lib/session';
import type { LivePriceResponse } from '../build/prices';
import { SHINGLE_OPTIONS, computeShingleQuote, type ShingleId } from './shinglePricing';
import { roofTakeoff, type FacetInput } from './roofTakeoff';

// The map bundle (MapLibre + imagery) only loads on the client, in its own chunk.
const RoofMap = dynamic(() => import('./map/RoofMap').then((m) => m.RoofMap), {
  ssr: false,
  loading: () => (
    <div className="cc-roofmap__stage" aria-busy="true">
      <div className="cc-roofmap__overlay">
        <span className="cc-mono">Loading map module…</span>
      </div>
    </div>
  ),
});

type Mode = 'map' | 'manual';
type LonLat = { lon: number; lat: number };

const DRAFT_KEY = 'fieldpro.roof.workspace.v1';

const newId = () => `f-${Math.random().toString(36).slice(2, 8)}`;

const START: FacetInput[] = [
  { id: 'f-1', name: 'Facet A', lengthFt: 40, runFt: 15, pitch: 6 },
  { id: 'f-2', name: 'Facet B', lengthFt: 40, runFt: 15, pitch: 6 },
];

export function RoofWorkspace() {
  return (
    <RouteGate routeId="roof">
      <Workspace />
    </RouteGate>
  );
}

function Workspace() {
  const [facets, setFacets] = useState<FacetInput[]>(START);
  const [waste, setWaste] = useState(10);
  const [redeck, setRedeck] = useState(false);
  const [shingleId, setShingleId] = useState<ShingleId>('gaf_hdz');
  const [customBundles, setCustomBundles] = useState(3);
  const [bundleRate, setBundleRate] = useState('');
  const [laborRate, setLaborRate] = useState('');
  const { api } = useApi();
  const qc = useQueryClient();
  const [jobLocation, setJobLocation] = useState<LonLat | null>(null);
  // Auto-detected candidates: display-only until confirmed; never part of the totals.
  const [autoCandidates, setAutoCandidates] = useState<WorkspaceCandidate[]>([]);
  const [selectedAutoId, setSelectedAutoId] = useState<string | null>(null);
  const [autoStatus, setAutoStatus] = useState<'idle' | 'busy' | 'found' | 'not_found' | 'unavailable' | 'error'>('idle');
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoModel, setAutoModel] = useState<string | null>(null);
  const [autoDetectedAt, setAutoDetectedAt] = useState<string | null>(null);
  const [autoImagerySource, setAutoImagerySource] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [shingleOffers, setShingleOffers] = useState<LivePriceResponse | null>(null);
  const [shingleOffersAt, setShingleOffersAt] = useState('');
  const [shingleLookupBusy, setShingleLookupBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('map');
  const [mapFacets, setMapFacets] = useState<MapFacet[]>([]);
  const [houseOutline, setHouseOutline] = useState<LonLat[]>([]);
  const [outlineSource,setOutlineSource]=useState<'manual'|'openstreetmap'>('manual');
  const [jobAddress,setJobAddress]=useState('');
  const [fitSignal, setFitSignal] = useState(0);

  const cloudDraft = useAccountDraft({
    key: 'roof-workspace',
    legacyKey: DRAFT_KEY,
    value: {
      facets, waste, redeck, mode, mapFacets, houseOutline,outlineSource,jobAddress,
      shingleId, customBundles, bundleRate, laborRate,
    },
    onRestore: (d: {
      facets?: FacetInput[]; waste?: number; redeck?: boolean; mode?: Mode;
      mapFacets?: MapFacet[]; houseOutline?: LonLat[]; outlineSource?:'manual'|'openstreetmap'; jobAddress?:string; shingleId?: ShingleId;
      customBundles?: number; bundleRate?: string; laborRate?: string;
    }) => {
      if (d.mode === 'map' || d.mode === 'manual') setMode(d.mode);
      if (Array.isArray(d.mapFacets)) setMapFacets(d.mapFacets);
      if(d.outlineSource==='openstreetmap'||d.outlineSource==='manual')setOutlineSource(d.outlineSource);
      if(typeof d.jobAddress==='string'&&d.jobAddress.length<=250)setJobAddress(d.jobAddress);
      if (Array.isArray(d.houseOutline) && d.houseOutline.length >= 3 &&
        d.houseOutline.length <= 200 && d.houseOutline.every(p =>
          Number.isFinite(p.lon) && Number.isFinite(p.lat))) setHouseOutline(d.houseOutline);
      if (Array.isArray(d.facets) && d.facets.length > 0) setFacets(d.facets);
      if (typeof d.waste === 'number') setWaste(d.waste);
      if (typeof d.redeck === 'boolean') setRedeck(d.redeck);
      if (SHINGLE_OPTIONS.some(p => p.id === d.shingleId)) setShingleId(d.shingleId!);
      if (typeof d.customBundles === 'number' && d.customBundles >= 1 &&
        d.customBundles <= 1000) setCustomBundles(d.customBundles);
      if (typeof d.bundleRate === 'string' && d.bundleRate.length < 30) setBundleRate(d.bundleRate);
      if (typeof d.laborRate === 'string' && d.laborRate.length < 30) setLaborRate(d.laborRate);
    },
  });

  // Traced facets: lon/lat rings -> measured plan area. Facets without a confirmed pitch are
  // listed but kept out of squares until the pitch is entered.
  const mapResult = useMemo(() => measureRoof(mapFacets), [mapFacets]);
  // Candidate plan areas, for review only: candidates are not in mapFacets, so they never
  // reach the takeoff totals or a quote until confirmed.
  const autoMeasured = useMemo(
    () =>
      measureRoof(
        autoCandidates.map((c) => ({ id: c.id, name: c.label, ring: c.ring, pitch: c.pitch })),
      ),
    [autoCandidates],
  );

  const runAutoDetect = async () => {
    if (!jobLocation || autoStatus === 'busy') return;
    setAutoStatus('busy');
    setAutoMessage(null);
    setConfirmMessage(null);
    try {
      const res = await api.post(
        '/v1/roof/auto-detect',
        {
          latitude: jobLocation.lat,
          longitude: jobLocation.lon,
          ...(jobAddress.trim() ? { address: jobAddress.trim() } : {}),
        },
        { schema: AutoDetectResponseSchema },
      );
      setAutoModel(res.model);
      setAutoDetectedAt(res.detectedAt);
      setAutoImagerySource(res.imagerySource);
      setAutoMessage(res.message);
      if (res.status === 'found') {
        setAutoCandidates(res.facets.map(toWorkspaceCandidate));
        setAutoStatus('found');
      } else {
        setAutoCandidates([]);
        setAutoStatus(res.status === 'not_found' ? 'not_found' : 'unavailable');
      }
    } catch (e) {
      setAutoStatus('error');
      setAutoMessage(errorHint(e));
    }
  };

  const updateAutoCandidate = (id: string, patch: Partial<WorkspaceCandidate>) =>
    setAutoCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const acceptedCandidates = autoCandidates.filter((c) => c.accepted);

  /** Sends only accepted facets. With a saved record they are confirmed server-side as a
   * new version (source AUTO); without one they are staged on the map and saved through
   * the Record panel's normal flow. Rejected facets never leave the browser. */
  const confirmAccepted = async () => {
    const accepted = autoCandidates.filter((c) => c.accepted);
    if (accepted.length === 0 || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmMessage(null);
    try {
      const saved = readSavedRoofRecord();
      if (saved) {
        const detail = await api.post(
          `/v1/roof/measurements/${saved.id}/auto-detect/confirm`,
          {
            baseVersionNumber: saved.versionNumber,
            facets: confirmFacets(accepted),
            contractorConfirmed: true,
            ...(autoModel ? { model: autoModel } : {}),
            ...(autoDetectedAt ? { detectedAt: autoDetectedAt } : {}),
          },
          { schema: RoofMeasurementDetailSchema },
        );
        const facets = fromDetailFacets(detail);
        setMapFacets(facets);
        setSelected(null);
        setFitSignal((n) => n + 1);
        writeSavedRoofRecord({
          id: detail.id,
          versionNumber: detail.versionNumber,
          snapshot: snapshotOfFacets(facets),
        });
        void qc.invalidateQueries({ queryKey: ['roof-measurement', detail.id] });
        void qc.invalidateQueries({ queryKey: ['roof-measurements'] });
        setAutoCandidates([]);
        setConfirmMessage(
          `Confirmed as version ${detail.versionNumber} (auto-detected, contractor-confirmed). ` +
            'Press Load on this record in the Record panel below before saving further edits, so it picks up the new version.',
        );
      } else {
        const staged: MapFacet[] = accepted.map((c) => ({
          id: newId(),
          name: c.label,
          ring: c.ring,
          pitch: c.pitch,
          source: 'auto_detect' as const,
        }));
        setMapFacets((fs) => [...fs, ...staged]);
        if (staged[0]) setSelected(staged[0].id);
        setFitSignal((n) => n + 1);
        setAutoCandidates([]);
        setConfirmMessage(
          'Accepted facets added to the map as auto-detected. Check each pitch, then save them with the Record panel below.',
        );
      }
    } catch (e) {
      setConfirmMessage(errorHint(e));
    } finally {
      setConfirmBusy(false);
    }
  };
  const mapInputs = useMemo<FacetInput[]>(
    () =>
      mapResult.facets
        .filter((r) => r.pitch !== null)
        .map((r) => ({
          id: r.id,
          name: r.name,
          lengthFt: 0,
          runFt: 0,
          pitch: r.pitch ?? 0,
          planSqFtOverride: r.planSqFt,
        })),
    [mapResult],
  );

  const deferred = useDeferredValue(mode === 'map' ? mapInputs : facets);
  const result = useMemo(() => roofTakeoff(deferred, waste), [deferred, waste]);

  const onFacetDrawn = useCallback((ring: LonLat[]) => {
    setMapFacets((fs) => {
      const id = newId();
      setSelected(id);
      return [
        ...fs,
        { id, name: `Facet ${String.fromCharCode(65 + (fs.length % 26))}`, ring, pitch: null },
      ];
    });
  }, []);
  const updateMap = (id: string, patch: Partial<MapFacet>) =>
    setMapFacets((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const materials: { id: MaterialId; qty: number }[] = [
    { id: 'shingle_bundle', qty: result.bundles },
    { id: 'underlayment_roll', qty: result.underlaymentRolls },
    ...(redeck ? [{ id: 'osb_7_16' as const, qty: result.deckSheets }] : []),
  ];
  const lines = materials.map((m) => {
    const ref = referenceUnitPrice(PRICE_BOOK[m.id]);
    return { ...m, ref, total: ref ? ref.price * m.qty : 0 };
  });
  const materialTotal = lines.reduce((s, l) => s + l.total, 0);
  const selectedShingle = SHINGLE_OPTIONS.find((product) => product.id === shingleId) ?? SHINGLE_OPTIONS[0];
  const packagesPerSquare = selectedShingle.bundlesPerSquare ?? customBundles;
  const parsedRate = (value: string) => value.trim() === '' ? null : Number(value);
  const lookupShingles = async () => {
    setShingleLookupBusy(true);
    try {
      const res=await fetchLivePrices(api, selectedShingle.label,'United States');
      setShingleOffers(res);setShingleOffersAt(new Date().toISOString());
    } finally { setShingleLookupBusy(false); }
  };
  const geometryReady = mode === 'map'
    ? mapFacets.length > 0 && mapResult.facetsMissingPitch === 0 && result.slopedSqFt > 0
    : result.slopedSqFt > 0;
  const shingleQuote = useMemo(() => {
    if (!geometryReady) return null;
    try {
      return computeShingleQuote(result.slopedSqFt, waste, packagesPerSquare,
        parsedRate(bundleRate), parsedRate(laborRate));
    } catch {
      return null;
    }
  }, [geometryReady, result.slopedSqFt, waste, packagesPerSquare, bundleRate, laborRate]);

  const update = (id: string, patch: Partial<FacetInput>) =>
    setFacets((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const maxLen = Math.max(1, ...result.facets.map((f) => f.lengthFt));
  const sel = result.facets.find((f) => f.id === selected) ?? null;
  const selMap = mode === 'map' ? (mapResult.facets.find((f) => f.id === selected) ?? null) : null;

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Roof Measurements // Facet takeoff</div>
          <h1 tabIndex={-1} data-route-heading="">
            Roof Measurements
          </h1>
          <p>
            Trace each roof facet on satellite imagery, or sketch it by plan length and run.
            Or auto-detect the outline from satellite imagery and confirm each plane — manual
            tracing stays available either way.
          </p>
        </div>
        <div className="cc-seg" role="group" aria-label="Measurement method">
          {(['map', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              className={mode === m ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
              onClick={() => {
                setMode(m);
                setSelected(null);
              }}
            >
              {m === 'map' ? 'Map trace' : 'Manual sketch'}
            </button>
          ))}
        </div>
      </header>

      <AccountDraftStatus status={cloudDraft.status} message={cloudDraft.message}
        onImport={cloudDraft.importLegacy} onReload={cloudDraft.reload} />
      <div className="cc-split">
        <div className="cc-stack">
          {mode === 'map' && (
            <>
              <Panel
                title="Roof map // trace facets"
                id="roof-map"
                actions={
                  <button
                    type="button"
                    className="cc-btn cc-btn--sm cc-btn--primary"
                    disabled={!jobLocation || autoStatus === 'busy'}
                    title={
                      jobLocation
                        ? 'Detect candidate roof planes from satellite imagery'
                        : 'Fly to a job address first'
                    }
                    onClick={() => void runAutoDetect()}
                  >
                    {autoStatus === 'busy' ? 'Detecting outline…' : 'Auto-detect outline'}
                  </button>
                }
              >
                <RoofMap
                  facets={mapFacets}
                  results={mapResult.facets}
                  selectedId={selected}
                  onSelect={setSelected}
                  onFacetDrawn={onFacetDrawn}
                  fitSignal={fitSignal}
                  outline={houseOutline}
                  onOutlineDrawn={(ring)=>{setHouseOutline(ring);setOutlineSource('manual');}}
                  onAutoOutline={(ring)=>{setHouseOutline(ring);setOutlineSource('openstreetmap');}}
                  onAddressResolved={(address, location)=>{setJobAddress(address);setJobLocation(location);}}
                  onAutoFacet={(ring)=>{
                    if(mapFacets.length>0)return;
                    const id=newId();
                    setMapFacets([{id,name:'Mapped roof proxy · verify',ring,pitch:null,
                      source:'osm_footprint'}]);
                    setSelected(id);
                  }}
                  autoCandidates={autoCandidates}
                  selectedAutoId={selectedAutoId}
                  onSelectAuto={setSelectedAutoId}
                />
              </Panel>
              {!jobLocation && (
                <p className="web-muted web-small" role="status">
                  Fly to a job address to enable auto-detect.
                </p>
              )}
              {autoMessage && autoCandidates.length === 0 && (
                <p role="status" className="web-muted web-small">{autoMessage}</p>
              )}
              {autoCandidates.length > 0 && (
                <Panel title="Auto-detected outline // candidate — not measured" id="roof-auto-detect">
                  <p className="web-muted web-small">
                    {autoMessage}
                    {autoModel && ` Vision model: ${autoModel}.`}
                    {autoImagerySource && ` Imagery: ${autoImagerySource}; imagery date unknown.`}
                    {' '}Candidate plan areas below are estimates for review only — they are not
                    in the takeoff totals and cannot be priced until you confirm them.
                  </p>
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <thead>
                        <tr>
                          <th scope="col">Facet</th>
                          <th scope="col">Confidence</th>
                          <th scope="col">Pitch (/12)</th>
                          <th scope="col" className="cc-num">
                            Plan ft²
                          </th>
                          <th scope="col">Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {autoCandidates.map((c) => {
                          const r = autoMeasured.facets.find((x) => x.id === c.id);
                          return (
                            <tr
                              key={c.id}
                              aria-selected={c.id === selectedAutoId}
                              className={c.id === selectedAutoId ? 'cc-row--selected' : undefined}
                            >
                              <td>
                                <input
                                  className="cc-input"
                                  aria-label={`${c.label} name`}
                                  value={c.label}
                                  onFocus={() => setSelectedAutoId(c.id)}
                                  onChange={(e) =>
                                    updateAutoCandidate(c.id, { label: e.currentTarget.value })
                                  }
                                />
                              </td>
                              <td>
                                {Math.round(c.confidence * 100)}%
                                {c.lowConfidence && (
                                  <span className="cc-chip cc-chip--amber">
                                    low confidence — verify
                                  </span>
                                )}
                              </td>
                              <td>
                                <input
                                  className="cc-input"
                                  type="number"
                                  min={0}
                                  max={24}
                                  step={0.5}
                                  placeholder="Unknown"
                                  aria-label={`${c.label} pitch`}
                                  value={c.pitch ?? ''}
                                  onFocus={() => setSelectedAutoId(c.id)}
                                  onChange={(e) => {
                                    const v = e.currentTarget.valueAsNumber;
                                    updateAutoCandidate(c.id, {
                                      pitch: Number.isFinite(v)
                                        ? Math.max(0, Math.min(24, v))
                                        : null,
                                    });
                                  }}
                                />
                              </td>
                              <td className="cc-num">{r ? num(r.planSqFt, 0) : '—'}</td>
                              <td>
                                <div className="cc-seg" role="group" aria-label={`${c.label} decision`}>
                                  <button
                                    type="button"
                                    aria-pressed={c.accepted}
                                    className={c.accepted ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
                                    onClick={() => updateAutoCandidate(c.id, { accepted: true })}
                                  >
                                    Accept
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={!c.accepted}
                                    className={!c.accepted ? 'cc-seg__btn cc-seg__btn--on' : 'cc-seg__btn'}
                                    onClick={() => updateAutoCandidate(c.id, { accepted: false })}
                                  >
                                    Reject
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="web-muted web-small">
                    Low-confidence facets start rejected and stay out of every total until you
                    accept them. Accepting a facet means you have checked its outline against the
                    imagery; set the pitch from a gauge or site check before approving.
                  </p>
                  <div className="cc-actions-row">
                    <button
                      type="button"
                      className="cc-btn cc-btn--sm cc-btn--primary"
                      disabled={acceptedCandidates.length === 0 || confirmBusy}
                      onClick={() => void confirmAccepted()}
                    >
                      {confirmBusy
                        ? 'Confirming…'
                        : `Confirm accepted facets (${acceptedCandidates.length})`}
                    </button>
                    <button
                      type="button"
                      className="cc-btn cc-btn--sm"
                      onClick={() => {
                        setAutoCandidates([]);
                        setSelectedAutoId(null);
                        setAutoMessage('Candidates discarded. Nothing was saved.');
                      }}
                    >
                      Discard all candidates
                    </button>
                  </div>
                  {confirmMessage && (
                    <p role="status" className="web-muted web-small">{confirmMessage}</p>
                  )}
                </Panel>
              )}
              {houseOutline.length >= 3 && <div className="cc-callout cc-callout--info">
                <p>Clean {outlineSource==='openstreetmap'?'mapped building':'contractor-traced'} outline
                  saved to your account ({houseOutline.length} corners). The clean view hides satellite
                  tree imagery, not the trees themselves. Outline alone is display-only; estimated
                  roof area requires a facet and verified pitch.</p>
                {outlineSource==='openstreetmap'&&<p className="web-muted web-small">
                  Building geometry © OpenStreetMap contributors (ODbL). Roof edges, eaves, valleys
                  and slopes may differ from the mapped ground footprint.
                </p>}
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => {setHouseOutline([]);setOutlineSource('manual');}}>
                  Remove clean outline
                </button>
              </div>}
              <Panel title="Traced facets" id="map-facets">
                {mapFacets.length === 0 ? (
                  <p className="web-muted">
                    Fly to the job address, press Trace facet, and click each corner of one roof
                    plane. Click the first point again to close it. Repeat for every plane.
                  </p>
                ) : (
                  <div className="cc-table-wrap">
                    <table className="cc-table">
                      <thead>
                        <tr>
                          <th scope="col">Facet</th>
                          <th scope="col">Pitch (/12)</th>
                          <th scope="col" className="cc-num">
                            Plan ft²
                          </th>
                          <th scope="col" className="cc-num">
                            Perimeter ft
                          </th>
                          <th scope="col" className="cc-num">
                            Sloped ft²
                          </th>
                          <th scope="col">
                            <span className="cc-sr-only">Remove</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mapFacets.map((f) => {
                          const r = mapResult.facets.find((x) => x.id === f.id);
                          return (
                            <tr
                              key={f.id}
                              aria-selected={f.id === selected}
                              className={f.id === selected ? 'cc-row--selected' : undefined}
                            >
                              <td>
                                {f.source==='osm_footprint'&&<span className="cc-chip cc-chip--amber">
                                  Map proxy
                                </span>}
                                {f.source==='auto_detect'&&<span className="cc-chip cc-chip--amber">
                                  Auto-detected
                                </span>}
                                <input
                                  className="cc-input"
                                  aria-label="Facet name"
                                  value={f.name}
                                  onFocus={() => setSelected(f.id)}
                                  onChange={(e) => updateMap(f.id, { name: e.currentTarget.value })}
                                />
                              </td>
                              <td>
                                <input
                                  className="cc-input"
                                  type="number"
                                  min={0}
                                  max={24}
                                  step={0.5}
                                  placeholder="Enter"
                                  aria-label={`${f.name} pitch`}
                                  value={f.pitch ?? ''}
                                  onFocus={() => setSelected(f.id)}
                                  onChange={(e) => {
                                    const v = e.currentTarget.valueAsNumber;
                                    updateMap(f.id, {
                                      pitch: Number.isFinite(v)
                                        ? Math.max(0, Math.min(24, v))
                                        : null,
                                    });
                                  }}
                                />
                              </td>
                              <td className="cc-num">{r ? num(r.planSqFt, 0) : '—'}</td>
                              <td className="cc-num">{r ? num(r.perimeterFt, 0) : '—'}</td>
                              <td className="cc-num">
                                {r?.slopedSqFt != null ? (
                                  num(r.slopedSqFt, 0)
                                ) : (
                                  <span className="cc-chip cc-chip--amber">needs pitch</span>
                                )}
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="cc-iconbtn"
                                  aria-label={`Remove ${f.name}`}
                                  onClick={() => {
                                    setMapFacets((fs) => fs.filter((x) => x.id !== f.id));
                                    if (selected === f.id) setSelected(null);
                                  }}
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {mapFacets.some(f=>f.source==='osm_footprint') && (
                  <div className="cc-callout cc-callout--info" role="status">
                    <p><strong>Auto-calculated building footprint:</strong> {num(mapResult.planSqFt,0)} ft²
                      of estimated horizontal plan area. This outline comes from OpenStreetMap,
                      not AI image reconstruction; trees have not been digitally removed.
                      Set measured pitch below to calculate sloped area and materials.
                      Verify overhangs and split complex roofs into actual planes before quoting.</p>
                  </div>
                )}
                {mapFacets.some(f=>f.source==='auto_detect') && (
                  <div className="cc-callout cc-callout--info" role="status">
                    <p><strong>Auto-detected facets:</strong> these planes came from satellite
                      imagery through the AI outline detector and your confirmation. Verify eaves,
                      ridges and pitch on site before approving or quoting — they are not a survey.</p>
                  </div>
                )}
                {mapResult.facetsMissingPitch > 0 && (
                  <div className="cc-callout cc-callout--info" style={{ marginTop: 10 }}>
                    <p>
                      {mapResult.facetsMissingPitch} traced facet
                      {mapResult.facetsMissingPitch === 1 ? '' : 's'} need a pitch before they count
                      toward squares. Imagery shows plan area only; confirm pitch on site or from a
                      pitch gauge photo.
                    </p>
                  </div>
                )}
              </Panel>
              <RoofRecordPanel
                facets={mapFacets}
                addressFromMap={jobAddress}
                waste={waste}
                redeck={redeck}
                onLoad={(loaded) => {
                  setMapFacets(loaded);
                  setSelected(null);
                  setFitSignal((n) => n + 1);
                }}
              />
            </>
          )}
          {mode === 'manual' && (
            <>
              <Panel title="Facet plan view" id="roof-plan">
                <div className="cc-blueprint" style={{ padding: '1rem' }}>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {result.facets.map((f, i) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setSelected(f.id === selected ? null : f.id)}
                        aria-pressed={f.id === selected}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          display: 'grid',
                          gridTemplateColumns: '7rem 1fr',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <span className="cc-mono" style={{ fontSize: '0.75rem', color: '#9fb3c8' }}>
                          {f.name}
                        </span>
                        <span
                          style={{
                            position: 'relative',
                            height: Math.max(26, Math.min(80, f.runFt * 3)),
                            width: `${Math.max(8, (f.lengthFt / maxLen) * 100)}%`,
                            border: `1px solid ${f.id === selected ? '#67e8f9' : i % 2 ? '#a78bfa' : '#22d3ee'}`,
                            borderRadius: 6,
                            background:
                              'repeating-linear-gradient(135deg, rgba(34,211,238,0.12) 0 6px, transparent 6px 12px)',
                            boxShadow:
                              f.id === selected ? '0 0 24px rgba(34,211,238,0.35)' : 'none',
                            transition: 'all 260ms cubic-bezier(0.22,1,0.36,1)',
                          }}
                        >
                          <span
                            className="cc-mono"
                            style={{
                              position: 'absolute',
                              right: 8,
                              top: 4,
                              fontSize: '0.7rem',
                              color: '#e6f1ff',
                            }}
                          >
                            {f.pitch}/12 · {num(f.slopedSqFt, 0)} ft²
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="cc-blueprint__scan" aria-hidden="true" />
                </div>
              </Panel>

              <Panel
                title="Facets"
                id="facets"
                actions={
                  <button
                    type="button"
                    className="cc-btn cc-btn--sm cc-btn--primary"
                    onClick={() =>
                      setFacets((fs) => [
                        ...fs,
                        {
                          id: newId(),
                          name: `Facet ${String.fromCharCode(65 + fs.length)}`,
                          lengthFt: 20,
                          runFt: 12,
                          pitch: 6,
                        },
                      ])
                    }
                  >
                    Add facet
                  </button>
                }
              >
                <div className="cc-table-wrap">
                  <table className="cc-table">
                    <thead>
                      <tr>
                        <th scope="col">Facet</th>
                        <th scope="col">Length (ft)</th>
                        <th scope="col">Run (ft)</th>
                        <th scope="col">Pitch (/12)</th>
                        <th scope="col" className="cc-num">
                          Sloped ft²
                        </th>
                        <th scope="col">
                          <span className="cc-sr-only">Remove</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {facets.map((f) => {
                        const r = result.facets.find((x) => x.id === f.id);
                        return (
                          <tr key={f.id}>
                            <td>
                              <input
                                className="cc-input"
                                aria-label="Facet name"
                                value={f.name}
                                onChange={(e) => update(f.id, { name: e.currentTarget.value })}
                              />
                            </td>
                            {(['lengthFt', 'runFt', 'pitch'] as const).map((k) => (
                              <td key={k}>
                                <input
                                  className="cc-input"
                                  type="number"
                                  min={0}
                                  step={k === 'pitch' ? 0.5 : 0.1}
                                  aria-label={`${f.name} ${k}`}
                                  value={Number.isFinite(f[k]) ? f[k] : ''}
                                  onChange={(e) =>
                                    update(f.id, { [k]: e.currentTarget.valueAsNumber || 0 })
                                  }
                                />
                              </td>
                            ))}
                            <td className="cc-num">{r ? num(r.slopedSqFt, 0) : '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="cc-iconbtn"
                                aria-label={`Remove ${f.name}`}
                                disabled={facets.length === 1}
                                onClick={() => setFacets((fs) => fs.filter((x) => x.id !== f.id))}
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          <Panel title="Shingle options & contractor pricing" id="roof-shingle-options">
            <div className="cc-form-grid">
              <label className="cc-field">
                <span>Roofing shingle product</span>
                <select className="cc-input" value={shingleId}
                  onChange={(event) => {setShingleId(event.currentTarget.value as ShingleId);setShingleOffers(null);}}>
                  {SHINGLE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="cc-field">
                <span>{selectedShingle.purchaseUnit === 'bundle' ? 'Bundles' : 'Purchase units'} per 100 ft²</span>
                <input className="cc-input" type="number" min={0.1} max={1000} step={0.1}
                  aria-label="Purchase units per roofing square" value={packagesPerSquare}
                  disabled={selectedShingle.bundlesPerSquare !== null}
                  onChange={(event) => setCustomBundles(event.currentTarget.valueAsNumber)} />
              </label>
              <label className="cc-field">
                <span>Supplier price per {selectedShingle.purchaseUnit} (USD)</span>
                <input className="cc-input" type="number" min={0} step={0.01}
                  aria-label="Supplier bundle price" placeholder="Enter verified price"
                  value={bundleRate} onChange={(event) => setBundleRate(event.currentTarget.value)} />
              </label>
              <label className="cc-field">
                <span>Contractor labor per roofing square (USD)</span>
                <input className="cc-input" type="number" min={0} step={0.01}
                  aria-label="Roof labor rate" placeholder="Enter your labor rate"
                  value={laborRate} onChange={(event) => setLaborRate(event.currentTarget.value)} />
              </label>
            </div>
            {!geometryReady && <p role="status" className="web-muted web-small">
              Confirm every traced facet pitch before the shingle takeoff can be priced.
              A separate clean house outline does not establish sloped roof area.
            </p>}
            <div className="cc-kpis" style={{ marginTop: 12 }}>
              <Kpi label={`${selectedShingle.purchaseUnit} count`} value={shingleQuote?.bundles ?? '—'} />
              <Kpi label="Shingles" value={shingleQuote?.shingleCost == null ? 'Unpriced' : money(shingleQuote.shingleCost)} />
              <Kpi label="Labor" value={shingleQuote?.laborCost == null ? 'Unpriced' : money(shingleQuote.laborCost)} />
              <Kpi label="Shingles + labor" value={shingleQuote?.total == null ? 'Incomplete' : money(shingleQuote.total)} accent />
            </div>
            <div className="cc-actions" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:12}}>
              <button type="button" className="cc-btn cc-btn--sm" disabled={shingleLookupBusy}
                onClick={()=>void lookupShingles()}>
                {shingleLookupBusy ? 'Checking supplier listings…' : 'Check current shingle listings'}
              </button>
              <SupplierLinks query={selectedShingle.label} />
            </div>
            {shingleOffers && <div className="web-muted web-small" role="status">
              {shingleOffersAt && `Checked ${new Date(shingleOffersAt).toLocaleString()}. `}
              {shingleOffers.message || (shingleOffers.live
                ? `${shingleOffers.offers.length} matching online listings. Validate exact SKU, unit and shipping before using a rate.`
                : 'No live supplier data available.')}
              {shingleOffers.live && shingleOffers.offers.slice(0,5).map(o=><p key={o.title+o.seller}>
                {o.seller} · {money(o.price)} · {o.title}
                {o.link && <> · <a href={o.link} target="_blank" rel="noopener noreferrer">Listing</a></>}
              </p>)}
            </div>}
            {selectedShingle.source && <p className="web-muted web-small">
              <a href={selectedShingle.source} target="_blank" rel="noopener noreferrer">
                Manufacturer or product coverage specification
              </a>. Product availability, package coverage and installation requirements must
              be confirmed for the actual SKU and region.
            </p>}
            <p className="web-muted web-small">
              The directory spans major worldwide roofing material families, not every manufacturer SKU.
              Products without verified coverage require your exact unit count per roofing square.
              Listings may use different pack sizes and are not automatically applied to a quote.
              These are measured-area roof covering and labor estimates only, not a complete roof quote.
              Underlayment, flashing, starter, ridge caps, vents, disposal, deck work, permits,
              tax and other charges are not included in this subtotal. Enter actual local supplier
              rates rather than relying on dated reference listings.
            </p>
          </Panel>

          <RoofQuoteBuilder
            measured={result.facets
              .filter((f) => f.slopedSqFt > 0)
              .map((f) => ({ name: f.name, slopedSqFt: f.slopedSqFt, pitch: f.pitch }))}
            address={jobAddress}
          />

          <Panel title="Materials" id="roof-materials">
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Material</th>
                    <th scope="col" className="cc-num">
                      Qty
                    </th>
                    <th scope="col" className="cc-num">
                      Cheapest ref.
                    </th>
                    <th scope="col" className="cc-num">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>{PRICE_BOOK[l.id].label}</strong>
                        <div style={{ marginTop: 6 }}>
                          <SupplierLinks query={PRICE_BOOK[l.id].searchQuery} />
                        </div>
                      </td>
                      <td className="cc-num">
                        {l.qty} <span className="web-muted">{PRICE_BOOK[l.id].unit}</span>
                      </td>
                      <td className="cc-num">
                        {l.ref ? money(l.ref.price) : '—'}
                        {l.ref && <span className="cc-formula">{l.ref.seller}</span>}
                      </td>
                      <td className="cc-num">{money0(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="web-muted web-small" style={{ marginTop: 8 }}>
              Reference prices are dated retailer listings. Use House Builder for live supplier
              scans.
            </p>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Roof totals">
          <Panel title="Measurement" id="roof-kpis">
            <div className="cc-kpis">
              <Kpi label="Plan area" value={num(mode==='map'?mapResult.planSqFt:result.planSqFt, 0)} unit="ft²" />
              <Kpi label="Sloped area" value={num(result.slopedSqFt, 0)} unit="ft²" accent />
              <Kpi label="Squares" value={num(result.squares, 2)} />
              <Kpi label="+ waste" value={num(result.squaresWithWaste, 2)} unit="sq" />
              <Kpi label="Bundles" value={result.bundles} />
              <Kpi label="Underlay" value={result.underlaymentRolls} unit="rolls" />
            </div>
            <div className="cc-form-grid" style={{ marginTop: 12 }}>
              <NumberField
                label="Waste"
                suffix="%"
                value={waste}
                min={0}
                max={40}
                onChange={setWaste}
              />
              <label className="cc-field">
                <span>Re-deck</span>
                <select
                  className="cc-input"
                  value={redeck ? 'yes' : 'no'}
                  onChange={(e) => setRedeck(e.currentTarget.value === 'yes')}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes, 7/16 OSB</option>
                </select>
              </label>
            </div>
            <dl style={{ margin: '12px 0 0' }}>
              <div className="cc-total cc-total--grand">
                <dt>Materials (ref.)</dt>
                <dd>{money0(materialTotal)}</dd>
              </div>
            </dl>
          </Panel>

          {selMap && selMap.slopedSqFt === null && (
            <Panel title="Selected facet" id="roof-facet-map">
              <div className="cc-kpis">
                <Kpi label={selMap.name} value="pitch?" />
                <Kpi label="Plan" value={num(selMap.planSqFt, 0)} unit="ft²" />
                <Kpi label="Perimeter" value={num(selMap.perimeterFt, 0)} unit="ft" />
              </div>
            </Panel>
          )}
          {sel && (
            <Panel title="Selected facet" id="roof-facet">
              <div className="cc-kpis">
                <Kpi label={sel.name} value={`${sel.pitch}/12`} />
                <Kpi label="Slope factor" value={sel.slopeFactor.toFixed(3)} />
                <Kpi label="Plan" value={num(sel.planSqFt, 0)} unit="ft²" />
                <Kpi label="Sloped" value={num(sel.slopedSqFt, 0)} unit="ft²" accent />
              </div>
            </Panel>
          )}

          <div className="cc-callout cc-callout--info">
            <p>
              {AREA_SUMMARIES.roof} Traced areas are contractor measurements on imagery, not a
              survey. Verify critical dimensions on site.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
