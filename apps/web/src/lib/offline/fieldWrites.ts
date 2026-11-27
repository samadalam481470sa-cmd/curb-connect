// Field writes through the offline outbox (PLT-018 S): crew members work where the signal is
// bad, so the field flows (time entries, checklist answers, daily logs, punch updates, warranty
// replies, photos) try the API first and, on a network failure, queue the exact same write —
// with the same Idempotency-Key — in the IndexedDB outbox. OutboxSync replays it on reconnect;
// the API's idempotency store makes a replay safe. A queued write is reported to the UI as
// "saved on this device", never as sent.
import { z } from 'zod';
import {
  isApiError,
  newIdempotencyKey,
  type ApiClient,
  type HttpMethod,
} from '../api';
import { apiSender, getOutbox, type OutboxEntry, type OutboxScope, type OutboxSender } from './outbox';

export type { OutboxScope };

export interface SubmitOrQueueInput<T> {
  scope: OutboxScope;
  /** Short machine name for the outbox list, e.g. "time_entry_create". */
  kind: string;
  /** Human-readable description shown while queued. */
  label: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  ifMatch?: number;
  /** Performs the write online with the given key (the same key is reused if queued). */
  send: (idempotencyKey: string) => Promise<T>;
}

export interface SubmitOrQueueResult<T> {
  queued: boolean;
  data: T | null;
}

/**
 * Try the write now; if the network is unreachable, queue it for replay and report `queued`.
 * Server-side rejections (validation, permission, conflicts) are rethrown — queueing those
 * would only fail again later and hide the real problem from the person standing there.
 */
export async function submitOrQueue<T>(
  input: SubmitOrQueueInput<T>,
): Promise<SubmitOrQueueResult<T>> {
  const idempotencyKey = newIdempotencyKey();
  try {
    const data = await input.send(idempotencyKey);
    return { queued: false, data };
  } catch (error) {
    if (isApiError(error) && error.kind === 'network') {
      await getOutbox().enqueue({
        scope: input.scope,
        kind: input.kind,
        label: input.label,
        method: input.method,
        path: input.path,
        body: input.body,
        ifMatch: input.ifMatch,
        idempotencyKey,
      });
      return { queued: true, data: null };
    }
    throw error;
  }
}

// ------------------------------------------------------------------ photos

export const PHOTO_UPLOAD_KIND = 'photo_upload';

export interface PhotoUploadBody {
  blob: Blob;
  fileName: string;
  mimeType: string;
  sha256: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  viewType?: string | null;
  /** When set, the uploaded media id is appended to this inspection result's photos. */
  attachToInspectionResultId?: string;
}

const UploadIntent = z.object({
  uploadId: z.string(),
  mediaAssetId: z.string(),
  uploadUrl: z.string().nullable(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
  duplicate: z.boolean(),
  status: z.string(),
});

const InspectionResultPhotos = z.object({
  id: z.string(),
  photoMediaIds: z.array(z.string()),
});

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The full media upload flow (intent → PUT bytes → complete) as one replayable unit. The
 * intent is idempotent by sha256 within the company, so replaying after a partial failure
 * never stores the same photo twice.
 */
export async function uploadPhotoNow(
  api: ApiClient,
  body: PhotoUploadBody,
  idempotencyKey: string,
): Promise<{ mediaAssetId: string }> {
  const ticket = await api.post(
    '/v1/media/uploads',
    {
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      kind: body.kind,
      viewType: body.viewType ?? undefined,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.blob.size,
      sha256: body.sha256,
    },
    { schema: UploadIntent, idempotencyKey },
  );
  if (!ticket.duplicate && ticket.uploadUrl) {
    const put = await fetch(ticket.uploadUrl, {
      method: ticket.method,
      headers: ticket.headers,
      body: body.blob,
      credentials: 'include',
    });
    if (!put.ok) throw new Error(`Photo upload failed with status ${put.status}.`);
    await api.post(`/v1/media/uploads/${ticket.uploadId}/complete`, undefined, {});
  }
  if (body.attachToInspectionResultId) {
    const current = await api.get(
      `/v1/field-ops/inspection-results/${body.attachToInspectionResultId}`,
      { schema: InspectionResultPhotos },
    );
    const existing = current.photoMediaIds;
    if (!existing.includes(ticket.mediaAssetId)) {
      await api.patch(
        `/v1/field-ops/inspection-results/${body.attachToInspectionResultId}`,
        { photoMediaIds: [...existing, ticket.mediaAssetId] },
        { schema: InspectionResultPhotos },
      );
    }
  }
  return { mediaAssetId: ticket.mediaAssetId };
}

export interface QueuePhotoInput {
  file: Blob;
  fileName: string;
  ownerType: string;
  ownerId: string;
  kind: string;
  viewType?: string | null;
  attachToInspectionResultId?: string;
  label: string;
}

/** Try the photo upload now; on a network failure keep the bytes in the outbox for replay. */
export async function uploadPhotoOrQueue(
  api: ApiClient,
  scope: OutboxScope,
  input: QueuePhotoInput,
): Promise<{ queued: boolean; mediaAssetId: string | null }> {
  const body: PhotoUploadBody = {
    blob: input.file,
    fileName: input.fileName,
    mimeType: input.file.type || 'image/jpeg',
    sha256: await sha256Hex(input.file),
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    kind: input.kind,
    viewType: input.viewType ?? null,
    attachToInspectionResultId: input.attachToInspectionResultId,
  };
  const idempotencyKey = newIdempotencyKey();
  try {
    const { mediaAssetId } = await uploadPhotoNow(api, body, idempotencyKey);
    return { queued: false, mediaAssetId };
  } catch (error) {
    if (isApiError(error) && error.kind === 'network') {
      await getOutbox().enqueue({
        scope,
        kind: PHOTO_UPLOAD_KIND,
        label: input.label,
        method: 'POST',
        path: '/v1/media/uploads',
        body,
        idempotencyKey,
      });
      return { queued: true, mediaAssetId: null };
    }
    throw error;
  }
}

/**
 * Outbox sender that knows the multi-step photo flow; every other entry replays through the
 * plain API sender with its original Idempotency-Key.
 */
export function fieldSender(api: ApiClient): OutboxSender {
  const fallback = apiSender(api);
  return async (entry: OutboxEntry) => {
    if (entry.kind !== PHOTO_UPLOAD_KIND) return fallback(entry);
    await uploadPhotoNow(api, entry.body as PhotoUploadBody, entry.idempotencyKey);
  };
}
