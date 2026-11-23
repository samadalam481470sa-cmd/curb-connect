import { describe, expect, it, vi } from 'vitest';
import { AlertSink } from './alerts';

const event = {
  kind: 'unhandled_error',
  route: '/v1/jobs',
  method: 'POST',
  status: 500,
  errorName: 'TypeError',
  correlationId: 'req-1',
};

function okFetch(calls: { url: string; body: string }[]) {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response('{}', { status: 200 });
  };
}

describe('AlertSink (item 31)', () => {
  it('is log-and-count only when no webhook is configured', () => {
    const sink = new AlertSink({ webhookUrl: null });
    expect(sink.status()).toBe('not_configured');
    expect(sink.record(event)).toBe(false);
    expect(sink.counts()).toEqual({ recorded: 1, sent: 0 });
  });

  it('posts a data-safe payload to the configured webhook', async () => {
    const calls: { url: string; body: string }[] = [];
    const sink = new AlertSink({ webhookUrl: 'https://alerts.example/hook', fetchImpl: okFetch(calls) });
    expect(sink.status()).toBe('configured');
    expect(sink.record(event)).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const payload = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      kind: 'unhandled_error',
      route: '/v1/jobs',
      status: 500,
      errorName: 'TypeError',
      correlationId: 'req-1',
      service: 'api',
      suppressed: 0,
    });
    // No message, body or header fields can leak through the payload shape.
    expect(Object.keys(payload)).not.toContain('message');
    expect(Object.keys(payload)).not.toContain('body');
  });

  it('throttles repeats for the same route and error, counting suppressions', async () => {
    const calls: { url: string; body: string }[] = [];
    let now = 1_000_000;
    const sink = new AlertSink({
      webhookUrl: 'https://alerts.example/hook',
      fetchImpl: okFetch(calls),
      throttleMs: 60_000,
      now: () => now,
    });
    expect(sink.record(event)).toBe(true);
    expect(sink.record(event)).toBe(false);
    expect(sink.record(event)).toBe(false);
    now += 61_000;
    expect(sink.record(event)).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    const second = JSON.parse(calls[1]!.body) as Record<string, unknown>;
    expect(second.suppressed).toBe(2);
    expect(sink.counts()).toEqual({ recorded: 4, sent: 2 });
  });

  it('does not throttle different routes against each other', () => {
    const calls: { url: string; body: string }[] = [];
    const sink = new AlertSink({ webhookUrl: 'https://alerts.example/hook', fetchImpl: okFetch(calls) });
    expect(sink.record(event)).toBe(true);
    expect(sink.record({ ...event, route: '/v1/invoices' })).toBe(true);
  });

  it('reports delivery failures through the callback instead of throwing', async () => {
    const failures: unknown[] = [];
    const sink = new AlertSink({
      webhookUrl: 'https://alerts.example/hook',
      fetchImpl: async () => new Response('no', { status: 503 }),
      onDeliveryFailure: (e) => failures.push(e),
    });
    expect(sink.record(event)).toBe(true);
    await vi.waitFor(() => expect(failures).toHaveLength(1));
  });
});
