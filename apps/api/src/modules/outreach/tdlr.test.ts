import { describe, expect, it } from 'vitest';
import {
  formatPhone,
  normalizeTdlr,
  parseTdlrDate,
  renderCallScript,
  scoreLead,
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
