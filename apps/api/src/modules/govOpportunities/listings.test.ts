// Gov Opportunities listing-presence tests. All HTTP is mocked.
import { describe, expect, it } from 'vitest';
import {
  CMBL_SEARCH_STEPS,
  CMBL_SEARCH_URL,
  checkSamRegistration,
  listingItems,
} from './listings';

function samPayload(entities: unknown[]): unknown {
  return { totalRecords: entities.length, entityData: entities };
}

function samEntity(legalName: string, uei = 'ABC123XYZ456'): unknown {
  return {
    entityRegistration: { legalBusinessName: legalName },
    coreData: { ueiSAM: uei },
  };
}

describe('checkSamRegistration', () => {
  it('reports requires_setup without a key — never a guessed answer', async () => {
    await expect(
      checkSamRegistration({ samKey: null, companyName: 'Acme Roofing' }),
    ).resolves.toEqual({ status: 'requires_setup' });
  });

  it('reports listed when the API returns a matching entity', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify(samPayload([samEntity('Acme Roofing LLC')])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(
      checkSamRegistration({ fetchFn, samKey: 'key', companyName: 'Acme Roofing' }),
    ).resolves.toEqual({ status: 'listed', uei: 'ABC123XYZ456', legalName: 'Acme Roofing LLC' });
  });

  it('reports not_listed when no entity matches the company name', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify(samPayload([samEntity('Other Company Inc')])), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(
      checkSamRegistration({ fetchFn, samKey: 'key', companyName: 'Acme Roofing' }),
    ).resolves.toEqual({ status: 'not_listed' });
  });

  it('reports unknown when the key is rejected', async () => {
    const fetchFn = (async () => new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    const result = await checkSamRegistration({ fetchFn, samKey: 'bad-key', companyName: 'Acme' });
    expect(result.status).toBe('unknown');
  });

  it('reports unknown when SAM.gov answers in an unexpected format', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ somethingElse: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const result = await checkSamRegistration({ fetchFn, samKey: 'key', companyName: 'Acme' });
    expect(result.status).toBe('unknown');
  });
});

describe('listingItems', () => {
  it('CMBL is always a manual check with the exact search URL and steps', async () => {
    const items = await listingItems({ samKey: null, companyName: 'Acme Roofing' });
    const cmbl = items.find((i) => i.id === 'cmbl')!;
    expect(cmbl.status).toBe('manual_check');
    expect(cmbl.url).toBe(CMBL_SEARCH_URL);
    expect(cmbl.steps).toEqual(CMBL_SEARCH_STEPS);
    expect(cmbl.checkedAt).toBeNull();
    expect(cmbl.detail).toMatch(/no public API/i);
  });

  it('SAM is requires_setup without a key and lists the register URL', async () => {
    const items = await listingItems({ samKey: null, companyName: 'Acme Roofing' });
    const sam = items.find((i) => i.id === 'sam')!;
    expect(sam.status).toBe('requires_setup');
    expect(sam.detail).toMatch(/free/i);
    expect(sam.url).toBe('https://sam.gov/entity-information');
  });
});
