import { createHash } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import {
  ENTERPRISE_DOCUMENT_MAX_BYTES,
  EnterpriseDocumentCategory,
  EnterpriseDocumentDecision,
  EnterpriseDocumentDetail,
  EnterpriseDocumentPage,
  EnterpriseDocumentVersion,
} from '@fieldline/contracts';
import {
  enterpriseDocumentReviews as reviews,
  enterpriseDocumentSets as sets,
  enterpriseDocumentVersions as versions,
} from '../../db/schema/enterpriseDocuments';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { orgIdFromKey, safeFileName } from '../../storage';
import { audit, checkEnabled, checkProject } from './access';

const ProjectParams = z.object({ projectId: z.uuid() });
const SetParams = ProjectParams.extend({ setId: z.uuid() });
const VersionParams = ProjectParams.extend({ versionId: z.uuid() });
const RevisionNote = z.string().trim().min(3).max(1000);
const VersionInput = z.object({
  filename: z.string().trim().min(1).max(180),
  contentBase64: z
    .base64()
    .min(4)
    .max(4 * Math.ceil(ENTERPRISE_DOCUMENT_MAX_BYTES / 3)),
  clientRequestId: z.uuid(),
  revisionNote: RevisionNote.optional(),
});
const FirstVersionInput = VersionInput.extend({
  title: z.string().trim().min(2).max(180),
  category: EnterpriseDocumentCategory,
});
const bodyLimit = 4 * Math.ceil(ENTERPRISE_DOCUMENT_MAX_BYTES / 3) + 16 * 1024;
const permission = {
  permission: 'job:write',
  rateLimit: { max: 15, timeWindow: '1 minute' },
} as const;
type DocumentSet = typeof sets.$inferSelect;
type Version = typeof versions.$inferSelect;
type Review = typeof reviews.$inferSelect;

function projectScope(orgId: string, projectId: string) {
  return {
    sets: and(eq(sets.orgId, orgId), eq(sets.projectId, projectId)),
    versions: and(eq(versions.orgId, orgId), eq(versions.projectId, projectId)),
  };
}

function setDto(row: DocumentSet) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    createdAt: row.createdAt.toISOString(),
  };
}

function versionDto(row: Version, review: Review | null = null) {
  return {
    id: row.id,
    documentSetId: row.documentSetId,
    filename: row.filename,
    version: row.version,
    sha256Hex: row.sha256Hex,
    byteSize: row.byteSize,
    scanStatus: row.scanStatus,
    revisionNote: row.revisionNote,
    createdAt: row.createdAt.toISOString(),
    review: review
      ? { decision: review.decision, note: review.note, createdAt: review.createdAt.toISOString() }
      : null,
  };
}

async function currentVersion(tx: Tx, orgId: string, projectId: string, setId: string) {
  const [current] = await tx
    .select()
    .from(versions)
    .where(and(projectScope(orgId, projectId).versions, eq(versions.documentSetId, setId)))
    .orderBy(desc(versions.version))
    .limit(1);
  if (!current) throw problem('not_found');
  return current;
}

type Destination =
  | { title: string; category: z.infer<typeof EnterpriseDocumentCategory> }
  | { setId: string; expectedVersion: number };

