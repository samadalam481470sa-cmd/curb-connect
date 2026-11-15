'use client';

// CV-043 / ADD-041 guided capture: the shot list from GET /curb/projects/{id}/capture with its
// safety copy. Shots that could need standing in a roadway are never required and carry a
// stand-off warning. Each shot uploads (hash -> intent -> PUT with progress -> complete), then the
// worker's quality check returns replace instructions; "Replace this frame" re-captures only that
// shot, keeping every other photo (CV-044).
import { CURB_CAPTURE_PROTOCOL, type PhotoQualityOutcomeSchema } from '@fieldline/contracts';
import type { z } from 'zod';
import { Button, RiskNotice, StatusPill } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ErrorNotice } from '../common';
import { sha256Hex } from './curbApi';
import { Panel } from './CurbCommon';
import { curbKeys, useCurbProject } from './useCurbProject';

type Quality = z.infer<typeof PhotoQualityOutcomeSchema>;

export type UploadPhase = 'idle' | 'hashing' | 'requesting' | 'uploading' | 'processing' | 'checking' | 'done' | 'failed';

export type PutFile = (url: string, file: Blob, headers: Record<string, string>, onProgress: (ratio: number) => void) => Promise<void>;

/** PUT with upload progress (XMLHttpRequest exposes progress; fetch does not). */
export const xhrPut: PutFile = (url, file, headers, onProgress) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.send(file);
  });

const MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

export function CaptureShotList({ putFile = xhrPut }: { putFile?: PutFile }) {
  const { projectId, curb } = useCurbProject();
  const session = useSession();
  const keys = curbKeys(session.orgId, projectId);
  const checklist = useQuery({ queryKey: keys.capture, queryFn: () => curb.capture(projectId) });
  const shots = checklist.data?.shots ?? CURB_CAPTURE_PROTOCOL.map((s) => ({ ...s, status: 'missing' as const, mediaAssetIds: [] as string[] }));

  return (
    <Panel title="Guided photo capture" id="capture">
      <RiskNotice kind="site_safety" title="Stay out of live traffic">
        Shoot from the sidewalk, driveway or curb top. Never stand in a live lane or gutter to get a photo. Shots marked
        &quot;roadway risk&quot; are optional: skip them when they are not safe.
      </RiskNotice>
      {checklist.error && <ErrorNotice error={checklist.error} onRetry={() => void checklist.refetch()} />}
      {checklist.data && (
        <p role="status" className={checklist.data.complete ? 'curb-ok' : 'curb-warn'}>
          {checklist.data.complete ? 'All required shots captured and usable.' : 'Required shots are missing or need a retake.'}
        </p>
      )}
      {checklist.data?.instructions.length ? (
        <ul className="curb-list">
          {checklist.data.instructions.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
      <ol className="curb-shots">
        {shots.map((s) => (
          <ShotRow key={s.viewType} shot={s} putFile={putFile} />
        ))}
      </ol>
    </Panel>
  );
}

function ShotRow({ shot, putFile }: { shot: { viewType: string; label: string; required: boolean; roadwayRisk: boolean; safety: string; instructions: string; status: string; mediaAssetIds: string[] }; putFile: PutFile }) {
  const { projectId, curb } = useCurbProject();
  const session = useSession();
  const qc = useQueryClient();
  const keys = curbKeys(session.orgId, projectId);
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const idemKey = useRef<string>(newIdempotencyKey());

  const upload = async (file: File, fresh: boolean) => {
    if (fresh) idemKey.current = newIdempotencyKey();
    setLastFile(file);
    setError(null);
    setQuality(null);
    setProgress(0);
    try {
      if (!MIME.has(file.type)) throw new Error('Use a JPEG, PNG, HEIC or WebP photo.');
      setPhase('hashing');
      const sha256 = await sha256Hex(file);
      setPhase('requesting');
      const intent = await curb.createUpload({ ownerId: projectId, fileName: file.name || `${shot.viewType}.jpg`, mimeType: file.type, sizeBytes: file.size, sha256, viewType: shot.viewType }, idemKey.current);
      if (intent.uploadUrl) {
        setPhase('uploading');
        await putFile(intent.uploadUrl, file, intent.headers, setProgress);
      }
      setProgress(1);
      setPhase('processing');
      await curb.completeUpload(intent.uploadId);
      setPhase('checking');
      const q = await curb.photoQuality(projectId, intent.mediaAssetId);
      setQuality(q);
      setPhase('done');
      void qc.invalidateQueries({ queryKey: keys.capture });
      void qc.invalidateQueries({ queryKey: keys.photos });
    } catch (e) {
      setError(e);
      setPhase('failed');
    }
  };

  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'failed';
  const tone = shot.status === 'captured' ? ('success' as const) : shot.status === 'retake_required' ? ('danger' as const) : ('neutral' as const);
  return (
    <li className="curb-shot" data-status={shot.status}>
      <div className="curb-shot__head">
        <strong>{shot.label}</strong>
        <span className="curb-tag">{shot.required ? 'Required' : 'Optional'}</span>
        {shot.roadwayRisk && <span className="curb-tag curb-tag--danger">Roadway risk: only if safe</span>}
        <StatusPill status={shot.status} tone={tone} label={shot.status.replace('_', ' ')} />
      </div>
      <p>{shot.instructions}</p>
      <p className="curb-safety">
        <span aria-hidden="true">⚠ </span>
        {shot.safety}
      </p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/webp"
        capture="environment"
        hidden
        aria-label={`Photo for ${shot.label}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f, true);
          e.target.value = '';
        }}
      />
      <div className="curb-row">
        <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {shot.mediaAssetIds.length || quality ? 'Replace this frame' : 'Take photo'}
        </Button>
        {phase === 'failed' && lastFile && (
          <Button size="sm" variant="secondary" onClick={() => void upload(lastFile, false)}>
            Retry upload
          </Button>
        )}
      </div>
      {busy && (
        <div className="curb-progress" role="progressbar" aria-label={`Upload ${shot.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-valuetext={`${phaseLabel(phase)} ${Math.round(progress * 100)}%`}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
          <em>{phaseLabel(phase)}</em>
        </div>
      )}
      {phase === 'failed' && <p className="curb-error" role="alert">{errorHint(error) || (error instanceof Error ? error.message : 'Upload failed.')}</p>}
      {quality && <QualityFeedback q={quality} onReplace={() => input.current?.click()} />}
    </li>
  );
}

function phaseLabel(p: UploadPhase): string {
  return { idle: '', hashing: 'Preparing', requesting: 'Requesting upload', uploading: 'Uploading', processing: 'Processing', checking: 'Checking quality', done: 'Done', failed: 'Failed' }[p];
}

export function QualityFeedback({ q, onReplace }: { q: Quality; onReplace: () => void }) {
  const label = q.verdict === 'usable' ? 'Usable' : q.verdict === 'usable_with_warnings' ? 'Usable with warnings' : 'Retake required';
  return (
    <div className="curb-quality" data-verdict={q.verdict}>
      <p role="status">
        <strong>{label}</strong>
        {q.duplicateOf.length > 0 && ' (looks like a duplicate of an earlier photo)'}
      </p>
      {q.instructions.length > 0 && (
        <ul className="curb-list">
          {q.instructions.map((i) => (
            <li key={i.code} data-severity={i.severity}>
              {i.message} <em>{i.action}</em>
            </li>
          ))}
        </ul>
      )}
      {q.verdict !== 'usable' && (
        <Button size="sm" variant={q.verdict === 'retake_required' ? 'primary' : 'secondary'} onClick={onReplace}>
          Replace only this frame
        </Button>
      )}
    </div>
  );
}
