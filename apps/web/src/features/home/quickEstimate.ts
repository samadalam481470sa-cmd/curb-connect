// Turns a plain-language request ("re-roof 2,400 sq ft at 8/12 with 3 curbs, 12% waste") into a
// roof takeoff using the same takeoff engine as the Roof workspace. Anything the sentence does not
// state is an explicit default, and the result says which values were assumed.
import { roofTakeoff, type RoofResult } from '../roof/roofTakeoff';

export const DEFAULT_PITCH = 6;
export const DEFAULT_WASTE = 10;
const MAX_SQ_FT = 500_000;

export interface QuickEstimateInput {
  planSqFt: number;
  pitch: number;
  wastePercent: number;
  curbs: number;
  assumed: { pitch: boolean; waste: boolean };
}

export type ParseResult = { ok: true; input: QuickEstimateInput } | { ok: false; error: string };

function num(text: string): number {
  return Number(text.replace(/,/g, ''));
}

/** Parses the request; returns a readable error instead of guessing the roof area. */
export function parseQuickEstimate(text: string): ParseResult {
  const source = text.trim().toLowerCase();
  const sqft = /(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square\s+feet|sf)\b/.exec(source);
  if (!sqft) return { ok: false, error: 'Include the roof area, for example "2,400 sq ft".' };
  const planSqFt = num(sqft[1] ?? '');
  if (!Number.isFinite(planSqFt) || planSqFt <= 0 || planSqFt > MAX_SQ_FT) {
    return { ok: false, error: 'Roof area must be between 1 and 500,000 sq ft.' };
  }

  const pitchMatch = /(\d{1,2})\s*\/\s*12\b|pitch\s+(\d{1,2})\b/.exec(source);
  const pitchValue = pitchMatch ? Number(pitchMatch[1] ?? pitchMatch[2]) : null;
  if (pitchValue !== null && (pitchValue < 1 || pitchValue > 24)) {
    return { ok: false, error: 'Pitch must be between 1/12 and 24/12.' };
  }

  const wasteMatch = /waste\s*(\d{1,2}(?:\.\d+)?)\s*%|(\d{1,2}(?:\.\d+)?)\s*%\s*waste/.exec(source);
  const wasteValue = wasteMatch ? Number(wasteMatch[1] ?? wasteMatch[2]) : null;
  if (wasteValue !== null && (wasteValue < 0 || wasteValue > 40)) {
    return { ok: false, error: 'Waste must be between 0% and 40%.' };
  }

  const curbMatch = /(\d{1,3})\s*(?:curbs?|skylights?|penetrations?)\b/.exec(source);
  const curbs = curbMatch ? Number(curbMatch[1]) : 0;

  return {
    ok: true,
    input: {
      planSqFt,
      pitch: pitchValue ?? DEFAULT_PITCH,
      wastePercent: wasteValue ?? DEFAULT_WASTE,
      curbs,
      assumed: { pitch: pitchValue === null, waste: wasteValue === null },
    },
  };
}

export interface QuickEstimate {
  input: QuickEstimateInput;
  roof: RoofResult;
  /** Counted only; curb flashing is not priced here. */
  curbs: number;
}

export function buildQuickEstimate(input: QuickEstimateInput): QuickEstimate {
  const roof = roofTakeoff(
    [
      {
        id: 'quick-main',
        name: 'Main roof (quick estimate)',
        lengthFt: 0,
        runFt: 0,
        pitch: input.pitch,
        planSqFtOverride: input.planSqFt,
      },
    ],
    input.wastePercent,
  );
  return { input, roof, curbs: input.curbs };
}
