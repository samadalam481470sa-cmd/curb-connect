import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../../../test/support/config';
import { type App, buildApp } from '../../app';
import { runCurbCalc } from './curb';
import { runRoofCalc } from './roof';

describe('calc module pure helpers', () => {
  it('roof calc matches hip fixture direct cost', () => {
    const result = runRoofCalc({
      facets: [
        {
          id: 'all',
          structureId: 'house',
          planArea: '1200',
          planAreaUnit: 'ft2',
          pitchRise: '6',
          pitchRun: '12',
        },
      ],
      edges: {
        eave: '160',
        rake: '0',
        ridge: '40',
        hip: '75',
        valley: '15',
        unit: 'ft',
      },
      wastePercent: '10',
      laborRatePerSquare: '95',
      overheadPercent: '10',
      markupPercent: '30',
    });
    expect(result.estimate.status).toBe('priced');
    expect(result.estimate.scenarios!.base.directCost.amount).toBe('4341.06');
  });

  it('curb calc matches page-60 totals', () => {
    const result = runCurbCalc({
      cutLengthFt: '18',
      segmentCount: 1,
      sawPasses: 2,
      depthMode: 'known',
      depthIn: '6',
      depthLowIn: '6',
      depthBaseIn: '7',
      depthHighIn: '9',
      depthReason: 'depth unverified',
      removalWidthFt: '2',
      crossSectionFt2: '1.5',
      boundCrossSection: false,
      overheadPercent: '10',
      marginPercent: '25',
    });
    expect(result.estimate.firm).toBe(true);
    expect(result.estimate.scenarios!.base.directCost.amount).toBe('3744.00');
    expect(result.estimate.scenarios!.base.costBasis.amount).toBe('4118.40');
    expect(result.estimate.scenarios!.base.total.amount).toBe('5491.20');
  });
});

describe('POST /v1/calc/* (no database)', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /v1/calc/curb returns page-60 totals without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/calc/curb',
      payload: { cutLengthFt: '18' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      estimate: { scenarios: { base: { total: { amount: string } } }; firm: boolean };
    };
    expect(body.estimate.firm).toBe(true);
    expect(body.estimate.scenarios.base.total.amount).toBe('5491.20');
  });

  it('POST /v1/calc/roof rejects an empty facet list', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/calc/roof',
      payload: { facets: [] },
    });
    // Zod validation or problem+json — either is a client error, never 200.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('POST /v1/calc/roof prices the hip fixture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/calc/roof',
      payload: {
        facets: [
          {
            id: 'all',
            structureId: 'house',
            planArea: '1200',
            planAreaUnit: 'ft2',
            pitchRise: '6',
            pitchRun: '12',
          },
        ],
        edges: { eave: '160', ridge: '40', hip: '75', valley: '15' },
        wastePercent: '10',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      estimate: { scenarios: { base: { directCost: { amount: string } } } };
    };
    expect(body.estimate.scenarios.base.directCost.amount).toBe('4341.06');
  });
});
