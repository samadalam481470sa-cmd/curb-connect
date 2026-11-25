import { describe, expect, it, vi } from 'vitest';
import {
  formatPhone,
  lookupTdlrByName,
  normalizeTdlr,
  parseTdlrDate,
  renderCallScript,
  scoreLead,
  tdlrNameQuery,
  tdlrQuery,
} from './tdlr';

const today = new Date('2026-11-22T12:00:00Z');
const row = {
  license_type: 'Electrical Contractor',
  license_number: '38384',
  business_county: 'FORT BEND',
  business_name: 'YOGI SOLAR LLC',
  business_address_line1: '28525 ROSE LN',
  business_city_state_zip: 'KATY TX 77494-5486',
  business_telephone: '9198088032',
  license_expiration_date_mmddccyy: '12/20/2026',
  owner_name: 'PATEL, RAVI',
};

describe('TDLR license leads', () => {
  it('builds a query for the months in the window', () => {
    const url = decodeURIComponent(
      tdlrQuery({
        types: ['A/C Contractor'],
        counties: ['Dallas'],
        days: 60,
        limit: 500,
        today,
      }).replace(/\+/g, ' '),
    );
    expect(url).toContain("license_type in ('A/C Contractor')");
    expect(url).toContain("like '11/%/2026'");
    expect(url).toContain("like '01/%/2027'");
    expect(url).toContain("upper(business_county) in ('DALLAS')");
  });
  it('reads rows and keeps only licenses expiring inside the window', () => {
    const out = normalizeTdlr(
      [row, { ...row, license_number: '1', license_expiration_date_mmddccyy: '06/01/2027' }],
      60,
      today,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Yogi Solar Llc',
      ownerName: 'Patel, Ravi',
      expiresOn: '2026-12-20',
      phone: '(919) 808-8032',
      city: 'Katy',
      address: '28525 Rose Ln, Katy TX 77494-5486',
    });
  });
  it('parses dates and phones', () => {
    expect(parseTdlrDate('02/06/2027')).toBe('2027-02-06');
    expect(parseTdlrDate('bad')).toBeNull();
    expect(formatPhone('123')).toBeNull();
  });
  it('scores sooner, reachable, construction leads higher', () => {
    const [lead] = normalizeTdlr([row], 60, today);
    const later = { ...lead!, expiresOn: '2027-01-20', phone: null };
    expect(scoreLead(lead!, 60, today)).toBeGreaterThan(scoreLead(later, 60, today));
    expect(scoreLead(lead!, 60, today)).toBeLessThanOrEqual(100);
  });
  it('fills a call script without inventing anything', () => {
    const text = renderCallScript(
      'Hi {{owner_first}} at {{business}}, {{days_left}} days, {{unknown}}',
      {
        business: 'Yogi Solar',
        owner: 'Patel, Ravi',
        licenseType: 'Electrical Contractor',
        expiresOn: '2026-12-20',
        city: 'Katy',
        myCompany: 'Curb Connect',
        myPhone: '',
        sender: 'Sam',
      },
      today,
    );
    expect(text).toBe('Hi Ravi at Yogi Solar, 28 days, {{unknown}}');
  });
});

describe('TDLR name lookup (decision-maker finder)', () => {
  it('builds a business-name query restricted to contractor license types', () => {
    const url = decodeURIComponent(tdlrNameQuery("O'Brien Solar LLC").replace(/\+/g, ' '));
    expect(url).toContain("upper(business_name) like '%O''BRIEN SOLAR LLC%'");
    expect(url).toContain("license_type in ('A/C Contractor'");
    expect(url).toContain("'Electrical Contractor'");
  });

  it('strips LIKE wildcards from the name so they cannot widen the match', () => {
    const url = decodeURIComponent(tdlrNameQuery('Acme%_Builders').replace(/\+/g, ' '));
    expect(url).toContain("like '%ACMEBUILDERS%'");
  });

  it('returns the license holder even when the license has lapsed', async () => {
    const lapsed = { ...row, license_expiration_date_mmddccyy: '01/15/2026' };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify([lapsed]), { status: 200 }),
    );
    const out = await lookupTdlrByName(
      'Yogi Solar LLC',
      fetcher as unknown as typeof fetch,
      { today },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: 'Yogi Solar Llc',
      ownerName: 'Patel, Ravi',
      expiresOn: '2026-01-15',
    });
    expect(String((fetcher.mock.calls[0] as unknown[] | undefined)?.[0])).toContain(
      'data.texas.gov/resource/7358-krk7.json',
    );
  });

  it('returns [] on a failed fetch or a bad payload instead of throwing', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(
      await lookupTdlrByName('Yogi Solar LLC', failing as unknown as typeof fetch),
    ).toEqual([]);
    const bad = vi.fn(async () => new Response('not json', { status: 200 }));
    expect(await lookupTdlrByName('Yogi Solar LLC', bad as unknown as typeof fetch)).toEqual([]);
    const notOk = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(
      await lookupTdlrByName('Yogi Solar LLC', notOk as unknown as typeof fetch),
    ).toEqual([]);
  });

  it('returns [] for an empty name without calling the network', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 }));
    expect(await lookupTdlrByName('  ', fetcher as unknown as typeof fetch)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
