'use client';

import { JobsiteVideoMime } from '@fieldline/contracts';
import { useEffect, useRef, useState } from 'react';

type Clip = { file: File; durationMs: number; url: string };
type Phase = 'closed' | 'opening' | 'ready' | 'recording' | 'finishing';

const formats = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

const duration = (ms: number) => Math.floor(ms / 1000).toString() + ' s';
const fileSize = (bytes: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024) +
  ' MiB';

export function JobsiteVideoRecorder({
  maxBytes,
  maxDurationMs,
  disabled,
  onAttach,
}: {
  maxBytes: number;
  maxDurationMs: number;
  disabled: boolean;
  onAttach: (file: File, durationMs: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stopAction = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const timer = useRef<number | null>(null);
  const objectUrl = useRef('');
  const [phase, setPhase] = useState<Phase>('closed');
  const [clip, setClip] = useState<Clip | null>(null);
  const [microphone, setMicrophone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [recordingLimit, setRecordingLimit] = useState(maxBytes);
  const [error, setError] = useState('');

  useEffect(
    () => () => {
      generation.current++;
      if (timer.current !== null) clearInterval(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  function stopFeed() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  function cancel() {
    generation.current++;
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current = null;
    stopAction.current = null;
    stopFeed();
    setPhase('closed');
    setElapsed(0);
    setRecordingBytes(0);
    setError('');
  }

  async function openCamera() {
    setError('');
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Video recording is unavailable on this browser.');
      return;
    }
    const request = ++generation.current;
    setPhase('opening');
    try {
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      const free =
        estimate?.quota !== undefined && estimate.usage !== undefined
          ? estimate.quota - estimate.usage
          : maxBytes;
      if (request !== generation.current) return;
      if (free <= 0) {
        cancel();
        setError('Device storage is full. Free space before recording a video.');
        return;
      }
      setRecordingLimit(Math.min(free, maxBytes));
      const source = await media.getUserMedia({
        audio: microphone,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (request !== generation.current) {
        source.getTracks().forEach((track) => track.stop());
        return;
      }
      if (!video.current) {
        source.getTracks().forEach((track) => track.stop());
        cancel();
        setError('The camera preview could not open.');
        return;
      }
      stream.current = source;
      video.current.srcObject = source;
      setPhase('ready');
    } catch (cause) {
      if (request !== generation.current) return;
      cancel();
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Camera or microphone permission was denied.'
          : 'The video camera could not open.',
      );
    }
  }

  function startRecording() {
    const source = stream.current;
    if (!source || recorder.current?.state === 'recording') return;
    const type = formats.find((mime) => MediaRecorder.isTypeSupported(mime));
    if (!type) {
      setError('This browser cannot record MP4 or WebM video.');
      return;
    }
    let active: MediaRecorder;
    try {
      active = new MediaRecorder(source, { mimeType: type, videoBitsPerSecond: 2_000_000 });
    } catch {
      setError('Video recording could not start.');
      return;
    }
    const request = ++generation.current;
    const startedAt = performance.now();
    const capturedAt = Date.now();
    const chunks: Blob[] = [];
    let bytes = 0;
    let tooLarge = false;
    let stoppedAt = 0;

    function stop() {
      if (active.state !== 'recording') return;
      stoppedAt = performance.now();
      active.stop();
      setPhase('finishing');
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
    }

    recorder.current = active;
    stopAction.current = stop;
    active.ondataavailable = ({ data }) => {
      if (request !== generation.current || !data.size) return;
      bytes += data.size;
      if (bytes > recordingLimit) {
        tooLarge = true;
        stop();
        return;
      }
      chunks.push(data);
      setRecordingBytes(bytes);
    };
    active.onerror = () => {
      if (request !== generation.current) return;
      cancel();
      setError('The recording stopped because the camera encoder returned an error.');
    };
    active.onstop = () => {
      if (request !== generation.current) return;
      stopFeed();
      if (timer.current !== null) clearInterval(timer.current);
      timer.current = null;
      recorder.current = null;
      stopAction.current = null;
      setPhase('closed');
      const durationMs = Math.max(1, Math.round((stoppedAt || performance.now()) - startedAt));
      if (tooLarge || !chunks.length || durationMs > maxDurationMs) {
        setError(
          'The recording could not fit the duration or storage limits. Record a shorter video.',
        );
        return;
      }
      const mime = JobsiteVideoMime.safeParse(active.mimeType.split(';')[0]);
      if (!mime.success) {
        setError('The camera did not return an MP4 or WebM file.');
        return;
      }
      const ext = mime.data === 'video/mp4' ? 'mp4' : 'webm';
      const name =
        'jobsite-' + new Date(capturedAt).toISOString().replace(/[:.]/g, '-') + '.' + ext;
      const file = new File(chunks, name, { type: mime.data, lastModified: capturedAt });
      objectUrl.current = URL.createObjectURL(file);
      setClip({ file, durationMs, url: objectUrl.current });
    };
    try {
      active.start(250);
    } catch {
      cancel();
      setError('The camera encoder could not start.');
      return;
    }
    setPhase('recording');
    setElapsed(0);
    setRecordingBytes(0);
    setError('');
    const deadline = Math.max(1, maxDurationMs - 250);
    timer.current = window.setInterval(() => {
      const current = performance.now() - startedAt;
      setElapsed(current);
      if (current >= deadline) stop();
    }, 100);
  }

  function clearClip() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    setClip(null);
  }

  return (
    <fieldset className="enterprise-jobsite-camera-controls">
      <legend>Record jobsite video</legend>
      <p>
        Up to {duration(maxDurationMs)} and {fileSize(maxBytes)}. Recording uses device storage.
      </p>
      {phase !== 'closed' && recordingLimit < maxBytes && (
        <p role="status">Available storage limits this recording to {fileSize(recordingLimit)}.</p>
      )}
      {phase === 'closed' && !clip && (
        <>
          <label>
            <input
              type="checkbox"
              checked={microphone}
              disabled={disabled}
              onChange={(event) => setMicrophone(event.target.checked)}
            />{' '}
            Include microphone audio
          </label>
          <button type="button" disabled={disabled} onClick={() => void openCamera()}>
            Open video camera
          </button>
        </>
      )}
      {phase !== 'closed' && (
        <>
          <video
            ref={video}
            aria-label="Live video preview"
            className="enterprise-jobsite-camera"
            muted
            autoPlay
            playsInline
          />
          {phase === 'opening' && <p role="status">Opening video camera…</p>}
          {phase === 'ready' && (
            <button type="button" disabled={disabled} onClick={startRecording}>
              Start recording
            </button>
          )}
          {phase === 'recording' && (
            <>
              <p role="status">
                Recording · {duration(elapsed)} · {fileSize(recordingBytes)}
              </p>
              <button type="button" onClick={() => stopAction.current?.()}>
                Stop recording
              </button>
            </>
          )}
          {phase === 'finishing' && <p role="status">Preparing video preview…</p>}
          <button type="button" onClick={cancel}>
            {phase === 'recording' ? 'Discard recording' : 'Close video camera'}
          </button>
        </>
      )}
      {clip && (
        <>
          <video
            aria-label="Recorded video preview"
            className="enterprise-jobsite-camera"
            controls
            playsInline
            src={clip.url}
          />
          <p>
            {duration(clip.durationMs)} · {fileSize(clip.file.size)}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onAttach(clip.file, clip.durationMs);
              clearClip();
            }}
          >
            Attach video
          </button>
          <button type="button" onClick={clearClip}>
            Discard video
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
