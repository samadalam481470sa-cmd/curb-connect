'use client';
import { useEffect, useRef, useState } from 'react';
import { CurbWebXRMeasure } from './CurbWebXRMeasure';

type NativeMeasurement = {
  feet: number;
  method?: string;
  verified?: boolean;
  lidarPoints?: number;
  raycastPoints?: number;
};
type NativeWindow = Window & {
  FieldProNativeAR?: { available: boolean; open: () => void };
};
const nativeEnabled = process.env.NEXT_PUBLIC_FIELDPRO_NATIVE_AR !== 'false';
const webXrEnabled = process.env.NEXT_PUBLIC_FIELDPRO_WEBXR !== 'false';

/** Native ARKit is only exposed inside the Field Pro iPhone wrapper, not Safari. */
export function CurbARMeasure({ onApplyLength }: { onApplyLength: (feet: number) => void }) {
  const [isIPhone, setIsIPhone] = useState<boolean | null>(null);
  const [hasBridge, setHasBridge] = useState(false);
  const [message, setMessage] = useState('');
  // Keep the latest callback without re-subscribing the native bridge listener every render.
  const applyRef = useRef(onApplyLength);
  useEffect(() => {
    applyRef.current = onApplyLength;
  }, [onApplyLength]);
  useEffect(() => {
    const iphone = /\biPhone\b/i.test(navigator.userAgent);
    const bridge = (window as NativeWindow).FieldProNativeAR;
    const id = window.setTimeout(() => {
      setIsIPhone(iphone);
      setHasBridge(Boolean(bridge?.available && typeof bridge.open === 'function'));
    }, 0);
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<NativeMeasurement>).detail;
      if (!detail || !Number.isFinite(detail.feet) || detail.feet <= 0 || detail.feet > 1000) {
        setMessage('ARKit did not return a usable measured path. Try another scan.');
        return;
      }
      const source =
        detail.method === 'arkit_lidar_depth'
          ? 'Apple LiDAR depth and surface tracking'
          : 'ARKit surface raycasts';
      setMessage(
        source +
          ' measured ' +
          detail.feet.toFixed(2) +
          ' ft (' +
          (detail.lidarPoints ?? 0) +
          ' depth, ' +
          (detail.raycastPoints ?? 0) +
          ' raycast points). Applied to the estimate; tape-verify before cutting.',
      );
      applyRef.current(Number(detail.feet.toFixed(2)));
    };
    window.addEventListener('fieldpro:ar-result', handle);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('fieldpro:ar-result', handle);
    };
  }, []);
  const openNative = () => {
    const bridge = (window as NativeWindow).FieldProNativeAR;
    if (!bridge?.available) return;
    try {
      bridge.open();
      setMessage('Opening Field Pro ARKit measurement…');
    } catch {
      setMessage('Unable to start the native AR camera. Use calibrated photo measurement instead.');
    }
  };
  return (
    <div className="cc-ar-measure">
      {isIPhone === null && <p role="status">Checking available measurement hardware…</p>}
      {isIPhone === true && nativeEnabled && (
        <>
          <p className="web-muted web-small">
            <strong>iPhone native AR Measure:</strong> place tracked curb points using Apple ARKit.
            Supported LiDAR-equipped iPhones measure sampled scene depth with confidence checks;
            other ARKit iPhones use camera-based world tracking and plane detection. This requires
            the separately installed Field Pro native iPhone app—not Safari or a Home Screen web
            shortcut.
          </p>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={!hasBridge}
            onClick={openNative}
          >
            {hasBridge ? 'Start iPhone ARKit measure' : 'Native iPhone app required'}
          </button>
          {!hasBridge && (
            <p className="web-muted web-small" role="status">
              Native ARKit is unavailable in this browser. Use Camera Measure below. The iOS app
              source is in the repository; an Xcode build and installation are required before this
              button can become active.
            </p>
          )}
        </>
      )}
      {isIPhone === false && webXrEnabled && (
        <>
          <p className="web-muted web-small">
            <strong>Other devices — spatial AR when supported:</strong> Android phones with a
            compatible WebXR runtime may supply real-world hit-test points. This does not add
            physical LiDAR to an unsupported phone; if AR tracking is unavailable, the
            calibrated-photo measurement remains available below.
          </p>
          <CurbWebXRMeasure onApplyLength={onApplyLength} />
        </>
      )}
      {message && (
        <p className="web-muted web-small" role="status">
          {message}
        </p>
      )}
      <p className="web-muted web-small">
        All AR measurements are estimates of visible surface geometry. Check accuracy against a
        known distance, and never infer buried depth, reinforcement, or utility clearance.
      </p>
    </div>
  );
}
