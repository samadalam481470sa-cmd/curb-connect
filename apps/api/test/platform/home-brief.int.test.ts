// The house brief route that fills the House Studio from a typed description or a plan file.
// These tests run with no AI key, so they cover the built-in parser and the plain refusal for
// plan files, which is what a server without ANTHROPIC_API_KEY does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('reads a CAD plan PDF from its text layer without AI', async () => {
    const company = await createCompany(ctx);
    const data = readFileSync(join(__dirname, '../fixtures/plan-text-layer.pdf')).toString('base64');
    const res = await call(ctx, 'POST', '/v1/home/brief', {
      as: company.owner,
      body: { file: { mediaType: 'application/pdf', data } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ source: 'rules', reading: 'pdf_text' });
    expect(body.spec).toMatchObject({ bedrooms: 3, bathrooms: 2, roofPitch: 6, garage: 'two_car' });
    expect(body.notes.join(' ')).toMatch(/no AI needed/);
  });

  it('returns follow-up questions, budget, lot and things on hand', async () => {
    const company = await createCompany(ctx);
    const res = await call(ctx, 'POST', '/v1/home/brief', {
      as: company.owner,
      body: { text: 'I have 40 2x4s. Make me a 4 bed house on a 60x120 lot, budget $350k' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.budgetCents).toBe(35_000_000);
    expect(body.lot).toEqual({ widthFt: 60, depthFt: 120 });
    expect(body.onHand).toEqual([{ item: 'stud_2x4', quantity: 40 }]);
    expect(body.questions.map((q: { field: string }) => q.field)).toEqual(['size', 'bathrooms', 'stories', 'garage']);
    expect(body.spec.lengthFt).toBeLessThanOrEqual(120);
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

describe('House brief from a vector plan PDF', () => {
  it('measures the drawn plan without AI and returns the reading for checking', async () => {
    const company = await createCompany(ctx);
    const { drawPlan } = await import('../fixtures/plan-pdf');
    const data = Buffer.from(await drawPlan()).toString('base64');
    const res = await call(ctx, 'POST', '/v1/home/brief', {
      as: company.owner,
      body: { file: { mediaType: 'application/pdf', data } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.reading).toBe('pdf_geometry');
    expect(body.plan.footprint).toMatchObject({ lengthFt: 48, widthFt: 32 });
    expect(body.spec).toMatchObject({ lengthFt: 48, widthFt: 32, bedrooms: 2, bathrooms: 1, stories: 1 });
  });
});
