import { describe, expect, it, vi } from 'vitest';
import type { RawPermit } from '../engine';
import { enrichOwner, lookupCadOwner, normalizeName, ownerMatchKey } from './owner';

const base: RawPermit = {
  source: 'collin',
  sourceName: 'Collin County (appraisal district)',
  permitNumber: 'C-1',
  city: 'Plano',
  address: '100 Main St',
  zip: '75024',
  description: 'New single family residence',
  permitType: 'Residential',
  workClass: '',
  landUse: '',
  status: 'Issued',
  issuedAt: '2026-11-23T00:00:00.000Z',
  appliedAt: null,
  value: 300_000,
  units: 1,
  contractor: '',
  contractorPhone: '',
  url: 'https://data.texas.gov/d/82ee-gbj5',
};

const collinFeature = (over: Record<string, unknown> = {}) => ({
  attributes: {
    propID: '12345',
    geoID: 'R-12345',
    ownerName: 'Jane Homeowner',
    ownerAddrLine1: '100 Main St',
    ownerAddrLine2: '',
    ownerAddrCity: 'Plano',
    ownerAddrState: 'TX',
    ownerAddrZip: '75024',
    situsConcatShort: '100 Main St',
    situsConcat: '100 Main St, Plano, TX 75024',
    situsCity: 'Plano',
    situsZip: '75024',
    landSizeAcres: 0.25,
    currValYear: 2026,
    dataDate: '2026-10-23',
    ...over,
  },
  centroid: {},
});

const arcgisResponse = (features: unknown[]) =>
  new Response(JSON.stringify({ features }), { status: 200 });

describe('ownerMatchKey', () => {
  it('treats the same street with different suffixes and units as one property', () => {
    expect(ownerMatchKey('100 Main St', 'Plano')).toBe(ownerMatchKey('100 Main Street', 'Plano'));
    expect(ownerMatchKey('100 Main St Apt 4', 'Plano')).toBe(ownerMatchKey('100 Main St', 'Plano'));
    expect(ownerMatchKey('100 Main St', 'Plano')).not.toBe(ownerMatchKey('100 Main St', 'Dallas'));
    expect(ownerMatchKey('', 'Plano')).toBe('');
  });
});

describe('lookupCadOwner', () => {
  it('returns the CAD owner + mailing address for an exact Collin address match', async () => {
    const fetcher = vi.fn(async () => arcgisResponse([collinFeature()]));
    const owner = await lookupCadOwner(base, fetcher as unknown as typeof fetch);
    expect(owner?.name).toBe('Jane Homeowner');
    expect(owner?.mailingAddress).toContain('100 Main St');
    expect(owner?.mailingAddress).toContain('Plano TX 75024');
    expect(owner?.vintage).toContain('2026-10-23');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(fetcher.mock.calls[0]![0])).toContain('CCAD_Parcel_Feature_Set');
  });

  it('returns null when no parcel matches, and when the address does not agree', async () => {
    const empty = vi.fn(async () => arcgisResponse([]));
    const noMatch = { ...base, address: '200 Oak Ave' };
    expect(await lookupCadOwner(noMatch, empty as unknown as typeof fetch)).toBeNull();
    const wrong = vi.fn(async () =>
      arcgisResponse([collinFeature({ situsConcatShort: '200 Oak Ave' })]),
    );
    const mismatch = { ...base, address: '500 Cedar Ln' };
    expect(await lookupCadOwner(mismatch, wrong as unknown as typeof fetch)).toBeNull();
  });

  it('returns null when two parcels match — never the wrong owner', async () => {
    const two = vi.fn(async () =>
      arcgisResponse([
        collinFeature({ situsConcatShort: '300 Elm St' }),
        collinFeature({ propID: '99999', situsConcatShort: '300 Elm St' }),
      ]),
    );
    const ambiguous = { ...base, address: '300 Elm St' };
    expect(await lookupCadOwner(ambiguous, two as unknown as typeof fetch)).toBeNull();
  });

  it('returns null for a city with no wired parcel layer', async () => {
    const fetcher = vi.fn(async () => arcgisResponse([collinFeature()]));
    const austin = { ...base, city: 'Austin', address: '100 Congress Ave' };
    expect(await lookupCadOwner(austin, fetcher as unknown as typeof fetch)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns null when the CAD service fails instead of throwing', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const failingPermit = { ...base, address: '400 Pine St' };
    expect(await lookupCadOwner(failingPermit, failing as unknown as typeof fetch)).toBeNull();
  });
});

describe('enrichOwner', () => {
  it('never invents a phone; takes it from the permit when published', async () => {
    const withPhone = {
      ...base,
      address: '600 Main St',
      contractorPhone: '(512) 555-0100',
      contractor: 'Big Builders LLC',
    };
    const fetcher = vi.fn(async () => arcgisResponse([]));
    const { owner, contact } = await enrichOwner(
      withPhone,
      { fetcher: fetcher as unknown as typeof fetch },
    );
    expect(contact.phone).toBe('(512) 555-0100');
    expect(contact.phoneSource).toBe('permit');
    expect(owner.name).toBe('Big Builders LLC');
    expect(owner.source).toBe('permit');
  });

  it('matches a phone from the company contacts by owner name, and only then', async () => {
    const contactsByName = new Map([[normalizeName('Jane Homeowner'), '(972) 555-0142']]);
    const fetcher = vi.fn(async () => arcgisResponse([collinFeature()]));
    const { owner, contact } = await enrichOwner(base, {
      fetcher: fetcher as unknown as typeof fetch,
      contactsByName,
    });
    expect(owner.name).toBe('Jane Homeowner');
    expect(contact.phone).toBe('(972) 555-0142');
    expect(contact.phoneSource).toBe('contacts');
  });

  it('leaves phone null with no permit phone and no contact match', async () => {
    const fetcher = vi.fn(async () => arcgisResponse([collinFeature()]));
    const { contact } = await enrichOwner(base, { fetcher: fetcher as unknown as typeof fetch });
    expect(contact.phone).toBeNull();
    expect(contact.phoneSource).toBeNull();
  });
});

describe('normalizeName', () => {
  it('folds case and punctuation for contact matching', () => {
    expect(normalizeName("O'Brien Homes, LLC")).toBe('o brien homes llc');
  });
});
