// Satellite roof sections for the quote builder: Google Solar API building insights turned into
// roof sections (sloped area in sq ft and pitch as rise per 12). Structured numbers only; no
// imagery is stored. Results are marked as estimates until the roof is measured on site.
import type { BuildingInsights } from '../imagery/providers/types';

export interface SatelliteSection {
  name: string;
  slopedSqFt: number;
  planSqFt: number | null;
  pitch: number;
  azimuthDegrees: number | null;
}

const SQFT_PER_M2 = 10.7639;

export function pitchFromDegrees(deg: number): number {
  return Math.round(Math.tan((Math.max(0, Math.min(80, deg)) * Math.PI) / 180) * 12 * 2) / 2;
}

export function sectionsFromInsights(insights: BuildingInsights): {
  sections: SatelliteSection[];
  totalSqFt: number;
} {
  const sections = insights.roofSegments
    .filter((s) => (s.areaM2 ?? 0) > 1)
    .map((s, i) => ({
      name: `Section ${String.fromCharCode(65 + (i % 26))}`,
      slopedSqFt: Math.round((s.areaM2 ?? 0) * SQFT_PER_M2),
      planSqFt: s.groundAreaM2 === null ? null : Math.round(s.groundAreaM2 * SQFT_PER_M2),
      pitch: pitchFromDegrees(s.pitchDegrees ?? 0),
      azimuthDegrees: s.azimuthDegrees,
    }));
  const total = insights.wholeRoofAreaM2
    ? Math.round(insights.wholeRoofAreaM2 * SQFT_PER_M2)
    : sections.reduce((a, s) => a + s.slopedSqFt, 0);
  return { sections, totalSqFt: total };
}
