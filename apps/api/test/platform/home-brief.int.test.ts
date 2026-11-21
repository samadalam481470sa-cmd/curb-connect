// The house brief route that fills the House Studio from a typed description or a plan file.
// These tests run with no AI key, so they cover the built-in parser and the plain refusal for
// plan files, which is what a server without ANTHROPIC_API_KEY does.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, call, createCompany, createTestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ env: { ANTHROPIC_API_KEY: '' } });
});
afterEach(async () => {
  await ctx.cleanup();
});
afterAll(async () => {
  await ctx?.close();
});

describe('House brief', () => {
  it('reads a typed brief into a house program with the built-in parser', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/home/brief', {
      as: company.owner,
      body: { text: 'Two-story 4 bed 3 bath, 2,400 sq ft, two-car garage, 9 ft walls, 8/12 roof' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.source).toBe('rules');
    expect(body.spec).toMatchObject({
      stories: 2,
      bedrooms: 4,
      bathrooms: 3,
      garage: 'two_car',
      wallHeightFt: 9,
      roofPitch: 8,
    });
    // 2,400 SF over two floors is about 1,200 SF per floor.
    const perFloor = body.spec.lengthFt * body.spec.widthFt;
    expect(perFloor).toBeGreaterThan(1_000);
    expect(perFloor).toBeLessThan(1_400);
    expect(body.notes[0]).toMatch(/built-in parser/);
  });

  it('refuses a plan file without text when AI is not set up', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/home/brief', {
      as: company.owner,
      body: { file: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } },
    });
    expect(res.statusCode, res.body).toBe(503);
    expect(res.json().code).toBe('dependency_unavailable');
  });

  it('rejects an empty brief and needs a signed-in company member', async () => {
    const company = await createCompany(ctx);
    const empty = await call(ctx, 'POST', '/v1/home/brief', { as: company.owner, body: {} });
    expect(empty.statusCode).toBe(400);
    const anonymous = await call(ctx, 'POST', '/v1/home/brief', { body: { text: '3 bed 2 bath' } });
    expect(anonymous.statusCode).toBe(401);
  });
});
