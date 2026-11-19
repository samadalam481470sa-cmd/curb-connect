// Roof damage photo check. POST one photo; a vision model reports visible roofing damage. Optional
// cost uses the roofer's measured area and own rate (see costing.ts). Photos are analyzed in memory
// and not stored. Results are observations to be confirmed on site.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { AnalysisUnavailable, analyzeRoofPhoto, anthropicVisionProvider, DamageReport, type ImageInput } from './analyzer';
import { CostRequest, estimateRepairCost } from './costing';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const BODY = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  /** Base64 without a data: prefix. Decoded size is capped at 6 MB. */
  imageBase64: z.string().min(16).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4),
  repairAreaSqFt: CostRequest.shape.repairAreaSqFt.optional(),
  ratePerSqFtCents: CostRequest.shape.ratePerSqFtCents.optional(),
  contingencyPercent: CostRequest.shape.contingencyPercent.optional(),
});

const RESPONSE = z.object({
  report: DamageReport,
  cost: z
    .object({
      repairAreaSqFt: z.number(),
      ratePerSqFtCents: z.number(),
      subtotalCents: z.number(),
      contingencyCents: z.number(),
      totalCents: z.number(),
      basis: z.string(),
    })
    .nullable(),
  disclaimer: z.string(),
});

/** Check the first bytes match the declared type, so a renamed file is not sent as an image. */
export function sniffMediaType(bytes: Buffer): ImageInput['mediaType'] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export const DISCLAIMER =
  'Visual check from a photo only. It does not replace an on-site inspection, cannot see under the shingles or in the decking, and is not an engineering or warranty decision.';

const roofDamageModule: FastifyPluginAsyncZod = async (app) => {
  app.post('/roof/damage-analysis', {
    config: { permission: 'roof_report:read', rateLimit: { max: 20, timeWindow: '1 minute' } },
    bodyLimit: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024,
    schema: {
      tags: ['roof'],
      summary: 'Analyze one roof-damage photo for visible roofing defects; optional repair cost from measured area',
      body: BODY,
      response: { 200: RESPONSE },
    },
  }, async (request) => {
    requireOrg(request);
    const { anthropicApiKey, model } = request.server.config.roofDamage;
    if (!anthropicApiKey) {
      throw problem('dependency_unavailable', 'Photo damage analysis is not configured on this server (no vision model key).', {
        retryable: false,
      });
    }

    const bytes = Buffer.from(request.body.imageBase64, 'base64');
    if (bytes.length === 0) throw problem('validation_failed', 'Image is empty.');
    if (bytes.length > MAX_IMAGE_BYTES) throw problem('payload_too_large', 'Photo is larger than 6 MB.');
    const actual = sniffMediaType(bytes);
    if (actual !== request.body.mediaType) {
      throw problem('unsupported_media_type', 'Photo content does not match its declared type (JPEG, PNG or WebP only).');
    }

    let report: DamageReport;
    try {
      report = await analyzeRoofPhoto(
        anthropicVisionProvider({ apiKey: anthropicApiKey, model }),
        { mediaType: actual, base64: request.body.imageBase64 },
      );
    } catch (err) {
      if (err instanceof AnalysisUnavailable) {
        throw problem('dependency_unavailable', 'The photo could not be analyzed right now. Try again or inspect on site.', {
          retryable: true,
        });
      }
      throw err;
    }

    const wantsCost = request.body.repairAreaSqFt !== undefined && request.body.ratePerSqFtCents !== undefined;
    const cost = wantsCost
      ? estimateRepairCost({
          repairAreaSqFt: request.body.repairAreaSqFt!,
          ratePerSqFtCents: request.body.ratePerSqFtCents!,
          contingencyPercent: request.body.contingencyPercent ?? 10,
        })
      : null;

    return { report, cost, disclaimer: DISCLAIMER };
  });
};

export default roofDamageModule;
