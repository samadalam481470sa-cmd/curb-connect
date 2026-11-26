import { JobsiteGalleryAccess, JobsiteHomeownerGallery } from '@fieldline/contracts';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseProjects, enterpriseSettings } from '../../db/schema/enterprise';
import {
  enterpriseMediaHomeownerShareItems as items,
  enterpriseMediaHomeownerShareRevocations as revocations,
  enterpriseMediaHomeownerShares as shares,
} from '../../db/schema/enterpriseMediaHomeowner';
import { organizations } from '../../db/schema/orgs';
import { platformTx } from '../../http/context';
import { problem } from '../../http/problem';
import { flagsFor } from '../../services/flags';
import { sha256Hex } from '../media/processing';
import {
  approvedHomeownerPhotos,
  findActiveHomeownerContact,
  jobsiteGalleryTokenHash,
  latestHomeownerRecipient,
} from '../enterprise/jobsiteHomeownerAccess';
import { jobsiteCustomerPhotoPreviewKey } from '../enterprise/jobsiteMediaStorage';

const path = '/portal/homeowner/projects/:projectId/gallery';
const project = z.object({ projectId: z.uuid() });

async function accessGallery(tx: Tx, projectId: string, token: string) {
  const [share] = await tx
    .select()
    .from(shares)
    .where(
      and(
        eq(shares.tokenHash, jobsiteGalleryTokenHash(token)),
        eq(shares.projectId, projectId),
        gt(shares.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!share) throw problem('not_found');
  const scope = { orgId: share.orgId, projectId: share.projectId };

  const [savedProject] = await tx
    .select({ companyName: organizations.displayName })
    .from(enterpriseProjects)
    .innerJoin(
      enterpriseSettings,
      and(
        eq(enterpriseSettings.orgId, enterpriseProjects.orgId),
        eq(enterpriseSettings.enabled, true),
      ),
    )
    .innerJoin(organizations, eq(organizations.id, enterpriseProjects.orgId))
    .where(
      and(eq(enterpriseProjects.orgId, scope.orgId), eq(enterpriseProjects.id, scope.projectId)),
    );
  if (!savedProject || !(await flagsFor(tx, scope.orgId))['enterprise.jobsite_media'])
    throw problem('not_found');
  const [withdrawn] = await tx
    .select({ id: revocations.id })
    .from(revocations)
    .where(
      and(
        eq(revocations.orgId, scope.orgId),
        eq(revocations.projectId, scope.projectId),
        eq(revocations.shareId, share.id),
      ),
    );
  if (withdrawn) throw problem('not_found');

  const grant = await latestHomeownerRecipient(tx, scope, share.homeownerId);
  if (!grant?.active || grant.id !== share.recipientGrantId) throw problem('not_found');
  const recipient = await findActiveHomeownerContact(tx, scope.orgId, share.homeownerId);
  if (!recipient) throw problem('not_found');
  return {
    share,
    scope,
    companyName: savedProject.companyName,
    recipientName: recipient.displayName,
  };
}

const homeownerGallery: FastifyPluginAsyncZod = async (app) => {
  app.post(
    path,
    {
      config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal'],
        params: project,
        body: JobsiteGalleryAccess,
        response: { 200: JobsiteHomeownerGallery },
      },
    },
    async (request, reply) => {
      const result = await platformTx(request, 'portal.jobsite_gallery', async (tx) => {
        const { share, scope, companyName, recipientName } = await accessGallery(
          tx,
          request.params.projectId,
          request.body.token,
        );
        const selection = await tx
          .select({ id: items.previewId })
          .from(items)
          .where(
            and(
              eq(items.orgId, scope.orgId),
              eq(items.projectId, scope.projectId),
              eq(items.shareId, share.id),
            ),
          )
          .orderBy(asc(items.sortOrder));
        const ids = selection.map(({ id }) => id);
        const stored = ids.length ? await approvedHomeownerPhotos(tx, scope, ids) : [];
        const currentImages = new Map(
          stored.map(({ preview }) => [
            preview.id,
            { id: preview.id, width: preview.width, height: preview.height },
          ]),
        );
        return {
          companyName,
          recipientName,
          expiresAt: share.expiresAt.toISOString(),
          images: ids.flatMap((id) => {
            const image = currentImages.get(id);
            return image ? [image] : [];
          }),
        };
      });
      return reply
        .header('cache-control', 'private, no-store')
        .header('x-robots-tag', 'noindex, nofollow')
        .send(result);
    },
  );

  app.post(
    path + '/images/:imageId',
    {
      config: { auth: 'none', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal'],
        params: project.extend({ imageId: z.uuid() }),
        body: JobsiteGalleryAccess,
      },
    },
    async (request, reply) => {
      const { projectId, imageId } = request.params;
      const content = await platformTx(request, 'portal.jobsite_gallery', async (tx) => {
        const { share, scope } = await accessGallery(tx, projectId, request.body.token);
        const [allowed] = await tx
          .select({ id: items.previewId })
          .from(items)
          .where(
            and(
              eq(items.orgId, scope.orgId),
              eq(items.projectId, scope.projectId),
              eq(items.shareId, share.id),
              eq(items.previewId, imageId),
            ),
          );
        if (!allowed) throw problem('not_found');
        const [record] = await approvedHomeownerPhotos(tx, scope, [allowed.id]);
        if (!record) throw problem('not_found');
        const preview = record.preview;
        const bytes = await app.storage.get(
          jobsiteCustomerPhotoPreviewKey(
            scope.orgId,
            preview.assetId,
            preview.revision,
            preview.sha256,
          ),
        );
        if (bytes.length !== preview.byteSize || sha256Hex(bytes) !== preview.sha256)
          throw problem('not_found');
        return bytes;
      });
      return reply
        .type('image/png')
        .header('cache-control', 'private, no-store')
        .header('x-robots-tag', 'noindex, nofollow')
        .header('x-content-type-options', 'nosniff')
        .send(content);
    },
  );
};

export default homeownerGallery;
