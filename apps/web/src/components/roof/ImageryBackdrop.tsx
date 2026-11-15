'use client';

// Imagery behind the roof sketch (RF-022, RF-024, COS-203, ADD-021..ADD-024). Only imagery whose
// rights decision allows "visualize" is shown. Fixture imagery is synthetic and drawn as a labelled
// grid (no pixels are fetched). A georeferenced asset is shown on MapLibre, aligned to the plan
// frame from its origin; consumer basemaps stay VISUALIZATION ONLY. A contractor blueprint is
// shown from the local file after a two-point scale calibration (ADD-029); without calibration it
// cannot back a measurement.
import { Button, Checkbox, Field, TextInput } from '@fieldline/ui';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { calibrate, type Pt } from './model';
import type { ViewBox } from './RoofCanvas';
import type { RoofEndpoints } from './roofApi';
import styles from './roof.module.css';

export interface Backdrop {
  kind: 'synthetic' | 'map' | 'blueprint';
  origin: [number, number] | null;
  metersPerPixel: number | null;
  attribution: string;
  calibrationNote: string | null;
  imageUrl: string | null;
  /** Blueprint image size in pixels. */
  size?: { w: number; h: number };
}

const M_PER_DEG_LAT = 111_320;

export function ImageryBackdrop({ backdrop, viewBox: vb }: { backdrop: Backdrop | null; viewBox: ViewBox }) {
  if (!backdrop) return null;
  if (backdrop.kind === 'map' && backdrop.origin) return <MapBackdrop origin={backdrop.origin} viewBox={vb} attribution={backdrop.attribution} />;
  const sy = (y: number) => -y;
  const vbAttr = `${vb.minX} ${sy(vb.minY + vb.height)} ${vb.width} ${vb.height}`;
  if (backdrop.kind === 'blueprint' && backdrop.imageUrl && backdrop.metersPerPixel && backdrop.size) {
    const w = backdrop.size.w * backdrop.metersPerPixel;
    const h = backdrop.size.h * backdrop.metersPerPixel;
    return (
      <svg className={styles.backdrop} viewBox={vbAttr} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <image href={backdrop.imageUrl} x={0} y={0} width={w} height={h} opacity={0.55} preserveAspectRatio="none" />
      </svg>
    );
  }
  const step = backdrop.metersPerPixel ? Math.max(1, Math.round(backdrop.metersPerPixel * 40)) : 1;
  return (
    <>
      <svg className={styles.backdrop} viewBox={vbAttr} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="roof-synth" width={step} height={step} patternUnits="userSpaceOnUse">
            <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="#334155" strokeWidth={vb.width / 900} />
          </pattern>
        </defs>
        <rect x={vb.minX} y={sy(vb.minY + vb.height)} width={vb.width} height={vb.height} fill="url(#roof-synth)" />
      </svg>
      <span className={styles.attribution}>Synthetic test imagery: not a real capture. {backdrop.attribution}</span>
    </>
  );
}

function MapBackdrop({ origin, viewBox: vb, attribution }: { origin: [number, number]; viewBox: ViewBox; attribution: string }) {
  const el = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [lon0, lat0] = origin;
  useEffect(() => {
    let map: { remove(): void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!el.current || !('WebGLRenderingContext' in window)) throw new Error('no webgl');
        const maplibre = await import('maplibre-gl');
        if (cancelled || !el.current) return;
        const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
        const sw: [number, number] = [lon0 + vb.minX / mPerDegLon, lat0 + vb.minY / M_PER_DEG_LAT];
        const ne: [number, number] = [lon0 + (vb.minX + vb.width) / mPerDegLon, lat0 + (vb.minY + vb.height) / M_PER_DEG_LAT];
        map = new maplibre.Map({
          container: el.current,
          bounds: [sw, ne],
          interactive: false,
          attributionControl: { compact: false, customAttribution: attribution },
          style: {
            version: 8,
            sources: {
              imagery: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution },
            },
            layers: [{ id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 0.7 } }],
          },
        });
        setState('ready');
      } catch {
        if (!cancelled) setState('unavailable');
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lon0, lat0, vb.minX, vb.minY, vb.width, vb.height, attribution]);
  return (
    <>
      <div ref={el} className={styles.backdrop} aria-hidden="true" />
      <span className={styles.attribution}>{state === 'unavailable' ? 'Map imagery unavailable on this device; the sketch still works.' : `${attribution}. Visualization only; alignment is approximate.`}</span>
    </>
  );
}

