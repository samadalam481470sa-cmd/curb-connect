// Requirement IDs for traceability (handoff: "IDs like CV-045-FE, CP-052-API").
// Format: <AREA>-<PAGE 3 digits>[-<LAYER>], e.g. RR-037, CP-059-API, PLT-011-FE.
import { z } from 'zod';

export const REQUIREMENT_AREAS = {
  STR: 'Strategy and product scope',
  PLT: 'Platform, tenancy and navigation',
  RR: 'Roof reports and measurement',
  CV: 'Computer vision and models',
  CP: 'Curb cutting and pricing',
  OPS: 'Business operations (CRM, jobs, proposals, billing)',
  BE: 'Backend, data and integrations',
  SEC: 'Security, privacy and compliance',
  QA: 'Quality, testing and release',
} as const;
export type RequirementArea = keyof typeof REQUIREMENT_AREAS;

export const REQUIREMENT_LAYERS = ['API', 'FE', 'DB', 'JOB', 'PDF', 'ML', 'QA', 'DOC'] as const;
export type RequirementLayer = (typeof REQUIREMENT_LAYERS)[number];

export const REQUIREMENT_ID_PATTERN = /^(STR|PLT|RR|CV|CP|OPS|BE|SEC|QA)-(\d{3})(?:-(API|FE|DB|JOB|PDF|ML|QA|DOC))?$/;
export const RequirementIdSchema = z.string().regex(REQUIREMENT_ID_PATTERN);
export type RequirementId = z.infer<typeof RequirementIdSchema>;

export interface ParsedRequirementId {
  area: RequirementArea;
  page: number;
  layer?: RequirementLayer;
}

export function requirementId(area: RequirementArea, page: number, layer?: RequirementLayer): string {
  if (!Number.isInteger(page) || page < 1 || page > 999) throw new RangeError(`invalid page ${page}`);
  const base = `${area}-${String(page).padStart(3, '0')}`;
  return layer ? `${base}-${layer}` : base;
}

export function parseRequirementId(id: string): ParsedRequirementId | null {
  const m = REQUIREMENT_ID_PATTERN.exec(id);
  if (!m) return null;
  return {
    area: m[1] as RequirementArea,
    page: Number(m[2]),
    ...(m[3] ? { layer: m[3] as RequirementLayer } : {}),
  };
}

export function isRequirementId(id: string): boolean {
  return REQUIREMENT_ID_PATTERN.test(id);
}

/** Drops the layer suffix: CP-059-API -> CP-059. */
export function baseRequirementId(id: string): string | null {
  const p = parseRequirementId(id);
  return p ? requirementId(p.area, p.page) : null;
}
