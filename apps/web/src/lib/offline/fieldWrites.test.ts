// Field writes (PLT-018 S): a write that fails because the network is gone is queued in the
// outbox with the same Idempotency-Key; a server rejection is surfaced, never queued. Photos
// replay the full intent → PUT → complete flow.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG_A, USER_ID, json, problem, scriptedFetch } from '../../test/helpers';
import { ApiError, createApiClient } from '../api';
import { PHOTO_UPLOAD_KIND, fieldSender, submitOrQueue, uploadPhotoOrQueue } from './fieldWrites';
import { getOutbox } from './outbox';

const scope = { userId: USER_ID, orgId: ORG_A };

function networkError(): ApiError {
  return new ApiError({
    kind: 'network',
    method: 'POST',
    path: '/v1/field-ops/time-entries',
    problem: {
      type: 'about:blank',
      title: 'Network unavailable',
      status: 503,
      code: 'dependency_unavailable',
      correlationId: 'c',
      retryable: true,
    },
  });
}

function problemError(): ApiError {
  return new ApiError({
    kind: 'problem',
    method: 'POST',
    path: '/v1/field-ops/time-entries',
    problem: {
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      correlationId: 'c',
      retryable: false,
    },
  });
}

afterEach(async () => {
  const outbox = getOutbox();
  for (const entry of await outbox.list(scope)) await outbox.remove(entry.id);
  vi.unstubAllGlobals();
});

describe('submitOrQueue (PLT-018 S)', () => {
  it('returns the data and queues nothing when the write succeeds online', async () => {
    const result = await submitOrQueue({
      scope,
      kind: 'time_entry_create',
      label: 'Time entry',
      method: 'POST',
      path: '/v1/field-ops/time-entries',
      body: { hours: 8 },
      send: async () => ({ id: 'te-1' }),
    });
    expect(result).toEqual({ queued: false, data: { id: 'te-1' } });
    expect(await getOutbox().list(scope)).toHaveLength(0);
  });

  it('queues a network failure with the same idempotency key the online attempt used', async () => {
    let attemptedKey = '';
    const result = await submitOrQueue({
      scope,
      kind: 'time_entry_create',
      label: 'Time entry for Sam',
      method: 'POST',
      path: '/v1/field-ops/time-entries',
      body: { hours: 8 },
      send: async (key) => {
        attemptedKey = key;
        throw networkError();
      },
    });
    expect(result.queued).toBe(true);
    expect(result.data).toBeNull();
    const entries = await getOutbox().list(scope);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.idempotencyKey).toBe(attemptedKey);
    expect(entries[0]?.kind).toBe('time_entry_create');
    expect(entries[0]?.body).toEqual({ hours: 8 });
  });

  it('rethrows a server rejection and queues nothing', async () => {
    await expect(
      submitOrQueue({
        scope,
        kind: 'time_entry_create',
        label: 'Time entry',
        method: 'POST',
        path: '/v1/field-ops/time-entries',
        body: { hours: -1 },
        send: async () => {
          throw problemError();
        },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await getOutbox().list(scope)).toHaveLength(0);
  });
});

describe('photo uploads through the outbox (PLT-018 S)', () => {
  const ticket = {
    uploadId: 'up-1',
    mediaAssetId: 'media-1',
    uploadUrl: 'https://storage.example/put',
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    expiresAt: '2026-11-26T12:00:00.000Z',
    duplicate: false,
    status: 'pending_upload',
  };

  it('fieldSender replays intent → PUT → complete for a queued photo', async () => {
    const { fetch: fetchImpl, calls } = scriptedFetch({
      'POST /v1/media/uploads': json(ticket, 201),
      'PUT /put': new Response(null, { status: 200 }),
      'POST /v1/media/uploads/up-1/complete': json({ id: 'media-1' }),
    });
    vi.stubGlobal('fetch', fetchImpl);
    const api = createApiClient({ fetch: fetchImpl });
    const outbox = getOutbox();
    const entry = await outbox.enqueue({
      scope,
      kind: PHOTO_UPLOAD_KIND,
      label: 'Site photo',
      method: 'POST',
      path: '/v1/media/uploads',
      body: {
        blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
        fileName: 'site.jpg',
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        ownerType: 'job',
        ownerId: 'job-1',
        kind: 'photo',
        viewType: null,
      },
    });
    const result = await outbox.flush(scope, fieldSender(api));
    expect(result.sent).toEqual([entry.id]);
    expect(await outbox.list(scope)).toHaveLength(0);
    const paths = calls.map((c) => `${c.method} ${c.url}`);
    expect(paths).toEqual([
      'POST /v1/media/uploads',
      'PUT https://storage.example/put',
      'POST /v1/media/uploads/up-1/complete',
    ]);
  });

  it('uploadPhotoOrQueue keeps the bytes when the network is gone', async () => {
    // Simulate a dead connection by rejecting fetch outright.
    const deadFetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', deadFetch);
    const api = createApiClient({ fetch: deadFetch });
    const result = await uploadPhotoOrQueue(api, scope, {
      file: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
      fileName: 'site.jpg',
      ownerType: 'job',
      ownerId: 'job-1',
      kind: 'photo',
      label: 'Site photo',
    });
    expect(result.queued).toBe(true);
    const entries = await getOutbox().list(scope);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe(PHOTO_UPLOAD_KIND);
  });

  it('fieldSender still replays plain writes through the API sender', async () => {
    const { fetch: fetchImpl, calls } = scriptedFetch({
      'POST /v1/field-ops/time-entries': json({ id: 'te-9' }, 201),
    });
    const api = createApiClient({ fetch: fetchImpl });
    const outbox = getOutbox();
    await outbox.enqueue({
      scope,
      kind: 'time_entry_create',
      label: 'Time entry',
      method: 'POST',
      path: '/v1/field-ops/time-entries',
      body: { hours: 4 },
    });
    const result = await outbox.flush(scope, fieldSender(api));
    expect(result.sent).toHaveLength(1);
    expect(calls[0]?.headers.get('idempotency-key')).toBeTruthy();
  });

  it('a photo the server rejects is not queued (problem surfaces)', async () => {
    const { fetch: fetchImpl } = scriptedFetch({ 'POST /v1/media/uploads': problem('validation_failed') });
    vi.stubGlobal('fetch', fetchImpl);
    const api = createApiClient({ fetch: fetchImpl });
    await expect(
      uploadPhotoOrQueue(api, scope, {
        file: new Blob(['x'], { type: 'image/jpeg' }),
        fileName: 'site.jpg',
        ownerType: 'job',
        ownerId: 'job-1',
        kind: 'photo',
        label: 'Site photo',
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(await getOutbox().list(scope)).toHaveLength(0);
  });
});
