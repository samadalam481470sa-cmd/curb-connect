import {
  JobsiteMediaAsset,
  JobsitePhotoUploadProgress,
  StartJobsiteMediaUpload,
} from '@fieldline/contracts';
import type { ApiClient } from '../../lib/api';

export type JobsiteMediaDraft = {
  file: File;
  localCaptureId: string;
  finalizeRequestId: string;
  capturedAt: string;
  durationMs?: number;
};

async function hash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

function base64(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function uploadJobsiteMedia(
  api: ApiClient,
  path: string,
  draft: JobsiteMediaDraft,
  onProgress: (received: number, total: number) => void,
) {
  const { file } = draft;
  const bytes = await file.arrayBuffer();
  const input = StartJobsiteMediaUpload.parse({
    localCaptureId: draft.localCaptureId,
    capturedAt: draft.capturedAt,
    filename: file.name,
    mimeType: file.type,
    byteSize: file.size,
    sha256: await hash(bytes),
    ...(draft.durationMs !== undefined && { durationMs: draft.durationMs }),
  });
  const sessions = path + '/upload-sessions';
  let progress = await api.post(sessions, input, {
    ifMatch: 0,
    schema: JobsitePhotoUploadProgress,
  });
  const session = sessions + '/' + progress.id;
  onProgress(progress.receivedParts.length, progress.totalParts);
  const received = new Set(progress.receivedParts);
  for (let index = 0; index < progress.totalParts; index++) {
    if (received.has(index)) continue;
    const start = index * progress.partBytes;
    const slice = bytes.slice(start, start + progress.partBytes);
    progress = await api.put(
      session + '/parts/' + index,
      { sha256: await hash(slice), contentBase64: base64(slice) },
      { ifMatch: progress.revision, schema: JobsitePhotoUploadProgress },
    );
    onProgress(progress.receivedParts.length, progress.totalParts);
  }
  return api.post(
    session + '/finalize',
    { clientRequestId: draft.finalizeRequestId },
    {
      ifMatch: progress.finalizedAt ? progress.revision - 1 : progress.revision,
      schema: JobsiteMediaAsset,
    },
  );
}
