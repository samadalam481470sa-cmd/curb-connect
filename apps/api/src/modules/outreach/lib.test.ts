import { describe, expect, it } from 'vitest';
import {
  assertPublicHost,
  classifyReply,
  complianceFooter,
  extractAmountMinor,
  extractEmails,
  newestPart,
  normalizePlaces,
  renderTemplate,
  searchPlan,
  statusAfterReply,
  TEXAS_CITIES,
} from './lib';

describe('outreach search plan', () => {
  it('covers every Texas city for each chosen trade', () => {
    const plan = searchPlan(['concrete', 'home_builder'], []);
    expect(plan).toHaveLength(TEXAS_CITIES.length * 2);
    expect(plan[0]!.query).toBe('concrete contractor in Houston, TX');
  });
  it('uses the company’s own cities and ignores unknown trades', () => {
    const plan = searchPlan(['concrete', 'nope'], ['Waco']);
    expect(plan).toEqual([
      { trade: 'concrete', city: 'Waco', query: 'concrete contractor in Waco, TX' },
    ]);
  });
});

describe('google places results', () => {
  it('keeps open Texas businesses only', () => {
    const out = normalizePlaces(
      {
        places: [
          {
            id: 'a',
            displayName: { text: 'Lone Star Concrete' },
            formattedAddress: '12 Main St, Waco, TX 76701, USA',
            nationalPhoneNumber: '(254) 555-0100',
            websiteUri: 'https://lonestar.example/home?utm=x',
          },
          {
            id: 'b',
            displayName: { text: 'Closed Co' },
            formattedAddress: '1 A St, Waco, TX',
            businessStatus: 'CLOSED_PERMANENTLY',
          },
          {
            id: 'c',
            displayName: { text: 'Okie Builders' },
            formattedAddress: '1 A St, Tulsa, OK 74103, USA',
          },
        ],
      },
      'Waco',
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      city: 'Waco',
      phone: '(254) 555-0100',
      website: 'https://lonestar.example/home',
    });
  });
});

describe('website emails', () => {
  it('prefers the bid desk on the company domain and skips junk', () => {
    const html = `<a href="mailto:info@acme.com">x</a> bids@acme.com logo@2x.png someone@gmail.com
      user@example.com estimating&#64;acme.com`;
    expect(extractEmails(html, 'www.acme.com')[0]).toBe('bids@acme.com');
    expect(extractEmails(html, 'acme.com')).not.toContain('user@example.com');
  });
  it('refuses private hosts', async () => {
    await expect(assertPublicHost('127.0.0.1')).rejects.toThrow();
    await expect(assertPublicHost('10.1.2.3')).rejects.toThrow();
    await expect(assertPublicHost('localhost')).rejects.toThrow();
  });
});

describe('templates', () => {
  it('fills in company details and always carries the opt-out footer', () => {
    expect(
      renderTemplate('Hi {{company}} in {{city}} from {{my_company}} {{unknown}}', {
        company: 'Acme',
        city: 'Dallas',
        trade: 'concrete',
        myCompany: 'Curb Connect',
        myPhone: '',
        sender: '',
      }),
    ).toBe('Hi Acme in Dallas from Curb Connect {{unknown}}');
    expect(complianceFooter('Curb Connect', '1 Main St, Carrollton, TX')).toMatch(/reply "remove"/);
  });
});

describe('reading replies', () => {
  it('ignores quoted history', () => {
    expect(newestPart('Sounds good\n\nOn Mon, Nov 23 Sam wrote:\n> $50,000 job')).toBe(
      'Sounds good',
    );
  });
  it('finds amounts', () => {
    expect(extractAmountMinor('We can do it for $12,500.50 or $9k')).toBe(1_250_050);
    expect(extractAmountMinor('no price')).toBeNull();
  });
  it('classifies replies', () => {
    expect(classifyReply('Re: bid', 'Please remove me from your list').kind).toBe('opt_out');
    expect(classifyReply('Re: bid', 'remove').kind).toBe('opt_out');
    expect(classifyReply('Re: bid', 'Our price is $18,000 for the flatwork')).toEqual({
      kind: 'offer',
      amountMinor: 1_800_000,
    });
    expect(classifyReply('Re: bid', 'Not interested, thanks').kind).toBe('declined');
    expect(classifyReply('Re: bid', 'Yes, we added you to our bid list').kind).toBe('interested');
    expect(classifyReply('Automatic reply: out of office', 'Back Monday').kind).toBe('auto_reply');
    expect(classifyReply('Re: bid', 'Who is this?').kind).toBe('reply');
  });
  it('only moves status forward and remove-me always wins', () => {
    expect(statusAfterReply('contacted', 'interested')).toBe('interested');
    expect(statusAfterReply('offer', 'declined')).toBe('offer');
    expect(statusAfterReply('offer', 'opt_out')).toBe('do_not_contact');
    expect(statusAfterReply('contacted', 'auto_reply')).toBe('contacted');
  });
});
