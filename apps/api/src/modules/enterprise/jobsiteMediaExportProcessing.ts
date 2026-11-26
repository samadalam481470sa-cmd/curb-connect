import {
  effectivePermissions,
  isAction,
  JOBSITE_MEDIA_EXPORT_MAX_BYTES,
  type JobsiteExportItem,
} from '@fieldline/contracts';
import { renderToBuffer } from '@fieldline/pdf';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Tx } from '../../db/runtime';
import { enterpriseProjects, enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseMediaExports as mediaExports } from '../../db/schema/enterpriseMediaExports';
import { organizations } from '../../db/schema/orgs';
import { memberships, permissionOverrides } from '../../db/schema/team';
import { flagsFor } from '../../services/flags';
import type { StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import { latestMediaProjectGrant } from './jobsiteMediaAccess';
import {
  jobsitePhotoAnnotationKey,
  jobsitePhotoKey,
  jobsiteVideoPlaybackKey,
} from './jobsiteMediaStorage';
import { archiveJobsiteMedia } from './jobsiteMediaExportZip';

type ExportRow = typeof mediaExports.$inferSelect;
export type ExportScope = { orgId: string; projectId: string; exportId: string };

export function jobsiteMediaExportKey(scope: ExportScope, sha256: string) {
  return (
    'orgs/' + scope.orgId + '/enterprise/jobsite-media-exports/' + scope.exportId + '/' + sha256
  );
}

function exportScope(scope: ExportScope) {
  return and(
    eq(mediaExports.orgId, scope.orgId),
    eq(mediaExports.projectId, scope.projectId),
    eq(mediaExports.id, scope.exportId),
  );
}

async function jobsiteExportRequesterAccess(tx: Tx, row: ExportRow) {
  const [member] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, row.orgId),
        eq(memberships.id, row.requesterMembershipId),
        eq(memberships.userId, row.requesterUserId),
        eq(memberships.status, 'active'),
      ),
    );
  if (!member) return false;
  const overrides = await tx
    .select({
      action: permissionOverrides.action,
      effect: permissionOverrides.effect,
      expiresAt: permissionOverrides.expiresAt,
    })
    .from(permissionOverrides)
    .where(
      and(
        eq(permissionOverrides.orgId, row.orgId),
        eq(permissionOverrides.membershipId, row.requesterMembershipId),
      ),
    );
  const permissions = effectivePermissions(
    member.role,
    overrides.flatMap(({ action, effect, expiresAt }) =>
      isAction(action) ? [{ action, effect, expiresAt: expiresAt?.toISOString() ?? null }] : [],
    ),
  );
  if (!permissions.has('enterprise_media:read') || !permissions.has('export:create')) return false;
  const flags = await flagsFor(tx, row.orgId);
  if (!flags['enterprise.jobsite_media']) return false;
  const [setting] = await tx
    .select({ enabled: enterpriseSettings.enabled })
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, row.orgId));
  if (!setting?.enabled) return false;
  if (permissions.has('enterprise_media:manage_grants')) return true;
  return (
    (await latestMediaProjectGrant(tx, row.orgId, row.projectId, row.requesterMembershipId))
      ?.active === true
  );
}

export async function claimJobsiteMediaExport(tx: Tx, scope: ExportScope) {
  const [row] = await tx.select().from(mediaExports).where(exportScope(scope)).for('update');
  if (!row || row.status === 'ready' || row.status === 'failed') return null;
  if (!(await jobsiteExportRequesterAccess(tx, row))) {
    await tx
      .update(mediaExports)
      .set({ status: 'failed', failureCode: 'permission_lost', completedAt: new Date() })
      .where(exportScope(scope));
    return null;
  }
  const [company] = await tx
    .select({ companyName: organizations.displayName, projectName: enterpriseProjects.name })
    .from(enterpriseProjects)
    .innerJoin(organizations, eq(organizations.id, enterpriseProjects.orgId))
    .where(
      and(eq(enterpriseProjects.orgId, scope.orgId), eq(enterpriseProjects.id, scope.projectId)),
    );
  if (!company) return null;
  if (row.status !== 'processing')
    await tx.update(mediaExports).set({ status: 'processing' }).where(exportScope(scope));
  return { row, company };
}

