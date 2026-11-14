'use client';
import { useEffect, useRef, useState } from 'react';
import { metresToFeet, pathLengthFeet, type WorldPoint } from './arMeasureMath';

/** Local WebXR interfaces because hit-test and DOM overlay are not in TypeScript's baseline DOM lib. */
type Pose = { transform: { position: { x: number; y: number; z: number } } };
type XRSpaceLike = object;
type HitResultLike = { getPose: (space: XRSpaceLike) => Pose | null };
type HitSourceLike = { cancel: () => void };
type XRFrameLike = { getHitTestResults: (source: HitSourceLike) => HitResultLike[] };
type SessionLike = {
  requestReferenceSpace: (type: 'viewer' | 'local') => Promise<XRSpaceLike>;
  requestHitTestSource: (options: { space: XRSpaceLike }) => Promise<HitSourceLike>;
  updateRenderState: (options: { baseLayer: unknown }) => void;
  requestAnimationFrame: (callback: (time: number, frame: XRFrameLike) => void) => void;
  addEventListener: (type: 'end', listener: () => void) => void;
  removeEventListener: (type: 'end', listener: () => void) => void;
  end: () => Promise<void>;
};
type WebXRSystemLike = {
  isSessionSupported: (type: 'immersive-ar') => Promise<boolean>;
  requestSession: (
    type: 'immersive-ar',
    options: {
      requiredFeatures: string[];
      domOverlay: { root: Element };
    },
  ) => Promise<SessionLike>;
};
type XRWebGLLayerLike = { framebuffer: WebGLFramebuffer | null };
type XRWebGLLayerConstructor = new (
  session: SessionLike,
  gl: WebGLRenderingContext,
) => XRWebGLLayerLike;
type XRWebGLContext = WebGLRenderingContext & { makeXRCompatible: () => Promise<void> };
type XRWindow = Window & { XRWebGLLayer?: XRWebGLLayerConstructor };
type XRNavigator = Navigator & { xr?: WebXRSystemLike };

/**
 * Runs only if real immersive WebXR hit-testing + DOM overlay are available.
 * This is spatial hit-testing supplied by the device's AR runtime, not a self-made LiDAR sensor.
 */
