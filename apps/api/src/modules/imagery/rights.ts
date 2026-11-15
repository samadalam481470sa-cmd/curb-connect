// Imagery rights engine (RF-022 D/S, RR-031, COS-202, ADD-020, ADD-035). Pure: takes the license
// stored with an asset and decides each use independently. Callers MUST ask before inference
// (analyze), caching pixels/thumbnails (cache), PDF embedding (embed_in_exports) and sharing
// (redistribute). A visualization-only source (Esri/Google basemaps) is denied everything except
// visualize, so it can never feed automated analysis or exports.
import { IMAGERY_USES, type ImageryLicense, ImageryLicenseSchema, type ImageryUse, type RightsDecision } from '@fieldline/contracts';
import { problem } from '../../http/problem';

const FIELD: Record<ImageryUse, keyof Pick<ImageryLicense, 'visualize' | 'analyze' | 'cache' | 'embedInExports' | 'redistribute'>> = {
  visualize: 'visualize',
  analyze: 'analyze',
  cache: 'cache',
  embed_in_exports: 'embedInExports',
  redistribute: 'redistribute',
};

export function parseLicense(raw: unknown): ImageryLicense | null {
  const parsed = ImageryLicenseSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** RF-022-API: one decision per use; unknown/legacy rights documents deny everything. */
export function decide(license: ImageryLicense | null, use: ImageryUse, now = new Date()): RightsDecision {
  if (!license) return { use, allowed: false, reason: 'rights_unknown' };
  if (license.expiresAt && new Date(license.expiresAt).getTime() <= now.getTime()) {
    return { use, allowed: false, reason: 'license_expired' };
  }
  if (!license[FIELD[use]]) return { use, allowed: false, reason: `license_forbids_${use}` };
  return { use, allowed: true, reason: license.assertedBy ? 'asserted_by_uploader' : 'licensed' };
}

export function decideAll(license: ImageryLicense | null, now = new Date()): RightsDecision[] {
  return IMAGERY_USES.map((u) => decide(license, u, now));
}

/** Throws 403 imagery_rights_denied / imagery_license_expired when the use is not allowed. */
export function assertUse(license: ImageryLicense | null, use: ImageryUse, now = new Date()): void {
  const d = decide(license, use, now);
  if (d.allowed) return;
  if (d.reason === 'license_expired') throw problem('imagery_license_expired', `The imagery license expired; ${use} is not allowed.`);
  throw problem('imagery_rights_denied', `The imagery license does not allow ${use} (${d.reason}).`);
}