/** Blueprint upload with two-point scale calibration (ADD-029). Pointer and typed coordinates both work. */
export function BlueprintCalibration({ propertyId, roof, onBackdrop }: { propertyId: string | null; roof: RoofEndpoints; onBackdrop: (b: Backdrop | null) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pts, setPts] = useState<Pt[]>([]);
  const [manual, setManual] = useState({ x1: '', y1: '', x2: '', y2: '' });
  const [knownFt, setKnownFt] = useState('');
  const [mpp, setMpp] = useState<number | null>(null);
  const [rights, setRights] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const pick = (e: PointerEvent<HTMLImageElement>) => {
    if (!size) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * size.w, y: ((e.clientY - r.top) / r.height) * size.h };
    setPts((cur) => (cur.length >= 2 ? [p] : [...cur, p]));
  };

  const apply = () => {
    try {
      const two = pts.length === 2 ? pts : [{ x: Number(manual.x1), y: Number(manual.y1) }, { x: Number(manual.x2), y: Number(manual.y2) }];
      const m = calibrate(two[0]!, two[1]!, Number(knownFt));
      setMpp(m);
      setErr(null);
      if (url && size) onBackdrop({ kind: 'blueprint', origin: null, metersPerPixel: m, attribution: 'Contractor blueprint', calibrationNote: `Blueprint calibrated: 1 px = ${(m * 100).toFixed(2)} cm`, imageUrl: url, size });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const register = async () => {
    if (!propertyId || !mpp) return;
    setErr(null);
    try {
      await roof.registerContractorImagery({
        propertyId,
        kind: 'blueprint',
        gsdM: mpp,
        georef: { kind: 'scale', metersPerPixel: mpp, calibration: { points: pts, knownLengthFt: Number(knownFt) } },
        attribution: 'Contractor-supplied blueprint',
        rights: { analyze: true, cache: true, embedInExports: true, redistribute: false, expiresAt: null, licenseRef: null },
        rightsStatement: 'I confirm my company holds the rights to use this blueprint for measurement and to include it in reports.',
      });
      setMsg('Blueprint recorded with its scale and your rights statement.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="bp-h">
      <h2 id="bp-h">Blueprint</h2>
      <Field label="Blueprint image" hint="Stays on this device; only the scale and rights statement are recorded.">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUrl(URL.createObjectURL(f));
            setPts([]);
            setMpp(null);
          }}
        />
      </Field>
      {url && (
        <img src={url} alt="Blueprint: click two points a known distance apart" className={styles.blueprint} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onPointerDown={pick} />
      )}
      <p className={styles.muted}>
        {pts.length === 0 ? 'Click two points on the image, or type their pixel coordinates.' : pts.map((p, i) => `Point ${i + 1}: ${Math.round(p.x)}, ${Math.round(p.y)}`).join('; ')}
      </p>
      {pts.length < 2 && (
        <div className={styles.row}>
          {(['x1', 'y1', 'x2', 'y2'] as const).map((k) => (
            <Field key={k} label={`${k.toUpperCase()} (px)`}>
              <TextInput inputMode="decimal" size={6} value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      )}
      <Field label="Real distance between the points (ft)" error={err ?? undefined}>
        <TextInput inputMode="decimal" value={knownFt} onChange={(e) => setKnownFt(e.target.value)} />
      </Field>
      <Button size="sm" variant="secondary" onClick={apply}>
        Calibrate scale
      </Button>
      {mpp && <p data-testid="bp-scale">Scale: 1 px = {(mpp * 100).toFixed(2)} cm</p>}
      {mpp && propertyId && (
        <>
          <Checkbox label="My company holds the rights to measure from this blueprint and include it in reports." checked={rights} onChange={(e) => setRights(e.target.checked)} />
          <Button size="sm" disabled={!rights} onClick={() => void register()}>
            Record blueprint scale
          </Button>
        </>
      )}
      {msg && <p role="status">{msg}</p>}
    </section>
  );
}
