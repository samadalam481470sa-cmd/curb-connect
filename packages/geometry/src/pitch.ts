// Roof pitch helpers (RF-027). Pitch is stored as rise/run plus the original input; a facet with
// pitch rise/run has slope factor sqrt(1 + (rise/run)^2) and sloped area = plan area * factor.
import { GeometryError, isFiniteNumber } from './numeric';

export interface Pitch {
  /** Vertical rise, any length unit (same as run). */
  readonly rise: number;
  /** Horizontal run, > 0. Conventionally 12 (rise per 12). */
  readonly run: number;
}

export function validatePitch(p: Pitch): void {
  if (!isFiniteNumber(p.rise) || !isFiniteNumber(p.run) || p.run <= 0 || p.rise < 0) {
    throw new GeometryError(
      'invalid_pitch',
      `pitch needs rise >= 0 and run > 0, got ${p.rise}/${p.run}`,
    );
  }
}

export function pitchRatio(p: Pitch): number {
  validatePitch(p);
  return p.rise / p.run;
}

/** Rise per 12 units of run (the "x/12" display). */
export function risePer12(p: Pitch): number {
  return pitchRatio(p) * 12;
}

export function pitchDegrees(p: Pitch): number {
  return (Math.atan(pitchRatio(p)) * 180) / Math.PI;
}

/** sqrt(1 + (rise/run)^2): sloped length per unit of plan length along the fall line. */
export function slopeFactor(p: Pitch): number {
  const r = pitchRatio(p);
  return Math.sqrt(1 + r * r);
}

/** Pitch from an angle in degrees, expressed per 12 of run. Angle must be in [0, 90). */
export function pitchFromDegrees(degrees: number): Pitch {
  if (!isFiniteNumber(degrees) || degrees < 0 || degrees >= 90) {
    throw new GeometryError('invalid_pitch', `angle must be in [0, 90), got ${degrees}`);
  }
  return { rise: Math.tan((degrees * Math.PI) / 180) * 12, run: 12 };
}

/** Sloped (true) area of a facet from its plan (horizontal projection) area. */
export function slopedArea(planArea: number, p: Pitch): number {
  if (!isFiniteNumber(planArea) || planArea < 0) {
    throw new GeometryError('invalid_argument', `plan area must be >= 0, got ${planArea}`);
  }
  return planArea * slopeFactor(p);
}

/**
 * True length of a straight edge on a sloped plane: plan length * sqrt(1 + (r * cos(theta))^2),
 * where theta is the plan angle between the edge and the facet's downslope direction. Gives
 * plan length for level edges (eave/ridge), plan * slope factor for rakes, and
 * plan * sqrt(1 + r^2/2) for a 45-degree hip/valley between equal pitches.
 */
export function trueEdgeLength(planLength: number, ratio: number, cosToDownslope: number): number {
  const k = ratio * cosToDownslope;
  return planLength * Math.sqrt(1 + k * k);
}
