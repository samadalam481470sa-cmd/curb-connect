/** Evidence-informed cut-depth calibration. Never treats a spot probe as a continuous as-built depth. */
export type DepthMethod = 'core' | 'probe' | 'documented_as_built';
export interface DepthReading {
  id: string;
  stationFt: number;
  depthIn: number;
  method: DepthMethod;
  recordedAt: string;
  note: string;
}
export interface DepthCalibration {
  count: number;
  baseIn: number;
  lowIn: number;
  highIn: number;
  sampleMinIn: number | null;
  sampleMaxIn: number | null;
  stationsFt: number[];
  outOfRange: boolean;
  remainsBounded: true;
}
export function calibrateDepth(
  pathLengthFt: number,
  lowIn: number,
  baseIn: number,
  highIn: number,
  readings: readonly DepthReading[],
): DepthCalibration {
  if (![pathLengthFt, lowIn, baseIn, highIn].every(Number.isFinite) ||
      pathLengthFt <= 0 || lowIn <= 0 || highIn < lowIn || baseIn < lowIn || baseIn > highIn) {
    throw new Error('A positive path length and ordered 6–10 in depth bounds are required.');
  }
  const stations = new Set<number>();
  for (const reading of readings) {
    if (!Number.isFinite(reading.stationFt) || reading.stationFt < 0 ||
        reading.stationFt > pathLengthFt ||
        !Number.isFinite(reading.depthIn) || reading.depthIn <= 0 || reading.depthIn > 120 ||
        !['core', 'probe', 'documented_as_built'].includes(reading.method)) {
      throw new Error('A depth observation is outside the permitted measurement range.');
    }
    if (stations.has(reading.stationFt)) throw new Error('Each path station needs a unique observation.');
    stations.add(reading.stationFt);
  }
  const measured = readings.map(r => r.depthIn).sort((a, b) => a - b);
  const lowMeasured = measured[0] ?? null;
  const highMeasured = measured.at(-1) ?? null;
  // Conservative bounds expand for unexpected readings; never contract based on spot samples.
  const low = lowMeasured === null ? lowIn : Math.min(lowIn, lowMeasured);
  const high = highMeasured === null ? highIn : Math.max(highIn, highMeasured);
  const middle = measured.length === 0 ? baseIn :
    measured.length % 2 === 1 ? measured[(measured.length - 1) / 2]! :
    (measured[measured.length / 2 - 1]! + measured[measured.length / 2]!) / 2;
  return {
    count: measured.length,
    baseIn: middle,
    lowIn: low,
    highIn: high,
    sampleMinIn: lowMeasured,
    sampleMaxIn: highMeasured,
    stationsFt: [...stations].sort((a, b) => a - b),
    outOfRange: low !== lowIn || high !== highIn,
    remainsBounded: true,
  };
}
