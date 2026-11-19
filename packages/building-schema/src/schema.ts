// Parametric building model: every wall, opening, roof plane and system is a data object with
// dimensions and relationships. The AI proposes values; this schema is the validation boundary.
// All lengths are metres; all money is integer cents (no floating-point currency).
import { z } from 'zod';

const finitePositive = z.number().finite().positive();

export const ELEMENT_TYPES = [
  'wall',
  'door',
  'window',
  'floor',
  'roof',
  'beam',
  'column',
  'foundation',
] as const;

export const ElementType = z.enum(ELEMENT_TYPES);

export const Point2D = z.object({ x: z.number().finite(), y: z.number().finite() });

export const Level = z.object({
  index: z.number().int(),
  name: z.string().min(1).max(60),
  elevationM: z.number().finite(),
  heightM: finitePositive,
});

export const BuildingElement = z
  .object({
    id: z.uuid(),
    type: ElementType,
    name: z.string().min(1).max(120),
    level: z.number().int(),
    start: Point2D,
    end: Point2D,
    heightM: finitePositive,
    thicknessM: finitePositive,
    /** Area removed from a wall for openings (door/window) is tracked via `hostId`. */
    hostId: z.uuid().optional(),
    widthM: finitePositive.optional(),
    assemblyId: z.string().min(1).max(60).optional(),
  })
  .superRefine((el, ctx) => {
    if (el.start.x === el.end.x && el.start.y === el.end.y && el.type === 'wall') {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'wall has zero length' });
    }
    if ((el.type === 'door' || el.type === 'window') && !el.hostId) {
      ctx.addIssue({ code: 'custom', path: ['hostId'], message: `${el.type} must reference a host wall` });
    }
  });

export const HomeDesign = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string().min(1).max(160),
  /** Requested gross floor area, square feet (for comparison against modelled area). */
  targetAreaSqFt: finitePositive,
  budgetCents: z.number().int().nonnegative(),
  levels: z.array(Level).min(1).max(10),
  elements: z.array(BuildingElement).max(5000),
  version: z.number().int().positive(),
});

export type ElementType = z.infer<typeof ElementType>;
export type Level = z.infer<typeof Level>;
export type BuildingElement = z.infer<typeof BuildingElement>;
export type HomeDesign = z.infer<typeof HomeDesign>;
