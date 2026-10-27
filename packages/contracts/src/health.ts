import { z } from 'zod';

/** Liveness payload for GET /v1/health. Readiness (database reachable) is reported separately. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  version: z.string().min(1),
  time: z.iso.datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'failed', 'not_configured'])),
});
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
