import { describe, expect, it, vi } from 'vitest';
import { classifyProject, scorePermit, type RawPermit } from './engine';
import { searchTexasPermits } from './search';
import { checkCustomFeed, dallasMonthPatterns, normalizeCollin, normalizeDallas } from './sources';
import { PERMIT_WATCH_CRONTAB } from '../../jobs/permitWatch';
import { dueWatches } from './watch';
import { distanceTier, findTexasCity } from './texas';

const now = new Date('2026-11-20T12:00:00.000Z');
const base: RawPermit = {
  source: 'austin',
  sourceName: 'City of Austin',
  permitNumber: '2026-1 BP',
  city: 'Austin',
  address: '100 Main St',
  zip: '78701',
  description: 'New construction townhome building, 6 units',
  permitType: 'Building Permit',
  workClass: 'New',
  landUse: 'Residential',
  status: 'Active',
  issuedAt: '2026-11-18T00:00:00.000Z',
  appliedAt: null,
  value: 1_200_000,
  units: 6,
  contractor: '',
  contractorPhone: '',
  url: 'https://data.austintexas.gov/d/3syk-w9eu',
};

describe('Texas permit job search', () => {
  it('knows every Texas city by name, with county and metro when listed', () => {
    expect(findTexasCity('carrollton')).toMatchObject({ county: 'Dallas', metro: 'DFW' });
    expect(findTexasCity('Muleshoe').metro).toBe('Other Texas');
    expect(distanceTier(findTexasCity('Carrollton'), findTexasCity('Plano'))).toBe(2);
    expect(distanceTier(findTexasCity('Carrollton'), findTexasCity('Irving'))).toBe(1);
  });

  it('classifies and grades early-stage jobs with no contractor yet', () => {
    expect(classifyProject(base)).toBe('townhome');
    const s = scorePermit(base, {
      trade: 'materials',
      projectTypes: ['townhome'],
      home: findTexasCity('Austin'),
      exclude: [],
      skipPublicOwners: true,
      earlyOnly: true,
      now,
    });
    expect(s.earlyStage).toBe(true);
    expect(s.contractorAssigned).toBe(false);
    expect(s.excludedReason).toBeNull();
    expect(s.grade).toBe('A');
  });

  it('cuts skip-list builders, public owners and remodels', () => {
    const opts = {
      trade: 'grading' as const,
      projectTypes: [],
      home: findTexasCity('Austin'),
      exclude: ['Taylor Morrison'],
      skipPublicOwners: true,
      earlyOnly: true,
      now,
    };
    const site = { ...base, description: 'Subdivision grading and site work', units: 0 };
    expect(
      scorePermit({ ...site, contractor: 'Taylor Morrison of Texas' }, opts).excludedReason,
    ).toMatch(/skip list/);
    expect(
      scorePermit({ ...site, contractor: 'City of Austin Public Works' }, opts).excludedReason,
    ).toBe('Public owner');
    expect(
      scorePermit({ ...base, description: 'Interior remodel kitchen' }, opts).excludedReason,
    ).not.toBeNull();
    expect(scorePermit(site, opts).excludedReason).toBeNull();
  });

  it('reads the Dallas contractor field without inventing contacts', () => {
    const [p] = normalizeDallas([
      {
        permit_number: 'X1',
        issued_date: '11/10/26',
        value: '250000',
        contractor: 'ACME HOMES LLC 1524 LAREDO LN, MESQUITE, TX 75150 (214) 728-1977',
        work_description: 'NEW SINGLE FAMILY RESIDENCE',
        street_address: '1 ELM ST',
        zip_code: '75201',
      },
    ]);
    expect(p?.contractor).toBe('ACME HOMES LLC');
    expect(p?.contractorPhone).toBe('(214) 728-1977');
    expect(p?.issuedAt).toBe('2026-11-10T00:00:00.000Z');
    expect(dallasMonthPatterns(new Date('2026-10-05'), now)).toEqual(['10/%/26', '11/%/26']);
  });

  it('only accepts public https Socrata feeds for custom cities', async () => {
    const pub = async () => [{ address: '93.184.216.34', family: 4 }];
    const priv = async () => [{ address: '10.0.0.5', family: 4 }];
    expect(
      await checkCustomFeed('https://data.example.gov/resource/abcd-1234.json', pub as never),
    ).not.toBeNull();
    expect(
      await checkCustomFeed('https://data.example.gov/resource/abcd-1234.json', priv as never),
    ).toBeNull();
    expect(
      await checkCustomFeed('http://data.example.gov/resource/abcd-1234.json', pub as never),
    ).toBeNull();
    expect(
      await checkCustomFeed('https://169.254.169.254/resource/abcd-1234.json', pub as never),
    ).toBeNull();
    expect(await checkCustomFeed('https://data.example.gov/admin', pub as never)).toBeNull();
  });

  it('builds ranked leads, builder profiles, outreach kits and lookup links', async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(new URL(url).hostname).toBe('data.austintexas.gov');
      return new Response(
        JSON.stringify([
          {
            permit_number: 'A1',
            permit_location: '5 Oak Dr',
            original_city: 'AUSTIN',
            description: 'New townhome 4 units',
            work_class: 'New',
            issue_date: '2026-11-17T00:00:00.000',
            total_job_valuation: '900000',
            contractor_company_name: 'Hill Country Homes LLC',
            contractor_phone: '5125551234',
            status_current: 'Active',
          },
          {
            permit_number: 'A2',
            permit_location: '9 Oak Dr',
            original_city: 'AUSTIN',
            description: 'New townhome 4 units',
            work_class: 'New',
            issue_date: '2026-11-16T00:00:00.000',
            total_job_valuation: '850000',
            contractor_company_name: 'Hill Country Homes LLC',
            status_current: 'Active',
          },
          {
            permit_number: 'A3',
            permit_location: '1 Elm',
            original_city: 'AUSTIN',
            description: 'Bathroom remodel',
            work_class: 'Remodel',
            issue_date: '2026-11-15T00:00:00.000',
            total_job_valuation: '20000',
          },
        ]),
        { status: 200 },
      );
    });
    const result = await searchTexasPermits(
      {
        trade: 'materials',
        projectTypes: ['townhome'],
        cities: ['Austin', 'Lubbock'],
        homeCity: 'Round Rock',
        days: 30,
        exclude: [],
        skipPublicOwners: true,
        earlyOnly: true,
        company: 'Lone Star Supply',
        yourName: 'Sam',
        bookingLink: '',
        customFeeds: [],
      },
      { fetcher: fetcher as unknown as typeof fetch, now },
    );
    expect(result.summary.checked).toBe(3);
    expect(result.summary.qualified).toBe(2);
    expect(result.summary.totalValue).toBe(1_750_000);
    expect(result.profiles[0]).toMatchObject({
      name: 'Hill Country Homes LLC',
      permitCount: 2,
      phone: '5125551234',
    });
    expect(result.kits[0]?.emails).toHaveLength(3);
    expect(result.kits[0]?.emails[0]?.body).toContain('Lone Star Supply');
    expect(result.citiesWithoutFeed.map((c) => c.name)).toEqual(['Lubbock']);
    expect(result.citiesWithoutFeed[0]?.links[0]?.url).toMatch(
      /^https:\/\/www\.google\.com\/search/,
    );
    expect(result.video.onScreen[0]).toBe('$1,750,000 in permits');
  });

  it('reads Collin County permits for every Collin city and drops bad future dates', () => {
    const rows = normalizeCollin(
      [
        {
          permitnum: '26-1',
          permitissueddate: '2026-11-18T00:00:00.000',
          permitissuedby: 'PROSPER CITY',
          situscity: 'PROSPER',
          permittypedescr: 'New Residential',
          permitbuildername: 'STE 100',
          permitissuedto: 'Shaddock Homes',
          permitvalue: '480000',
          situsconcatshort: '1 Elm St',
        },
        { permitnum: '26-2', permitissueddate: '2206-08-19T00:00:00.000', situscity: 'FRISCO' },
      ],
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ city: 'Prosper', contractor: 'Shaddock Homes', value: 480000 });
  });

  it('schedules the daily morning check and the every-two-hours check', () => {
    expect(PERMIT_WATCH_CRONTAB).toContain('10 12 * * * permit_watch_morning ?fill=1d');
    expect(PERMIT_WATCH_CRONTAB).toContain('permit_watch_all_day');
  });

  it('picks saved searches that have not run in 3 hours for the startup check', async () => {
    const rows = [
      { orgId: 'a', schedule: 'morning', lastRunAt: null },
      { orgId: 'b', schedule: 'morning', lastRunAt: new Date(now.getTime() - 60_000) },
      { orgId: 'c', schedule: 'all_day', lastRunAt: new Date(now.getTime() - 4 * 3_600_000) },
    ];
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }) };
    const run = (async (fn: (t: never) => unknown) => fn(tx as never)) as never;
    expect(await dueWatches(run, 'stale', now)).toEqual(['a', 'c']);
  });
});
