import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { JOB_STATUS_LINK_MAX_DAYS } from '../portal/jobStatus';
import { contacts, customers } from '../../db/schema/crm';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import {
  enterpriseMediaCustomerPhotoApprovals as approvals,
  enterpriseMediaCustomerPhotoPreviews as previews,
} from '../../db/schema/enterpriseMediaCustomerPhoto';
import { enterpriseMediaHomeownerRecipients as recipients } from '../../db/schema/enterpriseMediaHomeowner';

export type HomeownerProjectScope = { orgId: string; projectId: string };
export const JOBSITE_GALLERY_MAX_DAYS = JOB_STATUS_LINK_MAX_DAYS;

export function newJobsiteGalleryToken() {
  return randomBytes(32).toString('base64url');
}

export function jobsiteGalleryTokenHash(token: string) {
  return createHash('sha256')
    .update('jobsite-gallery:' + token)
    .digest('hex');
}

export function jobsiteGalleryUrl(appOrigin: string, projectId: string, token: string) {
  const url = new URL('/portal/homeowner/projects/' + projectId + '/gallery', appOrigin);
  url.hash = new URLSearchParams({ t: token }).toString();
  return url.href;
}

export async function findActiveHomeownerContact(tx: Tx, orgId: string, contactId: string) {
  const [contact] = await tx
    .select({ id: contacts.id, displayName: contacts.displayName })
    .from(contacts)
    .innerJoin(
      customers,
      and(
        eq(customers.orgId, contacts.orgId),
        eq(customers.id, contacts.customerId),
        eq(customers.status, 'active'),
        isNull(customers.deletedAt),
      ),
    )
    .where(
      and(
        eq(contacts.orgId, orgId),
        eq(contacts.id, contactId),
        eq(contacts.status, 'active'),
        isNull(contacts.deletedAt),
      ),
    );
  return contact;
}

export async function latestHomeownerRecipient(
  tx: Tx,
  scope: HomeownerProjectScope,
  contactId: string,
) {
  const [recipient] = await tx
    .select()
    .from(recipients)
    .where(
      and(
        eq(recipients.orgId, scope.orgId),
        eq(recipients.projectId, scope.projectId),
        eq(recipients.contactId, contactId),
      ),
    )
    .orderBy(desc(recipients.revision))
    .limit(1);
  return recipient;
}

export function approvedHomeownerPhotos(tx: Tx, scope: HomeownerProjectScope, selected?: string[]) {
  return tx
    .select({
      preview: previews,
      filename: uploads.filename,
      approvedAt: approvals.createdAt,
    })
    .from(previews)
    .innerJoin(
      approvals,
      and(
        eq(approvals.orgId, previews.orgId),
        eq(approvals.projectId, previews.projectId),
        eq(approvals.assetId, previews.assetId),
        eq(approvals.previewId, previews.id),
      ),
    )
    .innerJoin(
      assets,
      and(
        eq(assets.orgId, previews.orgId),
        eq(assets.projectId, previews.projectId),
        eq(assets.id, previews.assetId),
        eq(assets.annotationRevision, previews.sourceAnnotationRevision),
        eq(assets.scanState, 'clean'),
      ),
    )
    .innerJoin(
      uploads,
      and(
        eq(uploads.orgId, previews.orgId),
        eq(uploads.projectId, previews.projectId),
        eq(uploads.id, previews.assetId),
        eq(uploads.sha256, previews.sourceSha256),
      ),
    )
    .where(
      and(
        eq(previews.orgId, scope.orgId),
        eq(previews.projectId, scope.projectId),
        selected ? inArray(previews.id, selected) : undefined,
      ),
    )
    .orderBy(desc(approvals.createdAt), desc(previews.id))
    .limit(selected?.length ?? 100);
}