async function upload(
  request: FastifyRequest,
  projectId: string,
  upload: z.infer<typeof VersionInput>,
  target: Destination,
) {
  const { orgId, userId } = requireOrg(request);
  const { storage, scanner, config } = request.server;
  const bytes = Buffer.from(upload.contentBase64, 'base64');
  if (bytes.length > Math.min(ENTERPRISE_DOCUMENT_MAX_BYTES, config.storage.maxUploadBytes))
    throw problem('payload_too_large', 'This PDF exceeds the document upload limit.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = crypto.randomUUID();
  const storageKey = `orgs/${orgId}/enterprise/documents/${id}`;
  const scope = projectScope(orgId, projectId);
  let storageAttempted = false;

  try {
    return await tenantTx(request, async (tx) => {
      await checkEnabled(tx, orgId);
      await checkProject(tx, orgId, projectId, true);
      const [existing] = await tx
        .select()
        .from(versions)
        .where(and(scope.versions, eq(versions.clientRequestId, upload.clientRequestId)));
      if (existing) {
        if (
          existing.sha256Hex !== hash ||
          ('setId' in target
            ? existing.documentSetId !== target.setId ||
              existing.version !== target.expectedVersion + 1
            : existing.version !== 1)
        ) {
          throw problem('conflict', 'The upload request ID already belongs to another upload.');
        }
        return { created: false, version: existing };
      }

      const kind = await fileTypeFromBuffer(bytes).catch(() => undefined);
      if (kind?.mime !== 'application/pdf')
        throw problem('unsupported_media_type', 'Select a valid PDF document.');
      const scanStatus = await scanner.scan(bytes);
      if (scanStatus === 'infected')
        throw problem('media_rejected', 'The file scan rejected this PDF.');
      if (scanStatus !== 'clean' && scanStatus !== 'not_scanned')
        throw problem('conflict', 'The file scan did not finish. Try uploading again.');

      let documentSetId: string;
      let version = 1;
      if ('setId' in target) {
        const current = await currentVersion(tx, orgId, projectId, target.setId);
        assertRevision(current.version, target.expectedVersion);
        if (current.sha256Hex === hash)
          throw problem('conflict', 'This file matches the current version.');
        if (current.version >= 100)
          throw problem('conflict', 'This document has reached its 100-version limit.');
        documentSetId = target.setId;
        version = current.version + 1;
      } else {
        const [set] = await tx
          .insert(sets)
          .values({ ...target, orgId, projectId, createdByUserId: userId })
          .returning();
        if (!set) throw new Error('Document registration failed.');
        documentSetId = set.id;
      }

      storageAttempted = true;
      await storage.put(storageKey, bytes, 'application/pdf');
      const [row] = await tx
        .insert(versions)
        .values({
          id,
          orgId,
          projectId,
          documentSetId,
          version,
          storageKey,
          clientRequestId: upload.clientRequestId,
          byteSize: bytes.length,
          sha256Hex: hash,
          filename: safeFileName(upload.filename),
          scanStatus,
          revisionNote: upload.revisionNote,
          uploadedByUserId: userId,
        })
        .returning();
      if (!row) throw new Error('Document version registration failed.');
      await audit(
        tx,
        orgId,
        userId,
        'document_version',
        id,
        'document.version_uploaded',
        null,
        versionDto(row),
      );
      return { created: true, version: row };
    });
  } catch (error) {
    if (storageAttempted) {
      // A network failure while committing can hide a successful insert. Remove only objects whose
      // missing registration is confirmed on a fresh connection.
      try {
        const [registered] = await tenantTx(request, (tx) =>
          tx
            .select({ id: versions.id })
            .from(versions)
            .where(and(scope.versions, eq(versions.id, id))),
        );
        if (!registered) await storage.delete(storageKey);
      } catch {
        request.log.warn(
          { documentVersionId: id },
          'Could not reconcile an interrupted document upload',
        );
      }
    }
    throw error;
  }
}

const enterpriseDocumentModule: FastifyPluginAsyncZod = async (app) => {
  const root = '/enterprise/projects/:projectId';
  app.get(
    root + '/documents',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseDocumentPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      const scope = projectScope(orgId, projectId);
      const limit = 30;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const rows = await tx
          .select()
          .from(sets)
          .where(and(scope.sets, beforeCursor(sets.createdAt, sets.id, cursor)))
          .orderBy(desc(msTrunc(sets.createdAt)), desc(sets.id))
          .limit(limit + 1);
        const legacy = cursor
          ? []
          : await tx
              .select()
              .from(versions)
              .where(and(scope.versions, isNull(versions.documentSetId)))
              .orderBy(desc(versions.createdAt), desc(versions.id))
              .limit(50);
        return {
          ...pageResult(rows, limit, (row) => ({ at: row.createdAt, id: row.id }), setDto),
          legacyVersions: legacy.map((row) => versionDto(row)),
        };
      });
    },
  );

  app.get(
    root + '/documents/:setId',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: SetParams,
        response: { 200: EnterpriseDocumentDetail },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId, setId } = request.params;
      const scope = projectScope(orgId, projectId);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const [set] = await tx
          .select()
          .from(sets)
          .where(and(scope.sets, eq(sets.id, setId)));
        if (!set) throw problem('not_found');
        const history = await tx
          .select({ version: versions, review: reviews })
          .from(versions)
          .leftJoin(
            reviews,
            and(
              eq(reviews.orgId, versions.orgId),
              eq(reviews.projectId, versions.projectId),
              eq(reviews.versionId, versions.id),
            ),
          )
          .where(and(scope.versions, eq(versions.documentSetId, setId)))
          .orderBy(desc(versions.version));
        return {
          document: setDto(set),
          versions: history.map((row) => versionDto(row.version, row.review)),
        };
      });
    },
  );

  app.post(
    root + '/documents',
    {
      bodyLimit,
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: FirstVersionInput,
        response: { 200: EnterpriseDocumentVersion, 201: EnterpriseDocumentVersion },
      },
    },
    async (request, reply) => {
      const { title, category, ...file } = request.body;
      const result = await upload(request, request.params.projectId, file, { title, category });
      return reply.code(result.created ? 201 : 200).send(versionDto(result.version));
    },
  );

  app.post(
    root + '/documents/:setId/versions',
    {
      bodyLimit,
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: SetParams,
        body: VersionInput.extend({ revisionNote: RevisionNote }),
        response: { 200: EnterpriseDocumentVersion, 201: EnterpriseDocumentVersion },
      },
    },
    async (request, reply) => {
      const { projectId, setId } = request.params;
      const result = await upload(request, projectId, request.body, {
        setId,
        expectedVersion: parseIfMatch(request),
      });
      return reply.code(result.created ? 201 : 200).send(versionDto(result.version));
    },
  );

  app.post(
    root + '/document-versions/:versionId/review',
    {
      config: { permission: 'review_task:decide', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: VersionParams,
        body: z.object({ decision: EnterpriseDocumentDecision, note: RevisionNote }),
        response: { 200: EnterpriseDocumentVersion },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, versionId } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [version] = await tx
          .select()
          .from(versions)
          .where(and(projectScope(orgId, projectId).versions, eq(versions.id, versionId)));
        if (!version?.documentSetId) throw problem('not_found');
        const current = await currentVersion(tx, orgId, projectId, version.documentSetId);
        if (current.id !== versionId)
          throw problem('conflict', 'A newer version is available. Review the current version.');
        const [review] = await tx
          .insert(reviews)
          .values({ ...request.body, versionId, orgId, projectId, createdByUserId: userId })
          .onConflictDoNothing({ target: reviews.versionId })
          .returning();
        if (!review) throw problem('conflict', 'This version already has a review decision.');
        await audit(
          tx,
          orgId,
          userId,
          'document_version',
          versionId,
          'document.version_reviewed',
          null,
          { decision: review.decision, note: review.note },
        );
        return versionDto(version, review);
      });
    },
  );

  app.get(
    root + '/document-versions/:versionId/download',
    {
      config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: VersionParams },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, versionId } = request.params;
      const version = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const [row] = await tx
          .select()
          .from(versions)
          .where(and(projectScope(orgId, projectId).versions, eq(versions.id, versionId)));
        if (!row || orgIdFromKey(row.storageKey) !== orgId) throw problem('not_found');
        return row;
      });
      const object = await app.storage.head(version.storageKey);
      if (!object) throw problem('not_found', 'The stored file is unavailable.');
      if (object.sizeBytes !== version.byteSize)
        throw problem('conflict', 'The stored file size differs from its version record.');
      const bytes = await app.storage.get(version.storageKey);
      if (
        bytes.length !== version.byteSize ||
        createHash('sha256').update(bytes).digest('hex') !== version.sha256Hex
      )
        throw problem('conflict', 'The stored file does not match its recorded checksum.');
      await tenantTx(request, (tx) =>
        audit(tx, orgId, userId, 'document_version', versionId, 'document.version_downloaded'),
      );
      return reply
        .type('application/octet-stream')
        .header('content-disposition', `attachment; filename="${safeFileName(version.filename)}"`)
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );
};

export default enterpriseDocumentModule;
