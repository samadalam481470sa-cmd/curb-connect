import { describe, expect, it } from 'vitest';
import { ADDENDUM_CONTROL_GATES } from './enterpriseControlAddendum';
import {
  CONTROL_COMPLIANCE_WARNING_DAYS,
  CONTROL_GATE_DEFINITIONS,
  controlComplianceLabel,
  controlGateCompliance,
} from './enterpriseControlCompliance';

const TODAY = '2026-11-25';

describe('control gate compliance', () => {
  it('defines the 18 addendum gates once, in order, with evidence standards', () => {
    expect(CONTROL_GATE_DEFINITIONS).toHaveLength(18);
    expect(CONTROL_GATE_DEFINITIONS.map((gate) => gate.order)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    );
    expect(new Set(CONTROL_GATE_DEFINITIONS.map((gate) => gate.key)).size).toBe(18);
    expect(CONTROL_GATE_DEFINITIONS.map((gate) => gate.title)).toEqual([...ADDENDUM_CONTROL_GATES]);
    for (const gate of CONTROL_GATE_DEFINITIONS) {
      expect(gate.title.trim().length).toBeGreaterThan(0);
      expect(gate.requirement.trim().length).toBeGreaterThan(0);
      expect(gate.evidenceStandard.trim().length).toBeGreaterThan(0);
      expect(gate.validityDays).toBeGreaterThan(0);
    }
  });

  it('treats current accepted evidence as proof', () => {
    const result = controlGateCompliance({
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      expiresOn: null,
      today: TODAY,
      evidence: [{ reviewStatus: 'accepted', expiresOn: '2027-06-01' }],
    });
    expect(result.status).toBe('satisfied');
    expect(result.accepted).toBe(1);
    expect(result.nextExpiry).toBe('2027-06-01');
  });

  it('reports the warning window before accepted evidence expires', () => {
    const result = controlGateCompliance({
      ownerUserId: null,
      expiresOn: null,
      today: TODAY,
      evidence: [{ reviewStatus: 'accepted', expiresOn: '2026-12-25' }],
    });
    expect(result.status).toBe('expiring');
    expect(result.nextExpiry).toBe('2026-12-25');
  });

  it('does not flag evidence beyond the warning window', () => {
    const result = controlGateCompliance({
      ownerUserId: null,
      expiresOn: null,
      today: TODAY,
      evidence: [{ reviewStatus: 'accepted', expiresOn: '2026-12-26' }],
    });
    expect(result.status).toBe('satisfied');
  });

  it('accepts evidence that expires today but expires it the next day', () => {
    expect(
      controlGateCompliance({
        ownerUserId: null,
        expiresOn: null,
        today: TODAY,
        evidence: [{ reviewStatus: 'accepted', expiresOn: TODAY }],
      }).status,
    ).toBe('expiring');
    expect(
      controlGateCompliance({
        ownerUserId: null,
        expiresOn: null,
        today: TODAY,
        evidence: [{ reviewStatus: 'accepted', expiresOn: '2026-11-24' }],
      }).status,
    ).toBe('expired');
  });

  it('never treats pending or rejected evidence as proof', () => {
    const pending = controlGateCompliance({
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      expiresOn: null,
      today: TODAY,
      evidence: [{ reviewStatus: 'pending', expiresOn: '2027-06-01' }],
    });
    expect(pending.status).toBe('pending_review');
    expect(pending.reasons[0]).toContain('awaits review');

    const rejected = controlGateCompliance({
      ownerUserId: '00000000-0000-4000-8000-000000000001',
      expiresOn: null,
      today: TODAY,
      evidence: [{ reviewStatus: 'rejected', expiresOn: '2027-06-01' }],
    });
    expect(rejected.status).toBe('in_progress');
    expect(rejected.reasons.join(' ')).toContain('was rejected');
  });

  it('uses an upcoming requirement expiry to warn or block the gate', () => {
    expect(
      controlGateCompliance({
        ownerUserId: null,
        expiresOn: '2026-12-01',
        today: TODAY,
        evidence: [],
      }).status,
    ).toBe('in_progress');

    expect(
      controlGateCompliance({
        ownerUserId: null,
        expiresOn: '2026-11-20',
        today: TODAY,
        evidence: [{ reviewStatus: 'accepted', expiresOn: null }],
      }).status,
    ).toBe('expired');

    expect(
      controlGateCompliance({
        ownerUserId: null,
        expiresOn: '2026-12-20',
        today: TODAY,
        evidence: [{ reviewStatus: 'accepted', expiresOn: null }],
      }).status,
    ).toBe('expiring');
  });

  it('reports a gate with no assignment as missing and labels every state', () => {
    const result = controlGateCompliance({
      ownerUserId: null,
      expiresOn: null,
      today: TODAY,
      evidence: [],
    });
    expect(result.status).toBe('missing');
    expect(result.reasons[0]).toContain('No owner');
    expect(CONTROL_COMPLIANCE_WARNING_DAYS).toBe(30);
    expect(controlComplianceLabel('pending_review')).toBe('Pending review');
  });
});
