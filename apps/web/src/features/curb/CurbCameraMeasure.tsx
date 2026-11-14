'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  assessMeasurement,
  measureCurbInPhoto,
  REFERENCE_PRESETS,
  type Point2,
} from './cameraMeasureMath';
import { snapToCorner, snapToEdge, toGray, type GrayImage } from './edgeSnap';

type Stage = 'idle' | 'starting' | 'live' | 'photo';
type Step = 'reference' | 'curb';
type Marked = Point2 & { snapped: boolean };
type Drag = {
  kind: 'ref' | 'path';
  index: number;
  pointerId: number;
  /** Where the press started (CSS px) and whether it has moved far enough to count as a drag. */
  startX: number;
  startY: number;
  moving: boolean;
  /** Tap position to add as a new point if the press ends without moving. */
  tap: { point: Point2; snapRadiusPx: number };
};

const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
/** How close (CSS px) a press must be to an existing point to be able to drag it. */
const GRAB_RADIUS_CSS = 22;
/** A press near a point only becomes a drag after moving this far (CSS px); otherwise it is a tap. */
const DRAG_START_CSS = 6;
/** Search radius (CSS px on screen) for snapping a tap to a corner or edge. */
const SNAP_RADIUS_CSS = 22;
const MAX_PHOTO_EDGE = 1920;
const LOUPE_ZOOM = 3;
/** Tap error used for the accuracy range: snapped points are about 1 px, raw taps about 4 px. */
const SNAPPED_ERROR_PX = 1;
const RAW_ERROR_PX = 4;

function cameraErrorText(cause: unknown): string {
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission was denied. Allow camera access in your browser or phone settings, or use Take Photo / Choose Image.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No usable camera was found on this device. Use Take Photo / Choose Image.';
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The camera is busy in another app. Close other camera apps and try again, or use Take Photo / Choose Image.';
  return 'Live camera could not start in this browser. Use Take Photo / Choose Image to open the device camera.';
}

/** Rear camera first; retries with simpler settings for phones that reject the ideal ones. */
export async function openRearCamera(media: MediaDevices): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    },
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ];
  let last: unknown;
  for (const constraints of attempts) {
    try {
      return await media.getUserMedia(constraints);
    } catch (cause) {
      last = cause;
      const name = cause instanceof DOMException || cause instanceof Error ? cause.name : '';
      // Permission and hardware-busy errors will not improve with simpler settings.
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError')
        break;
    }
  }
  throw last;
}

