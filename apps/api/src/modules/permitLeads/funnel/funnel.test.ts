import { describe, expect, it } from 'vitest';
import type { RawPermit } from '../engine';
import { deriveFunnelLeads, minutesAgoText } from './funnel';

const now = new Date('2026-11-24T18:00:00.000Z'); // 12:00 CST

const base: RawPermit = {
  source: 'austin',
  sourceName: 'City of Austin',
  permitNumber: 'A-1',
  city: 'Austin',
  address: '100 Main St',
  zip: '78701',
  description: 'New single family residence',
  permitType: 'Building',
  workClass: 'New',
  landUse: 'Residential',
  status: 'Issued',
  issuedAt: '2026-11-23T00:00:00.000Z',
  appliedAt: null,
  value: 250_000,
  units: 1,
  contractor: '',
  contractorPhone: '',
  url: 'https://data.austintexas.gov/d/3syk-w9eu',
};

describe('deriveFunnelLeads', () => {
  it('ranks hot leads first: issued within 7 days with no contractor on file', () => {
    const hot = { ...base, permitNumber: 'HOT' };
    const old = { ...base, permitNumber: 'OLD', issuedAt: '2026-11-01T00:00:00.000Z' };
    const withContractor = {
      ...base,
      permitNumber: 'HAS-GC',
      contractor: 'Big Builders LLC',
      issuedAt: '2026-11-24T00:00:00.000Z',
    };
    const { leads } = deriveFunnelLeads([old, withContractor, hot], now);
    expect(leads.map((l) => l.permitNumber)).toEqual(['HOT', 'HAS-GC', 'OLD']);
    expect(leads[0]!.priority).toBe('hot');
    expect(leads[0]!.callReasons.join(' ')).toContain('No contractor on file yet');
    expect(leads[1]!.priority).toBe('warm');
  });

  it('drops dead permits, public owners and duplicates — and counts them', () => {
    const dead = { ...base, permitNumber: 'DEAD', status: 'Completed' };
    const pub = { ...base, permitNumber: 'PUB', contractor: 'City of Austin' };
    const dup = { ...base, permitNumber: 'A-1' };
    const { leads, excluded, scanned } = deriveFunnelLeads([base, dead, pub, dup], now);
    expect(scanned).toBe(4);
    expect(leads).toHaveLength(1);
    expect(excluded).toEqual({ dead: 1, publicOwner: 1, duplicate: 1 });
  });

  it('never invents a phone: contractorPhone stays null when the city published none', () => {
    const { leads } = deriveFunnelLeads([base], now);
    expect(leads[0]!.contact.phone).toBeNull();
    expect(leads[0]!.contact.phoneSource).toBeNull();
    const withPhone = { ...base, contractorPhone: '(512) 555-0100' };
    const again = deriveFunnelLeads([withPhone], now);
    expect(again.leads[0]!.contact.phone).toBe('(512) 555-0100');
    expect(again.leads[0]!.contact.phoneSource).toBe('permit');
  });

  it('keeps the permit phone exactly as published and the owner blank until enriched', () => {
    const { leads } = deriveFunnelLeads([base], now);
    expect(leads[0]!.owner).toEqual({
      name: null,
      mailingAddress: null,
      source: null,
      vintage: null,
    });
    expect(leads[0]!.stage).toBe('new');
  });

  it('detects trades from the permit text and labels the call reason', () => {
    const roof = {
      ...base,
      permitNumber: 'ROOF',
      description: 'Re-roof single family residence',
      permitType: 'Roofing',
    };
    const { leads } = deriveFunnelLeads([roof], now, { trades: ['roofing'] });
    expect(leads[0]!.trades).toContain('roofing');
    expect(leads[0]!.callReasons.join(' ')).toContain('Trade match: roofing');
  });

  it('drops permits older than the window', () => {
    const old = { ...base, issuedAt: '2026-09-01T00:00:00.000Z' };
    expect(deriveFunnelLeads([old], now).leads).toHaveLength(0);
    expect(deriveFunnelLeads([old], now, { maxAgeDays: 90 }).leads).toHaveLength(1);
  });

  it('labels freshness from the batch newest permit (stale feed stays stale)', () => {
    const stale = { ...base, issuedAt: '2026-10-01T00:00:00.000Z' };
    const { leads } = deriveFunnelLeads([stale], now, { maxAgeDays: 90 });
    expect(leads[0]!.freshness).toBe('stale');
    const fresh = deriveFunnelLeads([base], now);
    expect(fresh.leads[0]!.freshness).toBe('live');
  });

  it('gives every lead a stable key for stage storage', () => {
    const { leads } = deriveFunnelLeads([base], now);
    expect(leads[0]!.key).toBe('austin:A-1');
  });
});

describe('minutesAgoText', () => {
  it('says "not checked yet" with no timestamp and "just now" under a minute', () => {
    expect(minutesAgoText(null, now)).toBe('Not checked yet');
    expect(minutesAgoText('2026-11-24T17:59:30.000Z', now)).toBe('Checked just now');
    expect(minutesAgoText('2026-11-24T17:30:00.000Z', now)).toBe('Checked 30 minutes ago');
    expect(minutesAgoText('2026-11-24T15:00:00.000Z', now)).toBe('Checked 3 hours ago');
    expect(minutesAgoText('2026-11-22T18:00:00.000Z', now)).toBe('Checked 2 days ago');
  });
});
