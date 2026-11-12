'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  SAMPLE_BUILDING,
  modelWarnings,
  pipeLength,
  projectPoint,
  roomCorners,
  validateBuildingModel,
  type BuildingModel,
  type Point3,
} from './plumbingModel';

const COLORS: Record<string, string> = {
  cold_water: '#48d5fc',
  hot_water: '#fb7867',
  drain: '#f5d365',
  vent: '#b69cff',
  gas: '#f4a252',
  other: '#a8e0b3',
};

export function PlumbingModelViewer() {
  const [model, setModel] = useState<BuildingModel>(SAMPLE_BUILDING);
  const [isSample, setIsSample] = useState(true);
  const [reference, setReference] = useState<{ name: string; url: string } | null>(null);
  const [azimuth, setAzimuth] = useState(37);
  const [elevation, setElevation] = useState(38);
  const [zoom, setZoom] = useState(1);
  const [showWalls, setShowWalls] = useState(true);
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);
  const [systems, setSystems] = useState<string[]>(Object.keys(COLORS));

  useEffect(() => {
    return () => { if (reference) URL.revokeObjectURL(reference.url); };
  }, [reference]);

  const importModel = async (file?: File) => {
    if (!file) return;
    setMessage('');
    if (file.size > 8 * 1024 * 1024) {
      setMessage('The model or plan must be no larger than 8 MB.');
      return;
    }
    setWorking(true);
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        const parsed = validateBuildingModel(JSON.parse(await file.text()) as unknown);
        setModel(parsed);
        setIsSample(false);
        setMessage('Validated 3D coordinates imported; no geometry was inferred from an image.');
      } else if (file.type.startsWith('image/') && /\.(png|jpe?g|webp)$/.test(name)) {
        setReference({ name: file.name, url: URL.createObjectURL(file) });
        setMessage('Plan loaded for visual reference. Its dimensions have not been extracted or calibrated.');
      } else {
        setMessage('Import a Field Pro model JSON for 3D, or a PNG/JPEG/WebP reference. PDF, DWG and IFC conversion is not yet available.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The model could not be imported.');
    } finally {
      setWorking(false);
    }
  };

  const preview = useMemo(() => {
    const vertices = [
      ...model.rooms.flatMap(roomCorners),
      ...model.pipes.flatMap((p) => p.points),
    ].map((p) => projectPoint(p, azimuth, elevation));
    const minX = Math.min(...vertices.map((p) => p.x), -0.1);
    const maxX = Math.max(...vertices.map((p) => p.x), 0.1);
    const minY = Math.min(...vertices.map((p) => p.y), -0.1);
    const maxY = Math.max(...vertices.map((p) => p.y), 0.1);
    const scale = Math.min(900 / Math.max(maxX - minX, 0.5), 500 / Math.max(maxY - minY, 0.5)) * 0.83 * zoom;
    const origin = { x: 500 - (minX + maxX) * scale / 2, y: 300 - (minY + maxY) * scale / 2 };
    const xy = (p: Point3): [number, number] => {
      const v = projectPoint(p, azimuth, elevation);
      return [origin.x + v.x * scale, origin.y + v.y * scale];
    };
    const polygon = (points: Point3[]) => points.map((p) => xy(p).join(',')).join(' ');
    return { xy, polygon };
  }, [model, azimuth, elevation, zoom]);

  const warnings = useMemo(() => modelWarnings(model), [model]);
  const totalLength = model.pipes.reduce((total, pipe) => total + pipeLength(pipe), 0);

  const downloadSample = () => {
    const blob = new Blob([JSON.stringify(SAMPLE_BUILDING, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'fieldpro-plumbing-model-example.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section className="web-card plumbing-3d" aria-labelledby="plumbing-3d-heading">
      <header className="plumbing-3d__header">
        <div>
          <p className="plumbing-3d__eyebrow">Plumbing Pro // Spatial workspace</p>
          <h2 id="plumbing-3d-heading">3D building & pipe viewer</h2>
          <p className="web-muted">
            View explicit room and pipe geometry in metres. Rotate, filter, inspect route lengths and
            review points outside supplied room boundaries.
          </p>
        </div>
        <span className="plumbing-3d__tag">{isSample ? 'SAMPLE MODEL' : 'IMPORTED 3D GEOMETRY'}</span>
      </header>
      <div className="plumbing-3d__layout">
        <div className="plumbing-3d__viewport">
          <svg viewBox="0 0 1000 600" role="img" aria-label="Orthographic 3D schematic showing supplied rooms and plumbing pipes" className="plumbing-3d__svg">
            <defs><pattern id="plumbing-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="#31475c" strokeWidth=".6" />
            </pattern></defs>
            <rect width="1000" height="600" fill="#06111e" />
            <rect width="1000" height="600" fill="url(#plumbing-grid)" opacity=".45" />
            {model.rooms.map((room) => {
              const corners = roomCorners(room);
              const centre = preview.xy({ x: room.x + room.width / 2, y: room.y + room.depth / 2, z: 0 });
              return <g key={room.id}>
                <polygon points={preview.polygon(corners.slice(0, 4))} fill="#1c5364" fillOpacity=".42" stroke="#7dc2cf" strokeWidth="1.3" />
                {showWalls && [0, 1, 2, 3].map((index) => <polygon key={index}
                  points={preview.polygon([corners[index]!, corners[(index + 1) % 4]!, corners[(index + 1) % 4 + 4]!, corners[index + 4]!])}
                  fill="#2f7494" fillOpacity=".12" stroke="#7294b0" strokeWidth="1.4" strokeOpacity=".65" />)}
                <text x={centre[0]} y={centre[1]} fill="#d7f4fd" fontSize="16" textAnchor="middle"
                  paintOrder="stroke" stroke="#07111e" strokeWidth="4">{room.name}</text>
              </g>;
            })}
            {model.pipes.filter((pipe) => systems.includes(pipe.system)).map((pipe) => (
              <g key={pipe.id}>
                <polyline points={preview.polygon(pipe.points)} stroke={COLORS[pipe.system] ?? COLORS.other}
                  strokeWidth={Math.max(4, Math.min(12, pipe.diameterMm / 40 * zoom + 3))}
                  fill="none" strokeLinecap="round" strokeLinejoin="round" />
                {pipe.points.map((point, index) => {
                  const position = preview.xy(point);
                  return <circle key={index} cx={position[0]} cy={position[1]}
                    r={Math.max(3, 4.5 * zoom)} fill={COLORS[pipe.system] ?? COLORS.other}
                    stroke="#052033" strokeWidth="1.5" />;
                })}
              </g>
            ))}
            <text x="25" y="38" fontSize="17" fill="#a8c7db">ORTHOGRAPHIC · METRES · NOT ENGINEERED</text>
          </svg>
          <div className="plumbing-3d__stats">
            <span>{model.rooms.length} rooms</span><span>{model.pipes.length} runs</span>
            <span>{totalLength.toFixed(2)} m supplied route length</span>
          </div>
          <div className="plumbing-3d__legend">
            {Object.entries(COLORS).map(([system, color]) => <label key={system}>
              <input type="checkbox" checked={systems.includes(system)}
                onChange={(event) => setSystems((current) =>
                  event.target.checked ? [...current, system] : current.filter((item) => item !== system))} />
              <span style={{ backgroundColor: color }} aria-hidden="true" />
              {system.replaceAll('_', ' ')}
            </label>)}
          </div>
        </div>
        <div className="plumbing-3d__controls">
          <h3>View controls</h3>
          <label>Rotate · {azimuth}°
            <input type="range" min="0" max="360" value={azimuth}
              onChange={(event) => setAzimuth(Number(event.target.value))} />
          </label>
          <label>Elevation · {elevation}°
            <input type="range" min="5" max="85" value={elevation}
              onChange={(event) => setElevation(Number(event.target.value))} />
          </label>
          <label>Zoom · {zoom.toFixed(1)}×
            <input type="range" min="0.5" max="2" step="0.1" value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <label className="plumbing-3d__checkbox"><input type="checkbox" checked={showWalls}
            onChange={(event) => setShowWalls(event.target.checked)} /> Show room walls</label>
          <div className="plumbing-3d__actions">
            <button type="button" onClick={() => { setModel(SAMPLE_BUILDING); setIsSample(true); }}>Reset sample</button>
            <button type="button" onClick={downloadSample}>Download JSON template</button>
          </div>
          <h3>Import plans or 3D geometry</h3>
          <label className="plumbing-3d__file">
            <span>3D model JSON or reference image (8 MB max)</span>
            <input type="file" accept=".json,.png,.jpg,.jpeg,.webp,application/json,image/png,image/jpeg,image/webp"
              disabled={working} onChange={(event) => void importModel(event.target.files?.[0])} />
          </label>
          {reference && <figure className="plumbing-3d__reference">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={reference.url} alt={'Uncalibrated plan reference: ' + reference.name} />
            <figcaption>{reference.name} · uncalibrated plan reference</figcaption>
            <button type="button" onClick={() => setReference(null)}>Remove reference</button>
          </figure>}
          {message && <p className="plumbing-3d__message" role="status">{message}</p>}
        </div>
      </div>
      <div className="plumbing-3d__schedule">
        <h3>Route takeoff from imported geometry</h3>
        <div className="web-table-scroll"><table className="plumbing-table">
          <thead><tr><th scope="col">Route</th><th scope="col">System</th>
            <th scope="col">Diameter</th><th scope="col">Length</th></tr></thead>
          <tbody>{model.pipes.map((pipe) => <tr key={pipe.id}>
            <td>{pipe.name}</td><td>{pipe.system.replaceAll('_', ' ')}</td>
            <td>{pipe.diameterMm} mm</td><td>{pipeLength(pipe).toFixed(2)} m</td>
          </tr>)}</tbody>
        </table></div>
        {warnings.length > 0 ? <ul className="plumbing-3d__warnings">
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul> : <p className="web-muted web-small">
          All supplied vertices are inside room envelopes; this does not establish code compliance or collision clearance.
        </p>}
      </div>
      <p className="plumbing-3d__disclaimer">
        The viewer cannot reconstruct a 3D building from a PDF, DWG, IFC, blueprint or photo.
        An image is only a reference. All coordinates must come from a validated design source.
        It does not certify pipe sizing, drainage slope, clearance, material compatibility, or permits.
        Professional design review is required before construction.
      </p>
    </section>
  );
}
