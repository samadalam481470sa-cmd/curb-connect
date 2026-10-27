import { describe, expect, it, vi } from 'vitest';
import { ORG_A, ORG_B, USER_ID, json, problem, scriptedFetch } from '../../test/helpers';
import { ApiError, createApiClient } from '../api';
import { DraftStore } from './drafts';
import { Outbox, apiSender, type OutboxEntry } from './outbox';
import { memoryStore } from './store';

const scopeA = { userId: USER_ID, orgId: ORG_A };
const scopeB = { userId: USER_ID, orgId: ORG_B };

function clock(start = '2026-10-26T10:00:00.000Z') {
  let now = new Date(start).getTime();
  return {
    now: () => new Date(now),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function networkError(): ApiError {
  return new ApiError({
    kind: 'network',
    method: 'POST',
    path: '/v1/x',
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

function makeOutbox(c = clock()) {
  return {
    outbox: new Outbox({ store: memoryStore<OutboxEntry>(), now: c.now, backoffBaseMs: 1000 }),
    clock: c,
  };
}

const photo = {
  kind: 'curb_photo_upload',
  label: 'Curb photo 3',
  method: 'POST' as const,
  path: '/v1/curb/projects/p1/media',
  body: { fileName: 'a.jpg' },
};

describe('offline outbox (PLT-018 S)', () => {
  it('PLT-018-QA: retries reuse the idempotency key generated at enqueue time', async () => {
    const { outbox, clock: c } = makeOutbox();
    const entry = await outbox.enqueue({ ...photo, scope: scopeA });
    const keys: string[] = [];
    const send = vi.fn(async (e: OutboxEntry) => {
      keys.push(e.idempotencyKey);
      if (keys.length < 3) throw networkError();
    });

    expect((await outbox.flush(scopeA, send)).retried).toEqual([entry.id]);
    // Backoff: not due yet, so a second flush does not resend.
    expect((await outbox.flush(scopeA, send)).skipped).toBe(1);
    c.advance(1000);
    await outbox.flush(scopeA, send);
    c.advance(2000);
    const last = await outbox.flush(scopeA, send);

    expect(last.sent).toEqual([entry.id]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(new Set(keys)).toEqual(new Set([entry.idempotencyKey]));
    expect(await outbox.list(scopeA)).toEqual([]);
  });

  it('PLT-018-QA: the API sender replays the original Idempotency-Key header on each attempt', async () => {
    let attempts = 0;
    const { fetch, calls } = scriptedFetch({
      'POST /v1/curb/projects/p1/media': () => {
        attempts += 1;
        return attempts === 1 ? problem('dependency_unavailable') : json({ ok: true }, 201);
      },
    });
    const c = clock();
    const { outbox } = makeOutbox(c);
    const entry = await outbox.enqueue({ ...photo, scope: scopeA });
    const send = apiSender(createApiClient({ fetch }));
    await outbox.flush(scopeA, send);
    c.advance(1000);
    await outbox.flush(scopeA, send);
    expect(calls).toHaveLength(2);
    expect(calls.map((r) => r.headers.get('Idempotency-Key'))).toEqual([
      entry.idempotencyKey,
      entry.idempotencyKey,
    ]);
    expect(await outbox.list(scopeA)).toEqual([]);
  });

  it('PLT-018-QA: a non-retryable rejection is parked as failed and never silently dropped', async () => {
    const { outbox } = makeOutbox();
    const entry = await outbox.enqueue({ ...photo, scope: scopeA });
    const { fetch } = scriptedFetch({
      'POST /v1/curb/projects/p1/media': problem('media_rejected', 'corr-9'),
    });
    const result = await outbox.flush(scopeA, apiSender(createApiClient({ fetch })));
    expect(result.failed).toEqual([entry.id]);
    const [stored] = await outbox.list(scopeA);
    expect(stored?.status).toBe('failed');
    expect(stored?.lastError).toMatchObject({ code: 'media_rejected', correlationId: 'corr-9' });

    // The user retries it explicitly: same key, fresh attempts.
    await outbox.requeue(entry.id);
    const [requeued] = await outbox.list(scopeA);
    expect(requeued).toMatchObject({
      status: 'pending',
      attempts: 0,
      idempotencyKey: entry.idempotencyKey,
    });
  });

  it('PLT-004-QA: entries are only sent in the workspace that created them', async () => {
    const { outbox } = makeOutbox();
    const a = await outbox.enqueue({ ...photo, scope: scopeA });
    const b = await outbox.enqueue({ ...photo, label: 'B', scope: scopeB });
    const sent: string[] = [];
    await outbox.flush(scopeB, async (e) => {
      sent.push(e.id);
    });
    expect(sent).toEqual([b.id]);
    expect((await outbox.list(scopeA)).map((e) => e.id)).toEqual([a.id]);
  });

  it('PLT-018-QA: concurrent flushes share one run, so nothing is sent twice in parallel', async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ ...photo, scope: scopeA });
    let resolve!: () => void;
    const send = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const first = outbox.flush(scopeA, send);
    const second = outbox.flush(scopeA, send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    resolve();
    expect(await first).toBe(await second);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('PLT-018-QA: stops at the first network failure to keep write order', async () => {
    const c = clock();
    const { outbox } = makeOutbox(c);
    await outbox.enqueue({ ...photo, scope: scopeA });
    c.advance(1);
    await outbox.enqueue({ ...photo, label: 'second', scope: scopeA });
    const send = vi.fn(async () => {
      throw networkError();
    });
    await outbox.flush(scopeA, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After over the default backoff', async () => {
    const c = clock();
    const { outbox } = makeOutbox(c);
    await outbox.enqueue({ ...photo, scope: scopeA });
    const { fetch } = scriptedFetch({
      'POST /v1/curb/projects/p1/media': new Response('', {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    });
    await outbox.flush(scopeA, apiSender(createApiClient({ fetch })));
    const [entry] = await outbox.list(scopeA);
    expect(Date.parse(entry!.nextAttemptAt) - c.now().getTime()).toBe(30_000);
  });

  it('caps attempts and parks the entry for review', async () => {
    const c = clock();
    const outbox = new Outbox({
      store: memoryStore(),
      now: c.now,
      backoffBaseMs: 1,
      maxAttempts: 2,
    });
    await outbox.enqueue({ ...photo, scope: scopeA });
    const send = async () => {
      throw new Error('boom');
    };
    await outbox.flush(scopeA, send);
    c.advance(10);
    const result = await outbox.flush(scopeA, send);
    expect(result.failed).toHaveLength(1);
  });
});

describe('draft store (PLT-014 S)', () => {
  it('PLT-014-QA: drafts are scoped by user and workspace and discarded on schema change', async () => {
    const drafts = new DraftStore(memoryStore());
    await drafts.save({ userId: USER_ID, orgId: ORG_A }, 'curb-intake', { step: 2 }, 1);
    expect(await drafts.load({ userId: USER_ID, orgId: ORG_B }, 'curb-intake', 1)).toBeNull();
    expect((await drafts.load({ userId: USER_ID, orgId: ORG_A }, 'curb-intake', 1))?.value).toEqual(
      { step: 2 },
    );
    expect(await drafts.load({ userId: USER_ID, orgId: ORG_A }, 'curb-intake', 2)).toBeNull();
    expect(await drafts.load({ userId: USER_ID, orgId: ORG_A }, 'curb-intake', 1)).toBeNull();
  });

  it('clearUser removes only that user’s drafts', async () => {
    const drafts = new DraftStore(memoryStore());
    await drafts.save({ userId: 'u1', orgId: null }, 'k', 1, 1);
    await drafts.save({ userId: 'u2', orgId: null }, 'k', 2, 1);
    await drafts.clearUser('u1');
    expect(await drafts.load({ userId: 'u1', orgId: null }, 'k', 1)).toBeNull();
    expect((await drafts.load({ userId: 'u2', orgId: null }, 'k', 1))?.value).toBe(2);
  });
});