export function CurbCameraMeasure({ onApplyLength }: { onApplyLength: (feet: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const grayRef = useRef<GrayImage | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [photo, setPhoto] = useState('');
  const [photoSize, setPhotoSize] = useState({ widthPx: 0, heightPx: 0 });
  const [step, setStep] = useState<Step>('reference');
  const [corners, setCorners] = useState<Marked[]>([]);
  const [path, setPath] = useState<Marked[]>([]);
  const [preset, setPreset] = useState<string>('letter');
  const [refWidth, setRefWidth] = useState('8.5');
  const [refHeight, setRefHeight] = useState('11');
  const [snapOn, setSnapOn] = useState(true);
  const [selected, setSelected] = useState<{ kind: 'ref' | 'path'; index: number } | null>(null);
  const [loupe, setLoupe] = useState<(Point2 & { widthCss: number }) | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [error, setError] = useState('');

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Phones suspend the camera in the background; release it so it restarts cleanly.
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && streamRef.current) {
        requestRef.current++;
        stopCamera();
        setStage('idle');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', onHidden);
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (stage !== 'live' || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    const played = video.play?.();
    if (played && typeof played.catch === 'function')
      void played.catch(() =>
        setError('Camera playback was blocked. Tap Capture frame, or use Take Photo instead.'),
      );
  }, [stage]);

  const reset = () => {
    setCorners([]);
    setPath([]);
    setStep('reference');
    setSelected(null);
  };

  const widthIn = Number(refWidth);
  const heightIn = Number(refHeight);
  const result = useMemo(() => {
    if (corners.length !== 4 || path.length < 2)
      return { value: null as number | null, segments: [] as number[], quality: null, error: '' };
    try {
      const m = measureCurbInPhoto(corners, widthIn, heightIn, path);
      const quality = photoSize.widthPx
        ? assessMeasurement(corners, widthIn, heightIn, path, photoSize, {
            cornerErrorPx: corners.map((p) => (p.snapped ? SNAPPED_ERROR_PX : RAW_ERROR_PX)),
            pathErrorPx: path.map((p) => (p.snapped ? SNAPPED_ERROR_PX : RAW_ERROR_PX)),
          })
        : null;
      return { value: m.lengthFt, segments: m.segmentsFt, quality, error: '' };
    } catch (cause) {
      return {
        value: null,
        segments: [],
        quality: null,
        error: cause instanceof Error ? cause.message : 'Calibration failed.',
      };
    }
  }, [corners, path, widthIn, heightIn, photoSize]);

  async function startCamera() {
    const request = ++requestRef.current;
    stopCamera();
    reset();
    setPhoto('');
    setError('');
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!media?.getUserMedia) {
      // Insecure page or very old/in-app browser: the system camera picker still works.
      setStage('idle');
      fileRef.current?.click();
      return;
    }
    setStage('starting');
    try {
      const stream = await openRearCamera(media);
      if (!mountedRef.current || requestRef.current !== request) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps =
        typeof track?.getCapabilities === 'function'
          ? (track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean })
          : undefined;
      setTorchSupported(Boolean(caps?.torch));
      setStage('live');
    } catch (cause) {
      if (!mountedRef.current || requestRef.current !== request) return;
      setStage('idle');
      setError(cameraErrorText(cause));
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
      setError('The flashlight could not be turned on for this camera.');
    }
  }

  /** Loads a canvas into the photo state and keeps a grayscale copy for snapping. */
  function loadPhotoCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
    try {
      grayRef.current = toGray(context.getImageData(0, 0, canvas.width, canvas.height));
    } catch {
      grayRef.current = null; // snapping off; manual marking still works
    }
    setPhotoSize({ widthPx: canvas.width, heightPx: canvas.height });
    setPhoto(canvas.toDataURL('image/jpeg', 0.9));
  }

  function photograph() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 10) {
      setError('The camera image is not ready yet. Wait a second and try again.');
      return;
    }
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, MAX_PHOTO_EDGE / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * ratio);
    canvas.height = Math.round(video.videoHeight * ratio);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setError('Camera capture is unavailable in this browser. Use Take Photo / Choose Image.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    loadPhotoCanvas(canvas, ctx);
    requestRef.current++;
    stopCamera();
    reset();
    setStage('photo');
    setError('');
  }

  async function importPhoto(file?: File) {
    if (!file) return;
    if ((file.type && !file.type.startsWith('image/')) || file.size > 25_000_000) {
      setError('Choose a supported image smaller than 25 MB.');
      return;
    }
    try {
      // HTMLImageElement works in iOS WebKit builds without createImageBitmap, and applies the
      // photo's EXIF rotation in current Safari, Chrome and Firefox.
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('Image decode failed'));
          image.src = objectUrl;
        });
        const canvas = document.createElement('canvas');
        const scale = Math.min(
          1,
          MAX_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
        );
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        if (canvas.width < 1 || canvas.height < 1) throw Error('Empty photo');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw Error('Cannot load photo.');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        stopCamera();
        loadPhotoCanvas(canvas, context);
        reset();
        setStage('photo');
        setError('');
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      setError(
        'Could not open this photo. Try JPEG or PNG, or take a new photo with the camera option.',
      );
    }
  }

  /** CSS px → normalized point, and the snap radius converted to image pixels. */
  function pointFromEvent(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const point = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    if (
      ![point.x, point.y].every(Number.isFinite) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > 1 ||
      point.y > 1
    )
      return null;
    const pxPerCss = photoSize.widthPx ? photoSize.widthPx / rect.width : 1;
    return { point, rect, snapRadiusPx: Math.min(60, Math.max(6, SNAP_RADIUS_CSS * pxPerCss)) };
  }

  function refine(kind: 'ref' | 'path', point: Point2, radiusPx: number): Marked {
    const gray = grayRef.current;
    if (!snapOn || !gray) return { ...point, snapped: false };
    const out =
      kind === 'ref' ? snapToCorner(gray, point, radiusPx) : snapToEdge(gray, point, radiusPx);
    return { ...out.point, snapped: out.snapped };
  }

  function findNear(point: Point2, rect: DOMRect) {
    const near = (list: Marked[]) =>
      list.findIndex(
        (p) =>
          Math.hypot((p.x - point.x) * rect.width, (p.y - point.y) * rect.height) <=
          GRAB_RADIUS_CSS,
      );
    const ri = near(corners);
    if (ri >= 0) return { kind: 'ref' as const, index: ri };
    const pi = near(path);
    if (pi >= 0) return { kind: 'path' as const, index: pi };
    return null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const hit = pointFromEvent(e);
    if (!hit) return;
    const grab = findNear(hit.point, hit.rect);
    if (grab) {
      // Points can sit very close together on a phone screen, so a press near a point is only a
      // drag once the finger moves. A press that ends in place is a normal tap.
      dragRef.current = {
        ...grab,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moving: false,
        tap: { point: hit.point, snapRadiusPx: hit.snapRadiusPx },
      };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    addPoint(hit.point, hit.snapRadiusPx);
  }

  function addPoint(point: Point2, snapRadiusPx: number) {
    if (step === 'reference' && corners.length < 4) {
      const marked = refine('ref', point, snapRadiusPx);
      setCorners((list) => [...list, marked]);
      setSelected({ kind: 'ref', index: corners.length });
      if (corners.length === 3) setStep('curb');
    } else if (step === 'curb' && corners.length === 4 && path.length < 100) {
      const marked = refine('path', point, snapRadiusPx);
      setPath((list) => [...list, marked]);
      setSelected({ kind: 'path', index: path.length });
    }
  }

  function moveDragged(point: Point2, snapped: boolean) {
    const drag = dragRef.current;
    if (!drag) return;
    const update = (list: Marked[]) =>
      list.map((p, i) => (i === drag.index ? { ...point, snapped } : p));
    if (drag.kind === 'ref') setCorners(update);
    else setPath(update);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_START_CSS) return;
      drag.moving = true;
      setSelected({ kind: drag.kind, index: drag.index });
    }
    const hit = pointFromEvent(e);
    if (!hit) return;
    moveDragged(hit.point, false);
    setLoupe({ ...hit.point, widthCss: hit.rect.width });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setLoupe(null);
    if (!drag.moving) {
      if (e.type !== 'pointercancel') addPoint(drag.tap.point, drag.tap.snapRadiusPx);
      return;
    }
    const hit = pointFromEvent(e);
    if (hit) {
      const marked = refine(drag.kind, hit.point, hit.snapRadiusPx);
      moveDragged(marked, marked.snapped);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!selected || !photoSize.widthPx) return;
    const stepPx = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-stepPx, 0],
      ArrowRight: [stepPx, 0],
      ArrowUp: [0, -stepPx],
      ArrowDown: [0, stepPx],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const move = (list: Marked[]) =>
      list.map((p, i) =>
        i === selected.index
          ? {
              x: Math.min(1, Math.max(0, p.x + d[0] / photoSize.widthPx)),
              y: Math.min(1, Math.max(0, p.y + d[1] / photoSize.heightPx)),
              snapped: false,
            }
          : p,
      );
    if (selected.kind === 'ref') setCorners(move);
    else setPath(move);
  }

  function undo() {
    setSelected(null);
    if (step === 'curb' && path.length) setPath((list) => list.slice(0, -1));
    else if (step === 'curb') setStep('reference');
    else setCorners((list) => list.slice(0, -1));
  }

  function choosePreset(id: string) {
    setPreset(id);
    const p = REFERENCE_PRESETS.find((r) => r.id === id);
    if (p) {
      setRefWidth(String(p.widthIn));
      setRefHeight(String(p.heightIn));
    }
  }

  function swapDims() {
    setRefWidth(refHeight);
    setRefHeight(refWidth);
    setPreset('custom');
  }

  const coords = (list: Point2[]) => list.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ');
  const prompt =
    step === 'reference'
      ? (CORNER_LABELS[corners.length] ?? 'reference complete')
      : path.length
        ? 'next curb point or bend'
        : 'first curb endpoint';
  const snappedCount = [...corners, ...path].filter((p) => p.snapped).length;
  const isSel = (kind: 'ref' | 'path', i: number) =>
    selected?.kind === kind && selected.index === i;

  return (
    <section className="cc-camera-measure" aria-label="Camera curb measurement">
      <p className="web-muted web-small">
        Use the camera for a <strong>calibrated photo measurement</strong>. Lay a rigid rectangle of
        known size flat on the ground next to the curb. Take a photo, tap its four corners, then
        trace the curb line. Taps snap to the nearest detected corner or edge. Drag any point to
        fine-tune it with the magnifier. This corrects photo perspective. It is not LiDAR or a field
        survey.
      </p>
      <div className="cc-camera-toolbar">
        <button
          className="cc-btn cc-btn--primary"
          type="button"
          disabled={stage === 'starting'}
          onClick={() => void startCamera()}
        >
          {stage === 'starting' ? 'Opening camera…' : 'Open camera'}
        </button>
        <button type="button" className="cc-btn" onClick={() => fileRef.current?.click()}>
          Take Photo / Choose Image
        </button>
        <input
          ref={fileRef}
          className="cc-camera-file"
          type="file"
          accept="image/*"
          capture="environment"
          aria-label="Take or choose a curb photo"
          onChange={(e) => {
            void importPhoto(e.currentTarget.files?.[0]);
            e.currentTarget.value = '';
          }}
        />
        {stage === 'live' && (
          <>
            <button type="button" className="cc-btn cc-btn--primary" onClick={photograph}>
              Capture frame
            </button>
            {torchSupported && (
              <button
                type="button"
                className="cc-btn"
                aria-pressed={torchOn}
                onClick={() => void toggleTorch()}
              >
                {torchOn ? 'Flashlight off' : 'Flashlight on'}
              </button>
            )}
            <button
              type="button"
              className="cc-btn"
              onClick={() => {
                requestRef.current++;
                stopCamera();
                setStage('idle');
              }}
            >
              Close
            </button>
          </>
        )}
      </div>
      {stage === 'live' && (
        <div className="cc-camera-viewport">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="cc-camera-video"
            aria-label="Live rear camera preview"
          />
          <span className="cc-camera-reticle" aria-hidden="true">
            +
          </span>
        </div>
      )}
      {stage === 'photo' && (
        <div className="cc-camera-capture">
          <div className="cc-form-grid">
            <label className="cc-field">
              <span>Reference object</span>
              <select
                className="cc-input"
                value={preset}
                onChange={(e) => choosePreset(e.currentTarget.value)}
              >
                {REFERENCE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom size</option>
              </select>
            </label>
            <label className="cc-field">
              <span>Reference width (inches)</span>
              <input
                className="cc-input"
                type="number"
                inputMode="decimal"
                min=".1"
                max="240"
                step=".01"
                value={refWidth}
                onChange={(e) => {
                  setRefWidth(e.currentTarget.value);
                  setPreset('custom');
                }}
              />
            </label>
            <label className="cc-field">
              <span>Reference height (inches)</span>
              <input
                className="cc-input"
                type="number"
                inputMode="decimal"
                min=".1"
                max="240"
                step=".01"
                value={refHeight}
                onChange={(e) => {
                  setRefHeight(e.currentTarget.value);
                  setPreset('custom');
                }}
              />
            </label>
          </div>
          <div className="cc-camera-toolbar">
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              aria-pressed={step === 'reference'}
              onClick={() => setStep('reference')}
            >
              1. Reference ({corners.length}/4)
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              disabled={corners.length < 4}
              aria-pressed={step === 'curb'}
              onClick={() => setStep('curb')}
            >
              2. Curb path ({path.length} points)
            </button>
            <button type="button" className="cc-btn cc-btn--sm" onClick={undo}>
              Undo
            </button>
            <button type="button" className="cc-btn cc-btn--sm" onClick={reset}>
              Reset
            </button>
            <button type="button" className="cc-btn cc-btn--sm" onClick={swapDims}>
              Swap width/height
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              aria-pressed={snapOn}
              onClick={() => setSnapOn((v) => !v)}
            >
              Auto-snap {snapOn ? 'on' : 'off'}
            </button>
          </div>
          <p className="web-muted web-small" role="status">
            Tap <strong>{prompt}</strong> on the image. Mark the reference corners in order around
            the sheet: top-left, top-right, bottom-right, bottom-left. The first side you mark is
            the width. Drag a point to move it. With a point selected, arrow keys move it 1 pixel
            (Shift: 10).
          </p>
          <div
            ref={surfaceRef}
            className="cc-camera-photo"
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
            role="application"
            aria-label="Photo. Tap to place reference corners and curb points."
            data-testid="camera-photo"
          >
            <img src={photo} alt="Curb photo with measurement overlays" draggable={false} />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              {corners.length > 1 && (
                <polyline
                  points={coords(corners)}
                  fill="none"
                  stroke="#facc15"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {corners.length === 4 && (
                <line
                  x1={corners[3]!.x * 1000}
                  y1={corners[3]!.y * 1000}
                  x2={corners[0]!.x * 1000}
                  y2={corners[0]!.y * 1000}
                  stroke="#facc15"
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {path.length > 1 && (
                <polyline
                  points={coords(path)}
                  fill="none"
                  stroke="#36e7f4"
                  strokeWidth="4"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {corners.map((p, i) => (
                <circle
                  key={'ref' + i}
                  cx={p.x * 1000}
                  cy={p.y * 1000}
                  r={isSel('ref', i) ? 14 : 10}
                  fill={p.snapped ? '#facc15' : '#fde68a'}
                  stroke={isSel('ref', i) ? '#ffffff' : '#071221'}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {path.map((p, i) => (
                <circle
                  key={'path' + i}
                  cx={p.x * 1000}
                  cy={p.y * 1000}
                  r={isSel('path', i) ? 14 : 10}
                  fill={p.snapped ? '#36e7f4' : '#a5f3fc'}
                  stroke={isSel('path', i) ? '#ffffff' : '#071221'}
                  strokeWidth="3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {loupe && (
              <div
                className="cc-camera-loupe"
                aria-hidden="true"
                style={{
                  left: `${loupe.x * 100}%`,
                  top: `${loupe.y * 100}%`,
                  backgroundImage: `url(${photo})`,
                  // 3× magnification of the photo as displayed, centred on the point.
                  backgroundSize: `${loupe.widthCss * LOUPE_ZOOM}px auto`,
                  backgroundPosition: `${60 - loupe.x * loupe.widthCss * LOUPE_ZOOM}px ${
                    60 -
                    loupe.y *
                      (loupe.widthCss *
                        LOUPE_ZOOM *
                        (photoSize.heightPx / (photoSize.widthPx || 1)))
                  }px`,
                }}
              />
            )}
          </div>
          <p className="web-muted web-small" aria-live="polite">
            {snappedCount} of {corners.length + path.length} points snapped to detected corners or
            edges.
          </p>
          {result.error && (
            <p role="alert" className="web-denied-reason">
              {result.error}
            </p>
          )}
          {result.value !== null && (
            <div className="cc-camera-result" data-testid="camera-result">
              <strong>{result.value.toFixed(2)} ft</strong>
              {result.quality && (
                <p data-testid="camera-accuracy">
                  Likely range {result.quality.lowFt.toFixed(2)}–{result.quality.highFt.toFixed(2)}{' '}
                  ft (about ±{result.quality.plusMinusFt.toFixed(2)} ft).
                </p>
              )}
              {result.segments.length > 1 && (
                <p>Segments: {result.segments.map((s) => s.toFixed(2) + ' ft').join(' + ')}</p>
              )}
              {result.quality?.warnings.map((w) => (
                <p key={w} role="note" className="web-denied-reason">
                  {w}
                </p>
              ))}
              <p>
                Approximate curb length from this calibrated photo. Points far from the reference
                are less accurate. Verify on site before quoting.
              </p>
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                onClick={() => onApplyLength(Number(result.value!.toFixed(2)))}
              >
                Use length in curb estimate
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="web-denied-reason">
          {error}
        </p>
      )}
      <p className="web-muted web-small">
        Photos stay in your browser and are not uploaded. The camera cannot see buried concrete
        depth, reinforcement or utilities. Native iPhone ARKit/LiDAR measurement needs the separate
        Field Pro iPhone app.
      </p>
    </section>
  );
}
