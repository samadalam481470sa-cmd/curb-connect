import { describe, expect, it } from 'vitest';
import type { RawPermit } from './engine';
import {
  classifyRenovation,
  deriveFinishOuts,
  isFinishOutLead,
  valueBandOf,
} from './finishOuts';

const base: RawPermit = {
  source: 'dallas', sourceName: 'City of Dallas', permitNumber: '26-0101',
  city: 'Dallas', address: '300 Crescent Ct', zip: '75201',
  description: 'Tenant improvement: interior finish out of office suite',
  permitType: 'Building', workClass: 'Alteration', landUse: 'Commercial',
  status: 'Under review', issuedAt: null, appliedAt: '2026-11-20T00:00:00.000Z',
  value: 0, units: 0, contractor: '', contractorPhone: '',
  url: 'https://example.test/permit',
};

const NOW = new Date('2026-11-25T12:00:00.000Z');

describe('finish-out classification', () => {
  it('classifies TI, remodel, addition, repair and new construction', () => {
    expect(classifyRenovation(base)).toBe('finish_out');
    expect(classifyRenovation({ ...base, description: 'Kitchen remodel and new cabinets' })).toBe('remodel');
    expect(classifyRenovation({ ...base, description: 'Room addition at rear' })).toBe('addition');
    expect(classifyRenovation({
      ...base, description: 'Repair water damage, replace drywall', workClass: 'Repair',
    })).toBe('repair');
    expect(classifyRenovation({
      ...base, description: 'New single family residence', permitType: 'Building', workClass: 'New',
    })).toBe('new_construction');
    expect(isFinishOutLead(base)).toBe(true);
    expect(isFinishOutLead({
      ...base, description: 'Repair water damage', workClass: 'Repair',
    })).toBe(false);
  });

  it('bands published values and keeps blank values blank', () => {
    expect(valueBandOf(0)).toBe('not_listed');
    expect(valueBandOf(24_999)).toBe('under_25k');
    expect(valueBandOf(25_000)).toBe('25k_100k');
    expect(valueBandOf(999_999)).toBe('500k_1m');
    expect(valueBandOf(10_000_000)).toBe('1m_10m');
    expect(valueBandOf(10_000_001)).toBe('over_10m');
  });
});

describe('deriveFinishOuts', () => {
  it('surfaces finish-outs with stage, band and an honestly-labeled possible opening', () => {
    const priced = {
      ...base, permitNumber: '26-0102', address: '500 Main St', value: 250_000,
      contractor: 'GC Builders', status: 'Issued', issuedAt: '2026-11-22T00:00:00.000Z',
    };
    const done = { ...base, permitNumber: '26-0103', address: '9 Done St', status: 'Finaled' };
    const newBuild = {
      ...base, permitNumber: '26-0104', address: '1 New Rd',
      description: 'New commercial warehouse construction', workClass: 'New', status: 'Issued',
      issuedAt: '2026-11-22T00:00:00.000Z',
    };
    const r = deriveFinishOuts([base, priced, done, newBuild], NOW);
    expect(r.permitsScanned).toBe(4);
    expect(r.finishOutPermits).toBe(3);
    // Completed finish-out is dropped; new construction is not a finish-out lead.
    expect(r.leads.map((l) => l.permitNumber).sort()).toEqual(['26-0101', '26-0102']);
    const top = r.leads.find((l) => l.permitNumber === '26-0101')!;
    expect(top.underReview).toBe(true);
    expect(top.valueBand).toBe('not_listed');
    expect(top.value).toBe(0);
    expect(top.possibleFinishOpening).toBe(true);
    expect(top.possibleFinishOpeningNote).toContain('Inference only');
    expect(top.reasons).toContain('Value not listed on the permit');
    // Total sums only published values — the blank one adds nothing.
    expect(r.totalListedValue).toBe(250_000);
    expect(r.underReview).toBe(1);
    expect(r.byBand.not_listed).toBe(1);
    expect(r.byBand['100k_500k']).toBe(1);
  });

  it('applies stage and value-band filters', () => {
    const priced = {
      ...base, permitNumber: '26-0102', address: '500 Main St', value: 250_000,
      status: 'Issued', issuedAt: '2026-11-22T00:00:00.000Z',
    };
    const reviewOnly = deriveFinishOuts([base, priced], NOW, { stages: ['application'] });
    expect(reviewOnly.leads.map((l) => l.permitNumber)).toEqual(['26-0101']);
    const bandOnly = deriveFinishOuts([base, priced], NOW, { valueBands: ['100k_500k'] });
    expect(bandOnly.leads.map((l) => l.permitNumber)).toEqual(['26-0102']);
    const kindOnly = deriveFinishOuts([base, priced], NOW, { kinds: ['remodel'] });
    expect(kindOnly.leads).toEqual([]);
  });

  it('counts a separate finish-out permit at the same address as recorded evidence', () => {
    const finishPermit = {
      ...base, permitNumber: '26-0109', permitType: 'Finish Out',
      description: 'Flooring and cabinets', status: 'Issued',
      issuedAt: '2026-11-23T00:00:00.000Z',
    };
    const r = deriveFinishOuts([base, finishPermit], NOW);
    const lead = r.leads.find((l) => l.permitNumber === '26-0101')!;
    expect(lead.finishTradeEvidence).toBe('recorded');
    // No contractor is named on the parent permit, so the opening inference still stands,
    // and it is still labeled an inference.
    expect(lead.possibleFinishOpening).toBe(true);
    expect(lead.possibleFinishOpeningNote).toContain('does not prove');
  });
});