export function CurbWebXRMeasure({ onApplyLength }: { onApplyLength: (feet: number) => void }) {
  const [capability, setCapability] = useState<'checking' | 'supported' | 'unsupported'>(
    'checking',
  );
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Scan the curb surface to find a stable AR point.');
  const [points, setPoints] = useState<WorldPoint[]>([]);
  const [error, setError] = useState('');
  /** Live distance from the last marked point to the point under the reticle, in feet. */
  const [liveFt, setLiveFt] = useState<number | null>(null);
  const pointsRef = useRef<WorldPoint[]>([]);
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);
  const liveAt = useRef(0);
  const overlay = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<SessionLike | null>(null);
  const sourceRef = useRef<HitSourceLike | null>(null);
  const latestRef = useRef<WorldPoint | null>(null);
  const rafActive = useRef(false);
  const glCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const xr = (navigator as XRNavigator).xr;
    if (!xr) {
      queueMicrotask(() => {
        if (!cancelled) setCapability('unsupported');
      });
      return () => {
        cancelled = true;
      };
    }
    void xr
      .isSessionSupported('immersive-ar')
      .then((supported) => {
        if (!cancelled) setCapability(supported ? 'supported' : 'unsupported');
      })
      .catch(() => {
        if (!cancelled) setCapability('unsupported');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(
    () => () => {
      rafActive.current = false;
      sourceRef.current?.cancel();
      if (sessionRef.current) void sessionRef.current.end().catch(() => {});
      glCanvas.current = null;
    },
    [],
  );

  function onEnded() {
    rafActive.current = false;
    sourceRef.current?.cancel();
    sourceRef.current = null;
    sessionRef.current = null;
    latestRef.current = null;
    setActive(false);
    setLiveFt(null);
    setStatus('AR session closed. You can review or reuse your recorded length.');
  }
  async function start() {
    const xr = (navigator as XRNavigator).xr;
    if (!xr || !overlay.current) return;
    setError('');
    try {
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['local', 'hit-test', 'dom-overlay'],
        domOverlay: { root: overlay.current },
      });
      sessionRef.current = session;
      session.addEventListener('end', onEnded);
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', {
        alpha: true,
        antialias: false,
      }) as XRWebGLContext | null;
      if (!gl || typeof gl.makeXRCompatible !== 'function')
        throw new Error('XR-compatible WebGL is unavailable.');
      await gl.makeXRCompatible();
      const Layer = (window as XRWindow).XRWebGLLayer;
      if (!Layer) throw new Error('WebXR render layer is unavailable on this browser.');
      const layer = new Layer(session, gl);
      session.updateRenderState({ baseLayer: layer });
      glCanvas.current = canvas;
      const [local, viewer] = await Promise.all([
        session.requestReferenceSpace('local'),
        session.requestReferenceSpace('viewer'),
      ]);
      const hitSource = await session.requestHitTestSource({ space: viewer });
      sourceRef.current = hitSource;
      setPoints([]);
      setActive(true);
      rafActive.current = true;
      setStatus('Move slowly until a surface is detected. Tap Mark curb point at each bend.');
      const frameLoop = (_time: number, frame: XRFrameLike) => {
        if (!rafActive.current || sessionRef.current !== session) return;
        // Transparent XR framebuffer reveals the real camera passthrough in immersive AR.
        gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const result = frame.getHitTestResults(hitSource)[0];
        const position = result?.getPose(local)?.transform.position;
        latestRef.current =
          position && [position.x, position.y, position.z].every(Number.isFinite)
            ? { x: position.x, y: position.y, z: position.z }
            : null;
        // Live segment readout, throttled to about 7 updates a second.
        if (_time - liveAt.current > 150) {
          liveAt.current = _time;
          const last = pointsRef.current.at(-1),
            now = latestRef.current;
          setLiveFt(
            last && now
              ? metresToFeet(Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z))
              : null,
          );
        }
        session.requestAnimationFrame(frameLoop);
      };
      session.requestAnimationFrame(frameLoop);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AR session not available.');
      const current = sessionRef.current;
      if (current) void current.end().catch(() => {});
      onEnded();
    }
  }
  function mark() {
    const point = latestRef.current;
    if (!point) {
      setStatus('No tracked surface point yet. Aim at a well-lit curb surface and move slowly.');
      return;
    }
    if (points.length >= 200) {
      setStatus('Point limit reached. Finish this measurement before continuing.');
      return;
    }
    setPoints((current) => [...current, point]);
    setStatus('Point recorded. Move toward the next curb corner or endpoint.');
  }
  function undo() {
    setPoints((current) => current.slice(0, -1));
  }
  const feet = (() => {
    try {
      return pathLengthFeet(points);
    } catch {
      return 0;
    }
  })();
  return (
    <div ref={overlay} className={active ? 'cc-ar-overlay cc-ar-overlay--active' : 'cc-ar-overlay'}>
      <div className="cc-camera-toolbar">
        <button
          className="cc-btn cc-btn--primary"
          type="button"
          disabled={capability !== 'supported' || active}
          onClick={() => void start()}
        >
          {capability === 'checking' ? 'Checking real AR support…' : 'Start supported AR scan'}
        </button>
        {active && (
          <>
            <button className="cc-btn cc-btn--primary" type="button" onClick={mark}>
              Mark curb point
            </button>
            <button className="cc-btn" type="button" disabled={points.length === 0} onClick={undo}>
              Undo
            </button>
            <button className="cc-btn" type="button" onClick={() => void sessionRef.current?.end()}>
              Finish scan
            </button>
          </>
        )}
        {feet > 0 && (
          <button
            className="cc-btn cc-btn--primary"
            type="button"
            onClick={() => onApplyLength(Number(feet.toFixed(2)))}
          >
            Use tracked length: {feet.toFixed(2)} ft
          </button>
        )}
      </div>
      <p className="web-muted web-small" role="status">
        {capability === 'unsupported'
          ? 'WebXR surface hit testing is unsupported in this browser/device. Use calibrated photo measurement below.'
          : status}
      </p>
      {active && (
        <div className="cc-ar-center" aria-hidden="true">
          ⊕
        </div>
      )}
      {active && (
        <p className="cc-ar-live" aria-live="off">
          {liveFt === null
            ? points.length
              ? 'Aim at the curb surface…'
              : 'Mark the first point.'
            : `Next segment: ${liveFt.toFixed(2)} ft · total if marked: ${(feet + liveFt).toFixed(2)} ft`}
        </p>
      )}
      {error && (
        <p className="web-denied-reason" role="alert">
          {error}
        </p>
      )}
      <p className="web-muted web-small">
        {points.length} tracked point(s) · {feet.toFixed(2)} ft · WebXR tracks real-world hit-test
        positions, where the browser and device support them. This is an approximate surface
        measurement, not buried depth verification or a guaranteed LiDAR reading. Confirm before
        cutting.
      </p>
    </div>
  );
}
