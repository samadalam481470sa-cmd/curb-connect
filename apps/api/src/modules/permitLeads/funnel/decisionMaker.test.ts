import { describe, expect, it, vi } from 'vitest';
import type { LicenseLead } from '../../outreach/tdlr';
import { normalizeName } from './owner';
import {
  decisionMakerFromLicense,
  enrichDecisionMaker,
  matchLicenseByName,
  namesMatch,
  resolveDecisionMaker,
  type CrmContact,
} from './decisionMaker';

const license = (over: Partial<LicenseLead> = {}): LicenseLead => ({
  sourceId: 'Electrical Contractor#38384',
  name: 'Yogi Solar Llc',
  ownerName: 'Patel, Ravi',
  licenseType: 'Electrical Contractor',
  licenseNumber: '38384',
  expiresOn: '2026-12-20',
  phone: '(919) 808-8032',
  address: '28525 Rose Ln, Katy TX 77494-5486',
  city: 'Katy',
  county: 'FORT BEND',
  ...over,
});

const tdlrRow = (over: Record<string, unknown> = {}) => ({
  license_type: 'Electrical Contractor',
  license_number: '38384',
  business_name: 'YOGI SOLAR LLC',
  business_address_line1: '28525 ROSE LN',
  business_city_state_zip: 'KATY TX 77494-5486',
  business_telephone: '9198088032',
  license_expiration_date_mmddccyy: '12/20/2026',
  owner_name: 'PATEL, RAVI',
  ...over,
});

const tdlrResponse = (rows: unknown[]) =>
  new Response(JSON.stringify(rows), { status: 200 });

describe('namesMatch', () => {
  it('matches exact, case/punctuation and entity-suffix variants', () => {
    expect(namesMatch('Yogi Solar LLC', 'YOGI SOLAR LLC')).toBe(true);
    expect(namesMatch('Yogi Solar, L.L.C.', 'Yogi Solar LLC')).toBe(true);
    expect(namesMatch('Yogi Solar', 'Yogi Solar LLC')).toBe(true);
    expect(namesMatch("O'Brien Homes LLC", "OBRIEN HOMES LLC")).toBe(true);
  });

  it('never matches a different core name', () => {
    expect(namesMatch('Yogi Solar LLC', 'Yogi Air LLC')).toBe(false);
    expect(namesMatch('Acme Builders', 'Acme Roofing')).toBe(false);
    expect(namesMatch('Yogi Solar', 'Yogi Solar and Sons')).toBe(false);
    expect(namesMatch('', 'Yogi Solar')).toBe(false);
    expect(namesMatch('Yogi Solar', '')).toBe(false);
  });
});

describe('matchLicenseByName', () => {
  it('returns the single license whose business name matches', () => {
    const found = matchLicenseByName('YOGI SOLAR LLC', [
      license(),
      license({ name: 'Other Air Co', licenseNumber: '99999' }),
    ]);
    expect(found?.licenseNumber).toBe('38384');
  });

  it('returns null when two different licenses share the core name — never the wrong license', () => {
    const found = matchLicenseByName('Acme Builders LLC', [
      license({ name: 'Acme Builders Llc', licenseNumber: '111' }),
      license({ name: 'Acme Builders Inc', licenseNumber: '222' }),
    ]);
    expect(found).toBeNull();
  });

  it('treats two rows for the same license number as one license', () => {
    const found = matchLicenseByName('Yogi Solar LLC', [
      license(),
      license({ expiresOn: '2027-12-20' }),
    ]);
    expect(found?.licenseNumber).toBe('38384');
  });

  it('returns null when nothing matches', () => {
    expect(matchLicenseByName('No Such Company', [license()])).toBeNull();
  });
});

