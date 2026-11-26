import {
  CreateJobsiteHomeownerShare,
  JobsiteHomeownerRecipient,
  JobsiteHomeownerShare,
  JobsiteHomeownerShareReceipt,
  JobsiteHomeownerShareView,
  RevokeJobsiteHomeownerShare,
  SetJobsiteHomeownerRecipient,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { contacts, customers } from '../../db/schema/crm';
import {
  enterpriseMediaHomeownerRecipients as recipients,
  enterpriseMediaHomeownerShareItems as items,
  enterpriseMediaHomeownerShareRevocations as revocations,
  enterpriseMediaHomeownerShares as shares,
} from '../../db/schema/enterpriseMediaHomeowner';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { sha256Hex } from '../media/processing';
import { sealSecret, unsealSecret } from '../team/service';
import {
  approvedHomeownerPhotos,
  findActiveHomeownerContact,
  jobsiteGalleryTokenHash,
  jobsiteGalleryUrl,
  JOBSITE_GALLERY_MAX_DAYS,
  latestHomeownerRecipient,
  newJobsiteGalleryToken,
  type HomeownerProjectScope,
} from './jobsiteHomeownerAccess';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';

const permission = 'enterprise_media:share_customer_media';
const millisecondsPerDay = 86_400_000;
type Share = typeof shares.$inferSelect;
type Recipient = typeof recipients.$inferSelect;

function recipientScope(scope: HomeownerProjectScope) {
  return and(eq(recipients.orgId, scope.orgId), eq(recipients.projectId, scope.projectId));
}

function shareScope(scope: HomeownerProjectScope) {
  return and(eq(shares.orgId, scope.orgId), eq(shares.projectId, scope.projectId));
}

function revokeScope(scope: HomeownerProjectScope) {
  return and(eq(revocations.orgId, scope.orgId), eq(revocations.projectId, scope.projectId));
}

function recipientDto(
  row: Recipient,
  displayName: string,
): z.infer<typeof JobsiteHomeownerRecipient> {
  return { contactId: row.contactId, displayName, active: row.active, revision: row.revision };
}

function shareDto(
  row: Share,
  mediaCount: number,
  revokedAt: Date | null,
  activeRecipient = true,
): z.infer<typeof JobsiteHomeownerShare> {
  return {
    id: row.id,
    homeownerId: row.homeownerId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    revision: row.revision,
    mediaCount,
    revokedAt: revokedAt?.toISOString() ?? null,
    status: revokedAt
      ? 'revoked'
      : row.expiresAt.valueOf() <= Date.now()
        ? 'expired'
        : activeRecipient
          ? 'active'
          : 'recipient_access_ended',
  };
}

async function latestShareRevision(tx: Tx, scope: HomeownerProjectScope) {
  const [row] = await tx
    .select({ revision: shares.revision })
    .from(shares)
    .where(shareScope(scope))
    .orderBy(desc(shares.revision))
    .limit(1);
  return row?.revision ?? 0;
}

async function shareItems(tx: Tx, scope: HomeownerProjectScope, shareIds: string[]) {
  if (!shareIds.length) return new Map<string, number>();
  const rows = await tx
    .select({ shareId: items.shareId })
    .from(items)
    .where(
      and(
        eq(items.orgId, scope.orgId),
        eq(items.projectId, scope.projectId),
        inArray(items.shareId, shareIds),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.shareId, (counts.get(row.shareId) ?? 0) + 1);
  return counts;
}

const homeownerShares: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/homeowner-shares';

  app.get(
    path,
    {
      config: { permission },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        response: { 200: JobsiteHomeownerShareView },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId };
        const currentRecipients = tx
          .selectDistinctOn([recipients.contactId], {
            grantId: recipients.id,
            contactId: recipients.contactId,
            active: recipients.active,
            revision: recipients.revision,
          })
          .from(recipients)
          .where(recipientScope(scope))
          .orderBy(asc(recipients.contactId), desc(recipients.revision))
          .as('current_homeowner_recipients');
        const recipientRows = await tx
          .select({
            grantId: currentRecipients.grantId,
            contactId: currentRecipients.contactId,
            active: currentRecipients.active,
            revision: currentRecipients.revision,
            displayName: contacts.displayName,
          })
          .from(currentRecipients)
          .innerJoin(
            contacts,
            and(
              eq(contacts.orgId, org.orgId),
              eq(contacts.id, currentRecipients.contactId),
              eq(contacts.status, 'active'),
              isNull(contacts.deletedAt),
            ),
          )
          .innerJoin(
            customers,
            and(
              eq(customers.orgId, org.orgId),
              eq(customers.id, contacts.customerId),
              eq(customers.status, 'active'),
              isNull(customers.deletedAt),
            ),
          )
          .orderBy(asc(contacts.displayName));
        const listing = await tx
          .select({ share: shares, revokedAt: revocations.createdAt })
          .from(shares)
          .leftJoin(
            revocations,
            and(
              eq(revocations.orgId, shares.orgId),
              eq(revocations.projectId, shares.projectId),
              eq(revocations.shareId, shares.id),
            ),
          )
          .where(shareScope(scope))
          .orderBy(desc(shares.revision))
          .limit(100);
        const counts = await shareItems(
          tx,
          scope,
          listing.map(({ share }) => share.id),
        );
        const choices = await approvedHomeownerPhotos(tx, scope);
        const validGrants = new Set(
          recipientRows.filter(({ active }) => active).map(({ grantId }) => grantId),
        );
        return {
          revision: listing[0]?.share.revision ?? 0,
          shares: listing.map(({ share, revokedAt }) =>
            shareDto(
              share,
              counts.get(share.id) ?? 0,
              revokedAt,
              validGrants.has(share.recipientGrantId),
            ),
          ),
          recipients: recipientRows.map(({ contactId, active, revision, displayName }) => ({
            contactId,
            active,
            revision,
            displayName,
          })),
          available: choices.map(({ preview, filename, approvedAt }) => ({
            previewId: preview.id,
            assetId: preview.assetId,
            filename,
            previewHref:
              '/v1/enterprise/projects/' +
              projectId +
              '/media/' +
              preview.assetId +
              '/customer-preview/' +
              preview.id +
              '/image',
            approvedAt: approvedAt.toISOString(),
          })),
        };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path + '/recipients/:contactId',
    {
      config: { permission },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams.extend({ contactId: z.uuid() }),
        body: SetJobsiteHomeownerRecipient,
        response: { 200: JobsiteHomeownerRecipient },
      },
    },
    async (request, reply) => {
      const { projectId, contactId } = request.params;
      const expected = parseIfMatch(request);
      const { active, reason, clientRequestId } = request.body;
      const requestHash = sha256Hex(
        Buffer.from(JSON.stringify({ expected, contactId, active, reason })),
      );
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const contact = await findActiveHomeownerContact(tx, scope.orgId, contactId);
        if (!contact) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(recipients)
          .where(
            and(
              recipientScope(scope),
              eq(recipients.contactId, contactId),
              eq(recipients.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already changed a different homeowner grant.');
          return recipientDto(receipt, contact.displayName);
        }
        const grant = await latestHomeownerRecipient(tx, scope, contactId);
        assertRevision(grant?.revision ?? 0, expected);
        if (grant?.active === active) return recipientDto(grant, contact.displayName);
        const [saved] = await tx
          .insert(recipients)
          .values({
            ...scope,
            contactId,
            active,
            reason,
            revision: expected + 1,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_media_homeowner_recipient',
          resourceId: saved.id,
          action: 'media.homeowner_recipient_changed',
          reason,
          after: { projectId, contactId, active, revision: saved.revision },
        });
        return recipientDto(saved, contact.displayName);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path,
    {
      config: { permission, rateLimit: { max: 24, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        body: CreateJobsiteHomeownerShare,
        response: { 200: JobsiteHomeownerShareReceipt, 201: JobsiteHomeownerShareReceipt },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const expected = parseIfMatch(request);
      const { homeownerId, expiresAt, mediaRevisionIds, clientRequestId } = request.body;
      const ids = [...mediaRevisionIds].sort();
      const requestHash = sha256Hex(
        Buffer.from(JSON.stringify({ expected, homeownerId, expiresAt, ids })),
      );
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [receipt] = await tx
          .select()
          .from(shares)
          .where(and(shareScope(scope), eq(shares.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already published a different homeowner share.',
            );
          const token = unsealSecret(app.config.session.secret, receipt.tokenSealed);
          return {
            created: false,
            value: {
              ...shareDto(receipt, ids.length, null),
              galleryUrl: jobsiteGalleryUrl(app.config.appOrigin, projectId, token),
            },
          };
        }
        assertRevision(await latestShareRevision(tx, scope), expected);
        const expiry = new Date(expiresAt);
        const ttl = expiry.valueOf() - Date.now();
        if (ttl <= 0 || ttl > JOBSITE_GALLERY_MAX_DAYS * millisecondsPerDay)
          throw problem(
            'validation_failed',
            'Choose an expiration within the next ' + JOBSITE_GALLERY_MAX_DAYS + ' days.',
          );
        const contact = await findActiveHomeownerContact(tx, scope.orgId, homeownerId);
        const grant = await latestHomeownerRecipient(tx, scope, homeownerId);
        if (!contact || !grant?.active)
          throw problem('validation_failed', 'Choose an active contact assigned to this project.');
        const approved = await approvedHomeownerPhotos(tx, scope, ids);
        if (approved.length !== ids.length)
          throw problem(
            'validation_failed',
            'Select only current, approved previews for this project.',
          );

        const token = newJobsiteGalleryToken();
        const [created] = await tx
          .insert(shares)
          .values({
            ...scope,
            homeownerId,
            recipientGrantId: grant.id,
            expiresAt: expiry,
            revision: expected + 1,
            tokenHash: jobsiteGalleryTokenHash(token),
            tokenSealed: sealSecret(app.config.session.secret, token),
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!created) throw problem('internal');
        await tx.insert(items).values(
          approved.map(({ preview }, sortOrder) => ({
            ...scope,
            shareId: created.id,
            assetId: preview.assetId,
            previewId: preview.id,
            sortOrder,
          })),
        );
        await enqueue(tx, {
          orgId: scope.orgId,
          task: 'enterprise_media.homeowner_gallery_published',
          aggregateType: 'enterprise_media_homeowner_share',
          aggregateId: created.id,
          payload: { projectId, shareId: created.id, membershipId: org.membershipId },
          jobKey: 'enterprise_media.homeowner_gallery_published:' + created.id,
          correlationId: request.id,
        });
        await auditRequest(request, tx, {
          orgId: scope.orgId,
          resourceType: 'enterprise_media_homeowner_share',
          resourceId: created.id,
          action: 'media.homeowner_gallery_published',
          after: { projectId, homeownerId, expiresAt, mediaRevisionIds: ids },
        });
        return {
          created: true,
          value: {
            ...shareDto(created, ids.length, null),
            galleryUrl: jobsiteGalleryUrl(app.config.appOrigin, projectId, token),
          },
        };
      });
      setEtag(reply, result.value.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.value);
    },
  );

  app.post(
    path + '/:shareId/revoke',
    {
      config: { permission },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams.extend({ shareId: z.uuid() }),
        body: RevokeJobsiteHomeownerShare,
        response: { 200: JobsiteHomeownerShare },
      },
    },
    async (request, reply) => {
      const { projectId, shareId } = request.params;
      const expected = parseIfMatch(request);
      const { reason, clientRequestId } = request.body;
      const requestHash = sha256Hex(Buffer.from(JSON.stringify({ expected, shareId, reason })));
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [share] = await tx
          .select()
          .from(shares)
          .where(and(shareScope(scope), eq(shares.id, shareId)));
        if (!share) throw problem('not_found');
        assertRevision(share.revision, expected);
        const counts = await shareItems(tx, scope, [shareId]);
        const [receipt] = await tx
          .select()
          .from(revocations)
          .where(and(revokeScope(scope), eq(revocations.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already revoked a different homeowner share.');
          return shareDto(share, counts.get(shareId) ?? 0, receipt.createdAt);
        }
        const [previous] = await tx
          .select()
          .from(revocations)
          .where(and(revokeScope(scope), eq(revocations.shareId, shareId)));
        if (previous) return shareDto(share, counts.get(shareId) ?? 0, previous.createdAt);
        const [saved] = await tx
          .insert(revocations)
          .values({
            ...scope,
            shareId,
            reason,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_homeowner_share',
          resourceId: shareId,
          action: 'media.homeowner_gallery_revoked',
          reason,
          after: { projectId, revocationId: saved.id },
        });
        return shareDto(share, counts.get(shareId) ?? 0, saved.createdAt);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default homeownerShares;
