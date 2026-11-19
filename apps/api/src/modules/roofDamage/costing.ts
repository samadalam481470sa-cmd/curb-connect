// Repair cost from MEASURED quantities and the roofer's OWN unit rate. A photo cannot measure area
// reliably, so the photo analysis never produces a dollar figure by itself. The roofer enters the
// repair area they measured and their $/sq ft rate; this module does integer-cent arithmetic only.
import { z } from 'zod';

export const CostRequest = z.object({
  repairAreaSqFt: z.number().finite().positive().max(100_000),
  /** Roofer's own installed rate per square foot, in integer cents. */
  ratePerSqFtCents: z.number().int().positive().max(100_000),
  /** Contingency applied to the subtotal, percent. */
  contingencyPercent: z.number().finite().min(0).max(50).default(10),
});
export type CostRequest = z.infer<typeof CostRequest>;

export interface CostEstimate {
  repairAreaSqFt: number;
  ratePerSqFtCents: number;
  subtotalCents: number;
  contingencyCents: number;
  totalCents: number;
  basis: string;
}

export function estimateRepairCost(input: CostRequest): CostEstimate {
  const req = CostRequest.parse(input);
  // Round the area to whole square feet first so the cents total is exact and reproducible.
  const area = Math.round(req.repairAreaSqFt);
  const subtotalCents = area * req.ratePerSqFtCents;
  const contingencyCents = Math.round((subtotalCents * req.contingencyPercent) / 100);
  return {
    repairAreaSqFt: area,
    ratePerSqFtCents: req.ratePerSqFtCents,
    subtotalCents,
    contingencyCents,
    totalCents: subtotalCents + contingencyCents,
    basis: `${area} sq ft × your rate + ${req.contingencyPercent}% contingency. Area and rate are user-supplied; the photo does not set them.`,
  };
}
