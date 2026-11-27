import { describe, expect, it } from 'vitest';
import { expiryStatus, matchesFilters, type TradeCandidate } from './search';

describe('expiryStatus', () => {
  const today = '2026-11-26';
  it('no date on file', () => {
    expect(expiryStatus(null, today)).toBe('not_on_file');
  });
  it('past date is expired', () => {
    expect(expiryStatus('2026-11-25', today)).toBe('expired');
  });
  it('within 30 days is expiring_soon', () => {
    expect(expiryStatus('2026-12-20', today)).toBe('expiring_soon');
    expect(expiryStatus('2026-11-26', today)).toBe('expiring_soon');
  });
  it('beyond 30 days is current', () => {
    expect(expiryStatus('2027-06-01', today)).toBe('current');
  });
});

const cand: TradeCandidate = {
  trades: ['Roofing', 'Concrete'],
  serviceCities: ['Dallas', 'Fort Worth'],
  serviceZips: ['75201', '76102'],
  availability: 'available',
  licenseStatus: 'current',
  insuranceStatus: 'expiring_soon',
};

describe('matchesFilters', () => {
  it('empty filters match everything', () => {
    expect(matchesFilters(cand, {})).toBe(true);
  });
  it('trade match is case-insensitive and substring-tolerant', () => {
    expect(matchesFilters(cand, { trade: 'roofing' })).toBe(true);
    expect(matchesFilters(cand, { trade: 'Plumbing' })).toBe(false);
  });
  it('city filter', () => {
    expect(matchesFilters(cand, { city: 'dallas' })).toBe(true);
    expect(matchesFilters(cand, { city: 'Austin' })).toBe(false);
  });
  it('exact ZIP vs ZIP area (first 3 digits)', () => {
    expect(matchesFilters(cand, { zip: '75201' })).toBe(true);
    expect(matchesFilters(cand, { zip: '75299' })).toBe(false);
    expect(matchesFilters(cand, { zip: '75299', zipArea: true })).toBe(true);
    expect(matchesFilters(cand, { zip: '78701', zipArea: true })).toBe(false);
  });
  it('availability filter', () => {
    expect(matchesFilters(cand, { availability: 'available' })).toBe(true);
    expect(matchesFilters(cand, { availability: 'busy' })).toBe(false);
  });
  it('qualifiedOnly requires both documents on file and unexpired', () => {
    expect(matchesFilters(cand, { qualifiedOnly: true })).toBe(true);
    expect(matchesFilters({ ...cand, insuranceStatus: 'expired' }, { qualifiedOnly: true })).toBe(false);
    expect(matchesFilters({ ...cand, licenseStatus: 'not_on_file' }, { qualifiedOnly: true })).toBe(false);
  });
});
