import type { PlanGeometryReading, PlanToBidDraftLine } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import { auditPlan } from './audit';

const line = (trade: PlanToBidDraftLine['trade'], label: string, quantity: number | null = null): PlanToBidDraftLine => ({
  trade,
  label,
  unit: 'ls',
  quantity,
  source: 'plan_text',
  evidence: 'quoted from the plan',
  confidence: 0.6,
});

const geometry = (patch: Partial<PlanGeometryReading> = {}): PlanGeometryReading => ({
  pages: 1,
  scale: { feetPerPoint: 0.05, source: 'dimensions', label: null, confidence: 0.9 },
  footprint: { lengthFt: 50, widthFt: 32, confidence: 0.9 },
  walls: { count: 20, totalLf: 300, exteriorLf: 164, thicknessIn: 6, confidence: 0.9 },
  rooms: [{ name: 'Kitchen', kind: 'kitchen', widthFt: 12, lengthFt: 14 }],
  doors: 0,
  windows: 0,
  stories: 1,
  confidence: 0.9,
  notes: [],
  ...patch,
});

describe('auditPlan', () => {
  it('notes a missing text layer and missing geometry', () => {
    const findings = auditPlan({ geometry: null, planText: '', lines: [] });
    expect(findings.map((f) => f.title)).toEqual(
      expect.arrayContaining(['No readable text layer', 'No walls or rooms could be measured']),
    );
  });

  it('flags trades the plan text never names', () => {
    const findings = auditPlan({
      geometry: geometry(),
      planText: 'SLAB ON GRADE. 2x4 STUDS.',
      lines: [line('foundations', 'Concrete slab'), line('framing', 'Wall framing / studs')],
    });
    const missing = findings.filter((f) => f.title.startsWith('No ') && f.trade);
    expect(missing.length).toBe(12); // 14 trades - 2 tagged
    expect(missing.some((f) => f.trade === 'electrical')).toBe(true);
  });

  it('counts tagged items without quantities', () => {
    const findings = auditPlan({
      geometry: geometry(),
      planText: 'SLAB',
      lines: [line('foundations', 'Concrete slab'), line('framing', 'Wall framing / studs', 120)],
    });
    const f = findings.find((x) => x.title.includes('without quantities'));
    expect(f?.title).toContain('1 tagged item');
  });

  it('flags low-confidence geometry and a missing scale as problems', () => {
    const findings = auditPlan({
      geometry: geometry({ confidence: 0.3, scale: { feetPerPoint: null, source: 'none', label: null, confidence: 0 } }),
      planText: 'SLAB',
      lines: [],
    });
    const problems = findings.filter((f) => f.severity === 'problem');
    expect(problems.map((f) => f.title)).toEqual(
      expect.arrayContaining(['Measured outline is low-confidence', 'No drawing scale found']),
    );
  });

  it('flags a stated area that disagrees with the measured outline', () => {
    const findings = auditPlan({
      geometry: geometry(),
      planText: 'TOTAL LIVING AREA 4,800 SF',
      lines: [],
    });
    const f = findings.find((x) => x.title.includes('Stated area'));
    expect(f?.severity).toBe('problem');
    expect(f?.evidence).toContain('4,800');
  });

  it('does not flag a stated area that agrees', () => {
    const findings = auditPlan({
      geometry: geometry(),
      planText: 'TOTAL LIVING AREA 1,600 SF',
      lines: [],
    });
    expect(findings.find((x) => x.title.includes('Stated area'))).toBeUndefined();
  });

  it('notes measured doors without a door schedule', () => {
    const findings = auditPlan({
      geometry: geometry({ doors: 6 }),
      planText: 'SLAB ON GRADE',
      lines: [],
    });
    expect(findings.some((f) => f.title.includes('no door schedule'))).toBe(true);
  });
});
