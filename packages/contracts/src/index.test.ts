import { describe, expect, it } from 'vitest';
import { BRAND, HealthResponseSchema, ProblemSchema } from './index';

describe('@fieldline/contracts smoke', () => {
  it('STR-009: exposes the single brand constant', () => {
    expect(BRAND.name).toBe('Fieldline');
    expect(BRAND.products.roof).not.toBe(BRAND.products.curb);
  });

  it('accepts a valid health payload and rejects a malformed one', () => {
    const ok = { status: 'ok', service: 'api', version: '0.1.0', time: new Date().toISOString() };
    expect(HealthResponseSchema.parse(ok)).toEqual(ok);
    expect(HealthResponseSchema.safeParse({ ...ok, status: 'down' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ ...ok, time: 'yesterday' }).success).toBe(false);
  });

  it('requires correlationId and retryable on problem+json bodies', () => {
    const base = { type: 'about:blank', title: 'Not Found', status: 404, code: 'not_found' };
    expect(ProblemSchema.safeParse(base).success).toBe(false);
    expect(
      ProblemSchema.safeParse({ ...base, correlationId: 'req-1', retryable: false }).success,
    ).toBe(true);
    expect(
      ProblemSchema.safeParse({ ...base, status: 200, correlationId: 'x', retryable: false })
        .success,
    ).toBe(false);
  });
});
