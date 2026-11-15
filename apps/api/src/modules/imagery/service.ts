// Imagery persistence (RR-031, COS-202, COS-213, ADD-022, ADD-024). Candidates from providers are
// stored with their license rights; contractor uploads (drone photos, blueprints) carry rights the
// uploader asserted. An asset without a georeference/scale is uncalibrated and may be shown but
// never measured from (RR-031 S).
import type { ImageryAsset, ImageryLicense } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { imageryAssets } from '../../db/schema';
import { problem } from '../../http/problem';
import { decideAll, parseLicense } from './rights';

export type ImageryRow = typeof imageryAssets.$inferSelect;

export function isCalibrated(row: Pick<ImageryRow, 'georef' | 'gsdM'>): boolean {
  const g = row.georef as Record<string, unknown> | null;
  return Boolean(g && (g.metersPerPixel || g.controlPoints || g.scale) && (row.gsdM !== null || g.metersPerPixel || g.scale));
}

export function imageryDto(row: ImageryRow, now = new Date()): ImageryAsset {
  const license = parseLicense(row.rights);
  const rights: ImageryLicense = license ?? {
    rightsVersion: 1,
    visualize: false,
    analyze: false,
    cache: false,
    embedInExports: false,
    redistribute: false,
    expiresAt: null,
    attributionRequired: true,
    licenseRef: null,
    assertedBy: null,
    isSynthetic: false,
  };
  return {
    id: row.id,
    propertyId: row.propertyId,
    provider: row.provider,
    providerImageId: row.providerImageId,
    kind: row.kind,
    status: row.status,
    rights,
    decisions: decideAll(license, now),
    attribution: row.attribution,
    gsdM: row.gsdM === null ? null : Number(row.gsdM),
    captureDate: row.captureDate,
    georef: (row.georef as Record<string, unknown> | null) ?? null,
    calibrated: isCalibrated(row),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    isSynthetic: rights.isSynthetic,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadImagery(tx: Tx, orgId: string, id: string): Promise<ImageryRow | null> {
  const [row] = await tx.select().from(imageryAssets).where(and(eq(imageryAssets.orgId, orgId), eq(imageryAssets.id, id)));
  return row ?? null;
}

export async function requireImagery(tx: Tx, orgId: string, id: string): Promise<ImageryRow> {
  const row = await loadImagery(tx, orgId, id);
  if (!row) throw problem('not_found', 'Imagery asset not found.');
  return row;
}
