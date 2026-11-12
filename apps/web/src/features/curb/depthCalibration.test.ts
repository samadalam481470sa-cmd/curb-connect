import { describe, expect, it } from 'vitest';
import { summarizeDepth, validDepthSamples, type DepthCalibration } from './depthCalibration';
const observations: DepthCalibration = {
  fullCutVerified: false,
  observations: [
    { id: '1', method: 'core', stationFt: 0, measuredIn: 7, date: '2026-11-10', notes: '' },
    { id: '2', method: 'probe', stationFt: 24, measuredIn: 9, date: '2026-11-10', notes: '' },
  ],
};
describe('site depth calibration', () => {
  it('does not treat spot probes as full-route verification', () => {
    expect(summarizeDepth(observations, 24)).toEqual({
      low: 7, base: 8, high: 9, verified: false, samples: 2,
    });
  });
  it('uses observed band only with full-route attestation and endpoint samples', () => {
    expect(summarizeDepth({ ...observations, fullCutVerified: true }, 24)?.verified).toBe(true);
    expect(summarizeDepth({ ...observations, fullCutVerified: true }, 25)?.verified).toBe(false);
  });
  it('ignores invalid values and stations outside the cut', () => {
    expect(validDepthSamples({ ...observations, observations: [
      observations.observations[0]!,
      { ...observations.observations[1]!, measuredIn: -5 },
    ] }, 24)).toHaveLength(1);
  });
});