describe('resolveDecisionMaker', () => {
  const contact = (over: Partial<CrmContact> = {}): CrmContact => ({
    displayName: 'Ravi Patel',
    email: 'ravi@yogisolar.example',
    phone: '(919) 808-8032',
    role: 'Owner',
    ...over,
  });

  it('prefers the TDLR license holder, naming the person on the license', () => {
    const dm = resolveDecisionMaker({
      contractor: 'Yogi Solar LLC',
      ownerName: null,
      licenses: [license()],
      contactsByName: new Map([[normalizeName('Yogi Solar LLC'), contact()]]),
    });
    expect(dm).toMatchObject({
      name: 'Patel, Ravi',
      source: 'tdlr',
      licenseType: 'Electrical Contractor',
      licenseNumber: '38384',
      licenseExpiresOn: '2026-12-20',
      phone: '(919) 808-8032',
      phoneSource: 'tdlr',
      email: null,
    });
  });

  it('falls back to the business name when the license names no separate person', () => {
    const dm = resolveDecisionMaker({
      contractor: 'Yogi Solar LLC',
      ownerName: null,
      licenses: [license({ ownerName: null })],
    });
    expect(dm.name).toBe('Yogi Solar Llc');
    expect(dm.source).toBe('tdlr');
  });

  it('matches the license on the owner name when the contractor name does not match', () => {
    const dm = resolveDecisionMaker({
      contractor: 'Some General Contractor',
      ownerName: 'Yogi Solar LLC',
      licenses: [license()],
    });
    expect(dm.name).toBe('Patel, Ravi');
    expect(dm.source).toBe('tdlr');
  });

  it('falls back to a CRM contact matched by name, with its email and role', () => {
    const dm = resolveDecisionMaker({
      contractor: 'Acme Builders LLC',
      ownerName: null,
      licenses: [license()],
      contactsByName: new Map([[normalizeName('Acme Builders LLC'), contact()]]),
    });
    expect(dm).toMatchObject({
      name: 'Ravi Patel',
      source: 'contacts',
      licenseType: null,
      email: 'ravi@yogisolar.example',
      role: 'Owner',
      phoneSource: 'contacts',
    });
  });

  it('returns the empty decision-maker — never an invented name — when nothing matches', () => {
    const dm = resolveDecisionMaker({
      contractor: 'Acme Builders LLC',
      ownerName: 'Jane Homeowner',
      licenses: [license()],
      contactsByName: new Map(),
    });
    expect(dm).toMatchObject({
      name: null,
      source: null,
      licenseType: null,
      phone: null,
      email: null,
    });
  });
});

describe('decisionMakerFromLicense', () => {
  it('keeps a lapsed license visible via expiresOn instead of hiding it', () => {
    const dm = decisionMakerFromLicense(license({ expiresOn: '' }));
    expect(dm.licenseExpiresOn).toBeNull();
    expect(dm.name).toBe('Patel, Ravi');
  });
});

describe('enrichDecisionMaker (mocked TDLR fetch)', () => {
  it('resolves the license holder from the TDLR file by contractor name', async () => {
    const fetcher = vi.fn(async () => tdlrResponse([tdlrRow()]));
    const dm = await enrichDecisionMaker(
      { contractor: 'Yogi Solar LLC', ownerName: null },
      { fetcher: fetcher as unknown as typeof fetch, today: new Date('2026-11-22T12:00:00Z') },
    );
    expect(dm.name).toBe('Patel, Ravi');
    expect(dm.source).toBe('tdlr');
    expect(dm.licenseNumber).toBe('38384');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('falls back to CRM contacts when the TDLR file has no license for the company', async () => {
    const fetcher = vi.fn(async () => tdlrResponse([]));
    const dm = await enrichDecisionMaker(
      { contractor: 'Acme Builders Zz LLC', ownerName: null },
      {
        fetcher: fetcher as unknown as typeof fetch,
        contactsByName: new Map([
          [
            normalizeName('Acme Builders Zz LLC'),
            {
              displayName: 'Alice Acme',
              email: 'alice@acme.example',
              phone: '(512) 555-0100',
              role: 'Estimator',
            },
          ],
        ]),
      },
    );
    expect(dm.name).toBe('Alice Acme');
    expect(dm.source).toBe('contacts');
    expect(dm.email).toBe('alice@acme.example');
  });

  it('still resolves from CRM contacts when the TDLR fetch fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const dm = await enrichDecisionMaker(
      { contractor: 'Acme Builders Qq LLC', ownerName: null },
      {
        fetcher: failing as unknown as typeof fetch,
        contactsByName: new Map([
          [
            normalizeName('Acme Builders Qq LLC'),
            { displayName: 'Alice Acme', email: null, phone: null, role: null },
          ],
        ]),
      },
    );
    expect(dm.name).toBe('Alice Acme');
    expect(dm.source).toBe('contacts');
  });

  it('returns the empty decision-maker and never throws when everything fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const dm = await enrichDecisionMaker(
      { contractor: 'No Such Company Ww LLC', ownerName: null },
      { fetcher: failing as unknown as typeof fetch },
    );
    expect(dm.name).toBeNull();
    expect(dm.source).toBeNull();
  });

  it('does not call TDLR when skipTdlr is set', async () => {
    const fetcher = vi.fn(async () => tdlrResponse([tdlrRow()]));
    const dm = await enrichDecisionMaker(
      { contractor: 'Yogi Solar LLC', ownerName: null },
      { fetcher: fetcher as unknown as typeof fetch, skipTdlr: true },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(dm.name).toBeNull();
  });
});