type Processed =
  { status: 'ready'; sha256: string; byteSize: number } | { status: 'failed'; failureCode: string };

export async function finishJobsiteMediaExport(tx: Tx, scope: ExportScope, result: Processed) {
  const [row] = await tx.select().from(mediaExports).where(exportScope(scope)).for('update');
  if (!row || row.status !== 'processing') return;
  const output: Processed = (await jobsiteExportRequesterAccess(tx, row))
    ? result
    : { status: 'failed', failureCode: 'permission_lost' };
  await tx
    .update(mediaExports)
    .set({ ...output, completedAt: new Date() })
    .where(exportScope(scope));
}

function fileAddress(row: ExportRow, file: JobsiteExportItem, appOrigin: string) {
  const base = '/v1/enterprise/projects/' + row.projectId + '/media/' + file.mediaId;
  switch (file.source) {
    case 'annotation':
      if (!file.revision) throw new Error('media_export_source_unavailable');
      return {
        key: jobsitePhotoAnnotationKey(row.orgId, file.mediaId, file.revision, file.sha256),
        href: new URL(base + '/annotations/' + file.revision + '/image', appOrigin).href,
      };
    case 'playback':
      return {
        key: jobsiteVideoPlaybackKey(row.orgId, file.mediaId),
        href: new URL(base + '/playback', appOrigin).href,
      };
    case 'original':
      return {
        key: jobsitePhotoKey(row.orgId, file.mediaId),
        href: new URL(base + '/original', appOrigin).href,
      };
  }
}

export async function generateJobsiteMediaExport(
  storage: StorageAdapter,
  appOrigin: string,
  scope: ExportScope,
  value: NonNullable<Awaited<ReturnType<typeof claimJobsiteMediaExport>>>,
): Promise<Processed> {
  const { row, company } = value;
  const files: { source: JobsiteExportItem; bytes: Buffer; href: string }[] = [];
  let size = 0;
  for (const source of row.manifest) {
    size += source.byteSize;
    if (size >= JOBSITE_MEDIA_EXPORT_MAX_BYTES)
      return { status: 'failed', failureCode: 'too_large' };
    const address = fileAddress(row, source, appOrigin);
    const bytes = await storage.get(address.key);
    if (bytes.length !== source.byteSize || sha256Hex(bytes) !== source.sha256)
      return { status: 'failed', failureCode: 'checksum_mismatch' };
    files.push({ source, bytes, href: address.href });
  }
  const createdAt = row.createdAt.toISOString();
  let content: Buffer;
  if (row.format === 'zip') {
    content = archiveJobsiteMedia(row.id, row.projectId, createdAt, files);
  } else {
    const entries = [];
    for (const { source, bytes, href } of files) {
      let thumbnail: string | null = null;
      if (source.mimeType.startsWith('image/')) {
        const image = await sharp(bytes, { limitInputPixels: 100_000_000 })
          .rotate()
          .resize(880, 880, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 83 })
          .toBuffer();
        thumbnail = 'data:image/jpeg;base64,' + image.toString('base64');
      }
      entries.push({ ...source, thumbnail, href });
    }
    const rendered = await renderToBuffer({
      kind: 'jobsite_media_package',
      meta: {
        documentId: row.id,
        revision: 1,
        issuedAt: createdAt,
        organization: { name: company.companyName },
      },
      projectName: company.projectName,
      files: entries,
    });
    content = rendered.buffer;
  }
  if (content.length > JOBSITE_MEDIA_EXPORT_MAX_BYTES)
    return { status: 'failed', failureCode: 'too_large' };
  const sha256 = sha256Hex(content);
  await storage.put(
    jobsiteMediaExportKey(scope, sha256),
    content,
    row.format === 'zip' ? 'application/zip' : 'application/pdf',
  );
  return { status: 'ready', sha256, byteSize: content.length };
}
