/**
 * Field observations are evidence, not a subsurface scan or a structural certification.
 * Measurements require a named location and date; samples cannot establish depths
 * between holes without a documented full-route verification.
 */
export interface DepthSample {
  id: string;
  method: 'core' | 'probe';
  stationFt: number;
  measuredIn: number;
  date: string;
  notes: string;
}
export interface DepthCalibration {
  observations: DepthSample[];
  /** Only an authorized site observer can attest that the entire proposed cut is covered. */
  fullCutVerified: boolean;
}
export function validDepthSamples(data: DepthCalibration | undefined, cutLengthFt: number): DepthSample[] {
  if (!data || !Number.isFinite(cutLengthFt) || cutLengthFt <= 0) return [];
  return data.observations.filter((sample) =>
    (sample.method === 'probe' || sample.method === 'core') &&
    Number.isFinite(sample.stationFt) &&
    sample.stationFt >= 0 &&
    sample.stationFt <= cutLengthFt &&
    Number.isFinite(sample.measuredIn) &&
    sample.measuredIn > 0 && sample.measuredIn <= 60 &&
    /^\d{4}-\d{2}-\d{2}$/.test(sample.date) &&
    !Number.isNaN(Date.parse(sample.date)),
  ).sort((a, b) => a.stationFt - b.stationFt);
}
export function summarizeDepth(
  data: DepthCalibration | undefined,
  cutLengthFt: number,
): { low: number; base: number; high: number; verified: boolean; samples: number } | null {
  const samples = validDepthSamples(data, cutLengthFt);
  if (samples.length === 0) return null;
  const values = samples.map((sample) => sample.measuredIn).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const base = values.length % 2
    ? values[middle]!
    : (values[middle - 1]! + values[middle]!) / 2;
  const spansEndpoints = samples.length >= 2 &&
    samples[0]!.stationFt === 0 &&
    samples[samples.length - 1]!.stationFt === cutLengthFt;
  return {
    low: values[0]!,
    base,
    high: values[values.length - 1]!,
    // Full-route attestation plus endpoint samples are required; it is still observational.
    verified: Boolean(data?.fullCutVerified && spansEndpoints),
    samples: samples.length,
  };
}
