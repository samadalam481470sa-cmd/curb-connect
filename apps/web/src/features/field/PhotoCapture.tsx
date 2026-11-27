'use client';

// Photo capture for the field screens: opens the phone camera (or file picker), then
// uploads through the offline-aware path — online it goes straight up; offline the
// bytes are kept on this device and upload when the connection returns. The status
// line always says which happened; nothing pretends to have uploaded.
import { useRef, useState } from 'react';
import { errorHint } from '../../lib/api';
import { uploadPhotoOrQueue } from '../../lib/offline/fieldWrites';
import { useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, type UiLang } from '../builderOps/shared';

export function PhotoCapture({
  ownerType,
  ownerId,
  attachToInspectionResultId,
  lang,
  onUploaded,
}: {
  ownerType: string;
  ownerId: string;
  attachToInspectionResultId?: string;
  lang: UiLang;
  onUploaded?: () => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const L = FIELD_LABELS[lang];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const result = await uploadPhotoOrQueue(
        api,
        { userId: session.me.user.id, orgId: session.orgId },
        {
          file,
          fileName: file.name || 'field-photo.jpg',
          ownerType,
          ownerId,
          kind: 'photo',
          label: L.takePhoto,
          attachToInspectionResultId,
        },
      );
      setStatus(result.queued ? L.photoQueued : L.photoUploaded);
      onUploaded?.();
    } catch (err) {
      setError(errorHint(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className="cc-btn"
        style={{ minHeight: 48 }}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {L.takePhoto}
      </button>
      {status ? (
        <p className="web-muted" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p className="web-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
