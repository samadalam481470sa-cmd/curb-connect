'use client';

import { useEffect, useRef, useState } from 'react';

function cameraError(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError')
    return 'Camera permission was denied. Choose a photo instead.';
  return 'The camera could not open. Choose a photo or use the device camera.';
}

export function JobsitePhotoCamera({
  disabled,
  onPhoto,
}: {
  disabled: boolean;
  onPhoto: (file: File) => void;
}) {
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [state, setState] = useState<'closed' | 'opening' | 'live'>('closed');
  const [hasFrame, setHasFrame] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [adjustingLight, setAdjustingLight] = useState(false);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      generation.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function close() {
    generation.current++;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setState('closed');
    setHasFrame(false);
    setCapturing(false);
    setTorch(false);
    setError('');
  }

  async function start(nextDevice?: string) {
    close();
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      fallback.current?.click();
      return;
    }
    const attempt = generation.current;
    setState('opening');
    try {
      const active = await media.getUserMedia({
        audio: false,
        video: {
          ...(nextDevice
            ? { deviceId: { exact: nextDevice } }
            : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (attempt !== generation.current) {
        active.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = active.getVideoTracks()[0];
      stream.current = active;
      if (!track || !video.current) throw new Error('No camera stream.');
      const settings = track.getSettings();
      const capabilities = track.getCapabilities?.() as
        (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchAvailable(capabilities?.torch === true);
      setDeviceId(settings.deviceId ?? nextDevice ?? '');
      video.current.srcObject = active;
      setState('live');
      const available = await media.enumerateDevices().catch(() => []);
      if (attempt === generation.current)
        setDevices(
          available
            .filter((device) => device.kind === 'videoinput' && device.deviceId)
            .map((device) => device.deviceId),
        );
    } catch (cause) {
      if (attempt !== generation.current) return;
      close();
      setError(cameraError(cause));
    }
  }

  function switchCamera() {
    const next = (devices.indexOf(deviceId) + 1) % devices.length;
    const candidate = devices[next];
    if (candidate) void start(candidate);
  }

  async function changeLight() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const attempt = generation.current;
    setAdjustingLight(true);
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      if (attempt === generation.current) setTorch(!torch);
    } catch {
      if (attempt === generation.current) setError('The camera light could not be changed.');
    } finally {
      setAdjustingLight(false);
    }
  }

  function takePhoto() {
    const frame = video.current;
    if (!frame || !frame.videoWidth || !frame.videoHeight || capturing) return;
    const canvas = document.createElement('canvas');
    canvas.width = frame.videoWidth;
    canvas.height = frame.videoHeight;
    const drawing = canvas.getContext('2d');
    if (!drawing) {
      setError('The camera frame could not be prepared. Choose a photo instead.');
      return;
    }
    try {
      drawing.drawImage(frame, 0, 0);
    } catch {
      setError('The camera frame could not be captured.');
      return;
    }
    const capturedAt = Date.now();
    const attempt = generation.current;
    setCapturing(true);
    canvas.toBlob(
      (image) => {
        if (attempt !== generation.current) return;
        if (!image) {
          setCapturing(false);
          setError('The camera frame could not be saved.');
          return;
        }
        const filename =
          'jobsite-' + new Date(capturedAt).toISOString().replace(/[:.]/g, '-') + '.jpg';
        close();
        onPhoto(new File([image], filename, { type: image.type, lastModified: capturedAt }));
      },
      'image/jpeg',
      0.95,
    );
  }

  return (
    <div className="enterprise-stack enterprise-jobsite-camera-controls">
      {state === 'closed' && (
        <button type="button" disabled={disabled} onClick={() => void start()}>
          Open camera
        </button>
      )}
      {state !== 'closed' && (
        <>
          <video
            ref={video}
            className="enterprise-jobsite-camera"
            aria-label="Live camera preview"
            muted
            playsInline
            autoPlay
            onCanPlay={() => setHasFrame(true)}
          />
          {state === 'opening' && <p role="status">Opening camera…</p>}
          <div className="enterprise-actions">
            {state === 'live' && (
              <>
                <button
                  type="button"
                  disabled={disabled || !hasFrame || capturing}
                  onClick={takePhoto}
                >
                  Capture photo
                </button>
                {devices.length > 1 && (
                  <button type="button" disabled={disabled || capturing} onClick={switchCamera}>
                    Switch camera
                  </button>
                )}
                {torchAvailable && (
                  <button
                    type="button"
                    aria-pressed={torch}
                    disabled={disabled || capturing || adjustingLight}
                    onClick={() => void changeLight()}
                  >
                    Camera light
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={close}>
              Close camera
            </button>
          </div>
        </>
      )}
      {error && (
        <>
          <p role="alert" className="enterprise-error">
            {error}
          </p>
          {state === 'closed' && (
            <button type="button" disabled={disabled} onClick={() => fallback.current?.click()}>
              Use device camera
            </button>
          )}
        </>
      )}
      <input
        hidden
        ref={fallback}
        type="file"
        capture="environment"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPhoto(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
