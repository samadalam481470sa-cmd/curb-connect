import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseTakeoffPlan,
  EnterpriseTakeoffPlanDetail,
  EnterpriseTakeoffPlanInput,
  EnterpriseTakeoffPlanPage,
  EnterpriseTakeoffSourcePage,
  MAX_TAKEOFF_SHEETS,
} from '@fieldline/contracts';
import {
  enterpriseDocumentSets as documents,
  enterpriseDocumentVersions as versions,
} from '../../db/schema/enterpriseDocuments';
import {
  enterpriseTakeoffPlanSets as plans,
  enterpriseTakeoffPlanSheets as sheets,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { PlanSheetLimitError, readPlanPdfSheets } from '../../services/plan-pdf';
import { audit, checkEnabled, checkProject } from './access';
import { readVerifiedEnterpriseDocument } from './documentStorage';

const Project = z.object({ projectId: z.uuid() });
const Plan = Project.extend({ planId: z.uuid() });
const Cursor = z.object({ cursor: z.string().max(256).optional() });
const root = '/enterprise/projects/:projectId/takeoff';
const read = { permission: 'job:read' } as const;
const write = {
  permission: 'estimate:write',
  rateLimit: { max: 10, timeWindow: '1 minute' },
} as const;

function scope(orgId: string, projectId: string) {
  return and(eq(plans.orgId, orgId), eq(plans.projectId, projectId));
}

function planDto(row: typeof plans.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    revisionLabel: row.revisionLabel,
    sourceCount: row.sourceCount,
    sheetCount: row.sheetCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function joinDocument() {
  return and(
    eq(documents.id, versions.documentSetId),
    eq(documents.orgId, versions.orgId),
    eq(documents.projectId, versions.projectId),
  );
}

function allowedVersions(orgId: string, projectId: string) {
  return and(
    eq(versions.orgId, orgId),
    eq(versions.projectId, projectId),
    eq(documents.category, 'plans'),
  );
}

async function priorImport(
  tx: Tx,
  orgId: string,
  projectId: string,
  requestId: string,
  hash: string,
) {
  const [plan] = await tx
    .select()
    .from(plans)
    .where(and(scope(orgId, projectId), eq(plans.clientRequestId, requestId)));
  if (plan && plan.requestHash !== hash)
    throw problem('conflict', 'This import request already belongs to a different plan set.');
  return plan;
}

const takeoffPlans: FastifyPluginAsyncZod = async (app) => {
  app.get(
    root + '/sources',
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: Project,
        querystring: Cursor,
        response: { 200: EnterpriseTakeoffSourcePage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const limit = 30;
        const entries = await tx
          .select({
            versionId: versions.id,
            title: documents.title,
            filename: versions.filename,
            version: versions.version,
            scanStatus: versions.scanStatus,
            createdAt: versions.createdAt,
          })
          .from(versions)
          .innerJoin(documents, joinDocument())
          .where(
            and(
              allowedVersions(orgId, projectId),
              beforeCursor(versions.createdAt, versions.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(versions.createdAt)), desc(versions.id))
          .limit(limit + 1);
        return pageResult(
          entries,
          limit,
          ({ createdAt, versionId }) => ({ at: createdAt, id: versionId }),
          (row) => row,
        );
      });
    },
  );

  app.get(
    root + '/plan-sets',
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: Project,
        querystring: Cursor,
        response: { 200: EnterpriseTakeoffPlanPage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const limit = 30;
        const entries = await tx
          .select()
          .from(plans)
          .where(and(scope(orgId, projectId), beforeCursor(plans.createdAt, plans.id, cursor)))
          .orderBy(desc(msTrunc(plans.createdAt)), desc(plans.id))
          .limit(limit + 1);
        return pageResult(entries, limit, ({ createdAt, id }) => ({ at: createdAt, id }), planDto);
      });
    },
  );

  app.get(
    root + '/plan-sets/:planId',
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: Plan,
        response: { 200: EnterpriseTakeoffPlanDetail },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId, planId } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [plan] = await tx
          .select()
          .from(plans)
          .where(and(scope(orgId, projectId), eq(plans.id, planId)));
        if (!plan) throw problem('not_found');
        const sheetRows = await tx
          .select({
            id: sheets.id,
            sourceVersionId: versions.id,
            sourceTitle: documents.title,
            sourceFilename: versions.filename,
            sourceRevision: versions.version,
            scanStatus: versions.scanStatus,
            pageNumber: sheets.pageNumber,
            pageLabel: sheets.pageLabel,
            widthPoints: sheets.widthPoints,
            heightPoints: sheets.heightPoints,
            rotation: sheets.rotation,
          })
          .from(sheets)
          .innerJoin(
            versions,
            and(
              eq(versions.id, sheets.sourceVersionId),
              eq(versions.orgId, sheets.orgId),
              eq(versions.projectId, sheets.projectId),
            ),
          )
          .innerJoin(documents, joinDocument())
          .where(
            and(
              eq(sheets.orgId, orgId),
              eq(sheets.projectId, projectId),
              eq(sheets.planId, planId),
            ),
          )
          .orderBy(asc(sheets.ordinal));
        return { plan: planDto(plan), sheets: sheetRows };
      });
    },
  );

  app.post(
    root + '/plan-sets',
    {
      config: write,
      schema: {
        tags: ['enterprise'],
        params: Project,
        body: EnterpriseTakeoffPlanInput,
        response: { 200: EnterpriseTakeoffPlan, 201: EnterpriseTakeoffPlan },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const { title, revisionLabel, versionIds, clientRequestId } = request.body;
      const hash = createHash('sha256')
        .update(JSON.stringify({ title, revisionLabel, versionIds }))
        .digest('hex');
      const input = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const prior = await priorImport(tx, orgId, projectId, clientRequestId, hash);
        if (prior) return { prior } as const;
        const available = await tx
          .select({
            id: versions.id,
            storageKey: versions.storageKey,
            sha256Hex: versions.sha256Hex,
            byteSize: versions.byteSize,
            filename: versions.filename,
          })
          .from(versions)
          .innerJoin(documents, joinDocument())
          .where(and(allowedVersions(orgId, projectId), inArray(versions.id, versionIds)));
        if (available.length !== versionIds.length)
          throw problem(
            'not_found',
            'Choose plan PDF versions from this project’s Document Vault.',
          );
        return { available } as const;
      });
      if (input.prior) return reply.code(200).send(planDto(input.prior));

      const parsed: (Awaited<ReturnType<typeof readPlanPdfSheets>>[number] & {
        sourceVersionId: string;
      })[] = [];
      for (const id of versionIds) {
        const source = input.available.find((row) => row.id === id);
        if (!source) throw problem('not_found');
        const bytes = await readVerifiedEnterpriseDocument(app.storage, orgId, source);
        try {
          const pages = await readPlanPdfSheets(
            new Uint8Array(bytes),
            MAX_TAKEOFF_SHEETS - parsed.length,
          );
          parsed.push(...pages.map((page) => ({ ...page, sourceVersionId: id })));
        } catch (error) {
          if (error instanceof PlanSheetLimitError)
            throw problem(
              'validation_failed',
              'A plan set can contain up to ' + MAX_TAKEOFF_SHEETS + ' sheets.',
            );
          throw problem(
            'validation_failed',
            'Could not read the sheets in ' +
              source.filename +
              '. Choose a readable, unencrypted PDF.',
          );
        }
      }

      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const prior = await priorImport(tx, orgId, projectId, clientRequestId, hash);
        if (prior) return { plan: prior, created: false };
        const [plan] = await tx
          .insert(plans)
          .values({
            orgId,
            projectId,
            title,
            revisionLabel,
            requestHash: hash,
            clientRequestId,
            sourceCount: versionIds.length,
            sheetCount: parsed.length,
            createdByUserId: userId,
          })
          .returning();
        if (!plan) throw new Error('Plan set insertion failed.');
        await tx.insert(sheets).values(
          parsed.map((page, i) => ({
            ...page,
            orgId,
            projectId,
            planId: plan.id,
            ordinal: i + 1,
          })),
        );
        await audit(
          tx,
          orgId,
          userId,
          'takeoff_plan_set',
          plan.id,
          'takeoff_plan_set.imported',
          null,
          {
            ...planDto(plan),
            sourceVersionIds: versionIds,
          },
        );
        return { plan, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(planDto(result.plan));
    },
  );
};

export default takeoffPlans;
