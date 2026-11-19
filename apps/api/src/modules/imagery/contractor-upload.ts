// Contractor upload registration: the media file is uploaded through the existing media module,
// then this service records the consent ledger row and the imagery candidate in one tenant
// transaction. The licence rights are stored verbatim and retention is converted into an absolute
// expiry, so the engine can exclude an asset after its consent period without guessing.
import type {
  ImageryKind,
  ImageryPerspective,
  ImageryQuality,
  RoofImageryRights,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import { consents, imageryAssets, mediaAssets } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

export type ContractorUploadRights = RoofImageryRights & { retentionDays: number };

export interface ContractorConsentInput {
  /** Person or organisation that granted permission, recorded in the consent evidence. */
  grantedBy: string;
  /** Signed form, upload consent screen or other reference. */
  source: string;
  policyVersion?: string | undefined;
  /** Non-secret supporting reference, e.g. a form id or document URL. */
  evidence?: Record<string, unknown> | undefined;
}

export interface RecordContractorUploadInput {
  orgId: string;
  propertyId: string;
  mediaAssetId: string;
  providerImageId?: string | undefined;
  kind?: ImageryKind | undefined;
  quality?: ImageryQuality | undefined;
  perspective?: ImageryPerspective | undefined;
  orthorectified?: boolean | undefined;
  captureDate?: string | undefined;
  gsdM?: number | undefined;
  rights: ContractorUploadRights;
  attribution: string;
  consent: ContractorConsentInput;
}

export type ImageryAssetRow = typeof imageryAssets.$inferSelect;
export type MediaRow = typeof mediaAssets.$inferSelect;

function defaultKind(kind: MediaRow['kind']): ImageryKind {
  switch (kind) {
    case 'drone_image':
      return 'drone_photo';
    case 'blueprint':
    case 'document':
      return 'blueprint';
    default:
      return 'orthophoto';
  }
}

export async function recordContractorUpload(
  tx: Tx,
  input: RecordContractorUploadInput,
): Promise<ImageryAssetRow> {
  if (!input.rights.storageAllowed) {
    throw problem(
      'imagery_rights_denied',
      'The contractor consent must allow storing this imagery before it can be registered.',
    );
  }

  const [media] = await tx
    .select({
      id: mediaAssets.id,
      status: mediaAssets.status,
      ownerType: mediaAssets.ownerType,
      ownerId: mediaAssets.ownerId,
      kind: mediaAssets.kind,
      originalObjectKey: mediaAssets.originalObjectKey,
      sanitizedObjectKey: mediaAssets.sanitizedObjectKey,
      widthPx: mediaAssets.widthPx,
      heightPx: mediaAssets.heightPx,
      capturedAt: mediaAssets.capturedAt,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.orgId, input.orgId),
        eq(mediaAssets.id, input.mediaAssetId),
        eq(mediaAssets.ownerType, 'property'),
        eq(mediaAssets.ownerId, input.propertyId),
      ),
    )
    .limit(1);

  if (!media) {
    throw problem('not_found', 'No media asset exists for this property.');
  }
  if (media.status !== 'ready') {
    throw problem(
      'conflict',
      'Finish processing the media asset before registering it as analysis imagery.',
    );
  }
  if (media.kind === 'video' || media.kind === 'export') {
    throw problem('validation_failed', 'Only photos, drone images or plans can be registered.');
  }

  const [duplicate] = await tx
    .select({ id: imageryAssets.id })
    .from(imageryAssets)
    .where(
      and(
        eq(imageryAssets.orgId, input.orgId),
        eq(imageryAssets.provider, 'contractor_upload'),
        eq(imageryAssets.mediaAssetId, media.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw problem('duplicate', 'This media asset is already registered as contractor imagery.');
  }

  const retentionExpiresAt = new Date(
    Date.now() + input.rights.retentionDays * 24 * 60 * 60 * 1000,
  );
  const [consent] = await tx
    .insert(consents)
    .values({
      orgId: input.orgId,
      kind: 'imagery_analysis',
      status: 'granted',
      source: input.consent.source,
      policyVersion: input.consent.policyVersion ?? null,
      evidence: {
        ...input.consent.evidence,
        grantedBy: input.consent.grantedBy,
        propertyId: input.propertyId,
        mediaAssetId: media.id,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
        rights: input.rights,
      },
    })
    .returning({ id: consents.id });

  if (!consent) throw new Error('Consent insert returned no row.');

  const [asset] = await tx
    .insert(imageryAssets)
    .values({
      orgId: input.orgId,
      propertyId: input.propertyId,
      provider: 'contractor_upload',
      providerImageId: input.providerImageId ?? media.id,
      mediaAssetId: media.id,
      consentId: consent.id,
      kind: input.kind ?? defaultKind(media.kind),
      status: 'candidate',
      rights: input.rights,
      attribution: input.attribution,
      gsdM: input.gsdM === undefined ? null : String(input.gsdM),
      captureDate:
        input.captureDate ??
        (media.capturedAt ? media.capturedAt.toISOString().slice(0, 10) : null),
      quality: input.quality ?? 'unknown',
      perspective: input.perspective ?? 'unknown',
      orthorectified: input.orthorectified ?? null,
      objectKey: media.sanitizedObjectKey ?? media.originalObjectKey,
      widthPx: media.widthPx,
      heightPx: media.heightPx,
      expiresAt: retentionExpiresAt,
    })
    .returning();

  if (!asset) throw new Error('Contractor imagery insert returned no row.');
  return asset;
}
