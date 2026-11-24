// Gov Opportunities matching / drafting tests. No network, no AI server.
import { describe, expect, it } from 'vitest';
import {
  buildOpportunities,
  draftOutreach,
  extractJsonObject,
  matchTrade,
  whatToOffer,
} from './opportunities';
import type { GovLinkRow } from './scanner';

function row(overrides: Partial<GovLinkRow> = {}): GovLinkRow {
  return {
    pageId: 'dallas-enterprise-hub',
    pageName: 'City of Dallas — Business Enterprise Hub',
    pageCity: 'Dallas',
    pageUrl: 'https://dallascityhall.com/departments/procurement/Pages/Business-Enterprise-Hub.aspx',
    linkUrl: 'https://example.com/roofing-contractors',
    linkText: 'Roofing contractors directory',
    status: 'dead',
    httpStatus: 404,
    checkedAt: '2026-11-24T12:00:00.000Z',
    note: 'Returned HTTP 404.',
    ...overrides,
  };
}

describe('matchTrade', () => {
  it('is strong when the dead link names the trade', () => {
    expect(matchTrade(row(), 'roofing')).toBe('strong');
    expect(matchTrade(row({ linkText: 'HVAC rebates', linkUrl: 'https://example.com/hvac' }), 'hvac')).toBe(
      'strong',
    );
  });

  it('is general when the dead link does not name the trade', () => {
    expect(matchTrade(row(), 'plumbing')).toBe('general');
  });
});

describe('buildOpportunities', () => {
  it('keeps dead links only, strongest matches first', () => {
    const rows = [
      row({ linkUrl: 'https://example.com/general', linkText: 'Small business loans' }),
      row({ linkUrl: 'https://example.com/live', linkText: 'Roofing guide', status: 'live' }),
      row({ linkUrl: 'https://example.com/unknown', linkText: 'Roofing help', status: 'unknown' }),
    ];
    const opps = buildOpportunities(rows, 'roofing');
    expect(opps).toHaveLength(1);
    expect(opps[0]?.deadUrl).toBe('https://example.com/general');
    expect(opps[0]?.match).toBe('general');
    expect(opps[0]?.whatToOffer).toMatch(/roofing/i);
  });

  it('orders strong matches before general ones', () => {
    const rows = [
      row({ linkUrl: 'https://example.com/general', linkText: 'Grants' }),
      row({ linkUrl: 'https://example.com/roof', linkText: 'Roofing contractors' }),
    ];
    const opps = buildOpportunities(rows, 'roofing');
    expect(opps.map((o) => o.match)).toEqual(['strong', 'general']);
  });
});

describe('whatToOffer', () => {
  it('names the trade and the page, and never invents a contact', () => {
    const text = whatToOffer('electrical', 'City of Dallas — Business Enterprise Hub');
    expect(text).toMatch(/electrical/);
    expect(text).toMatch(/Business Enterprise Hub/);
    expect(text).toMatch(/does not invent a contact email/);
  });
});

describe('draftOutreach', () => {
  it('returns null without an AI server — the caller reports that honestly', async () => {
    const result = await draftOutreach(
      { homeAi: null, openModel: null },
      {
        pageName: 'City of Dallas — Business Enterprise Hub',
        pageUrl: 'https://dallascityhall.com/x',
        deadUrl: 'https://example.com/gone',
        linkText: 'Roofing guide',
        trade: 'roofing',
      },
      { name: 'Acme Roofing', yourName: 'Sam', website: '' },
    );
    expect(result).toBeNull();
  });
});

describe('extractJsonObject', () => {
  it('pulls the JSON object out of a reply with surrounding prose', () => {
    expect(extractJsonObject('Here it is: {"draft": "Hello"} done')).toEqual({ draft: 'Hello' });
    expect(extractJsonObject('no json here')).toBeNull();
  });
});
