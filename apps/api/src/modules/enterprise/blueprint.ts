// Enterprise Blueprint API: tenant-scoped records for the 157 indexed work packages.
// Reads the catalog from @fieldline/contracts; the server validates every field key and lifecycle
// status so a client cannot invent a stage or smuggle a field outside the package contract.
import { and, asc, desc, eq, ilike, inArray, isNotNull, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ENTERPRISE_FINISHED_STATUSES,
  ENTERPRISE_LINK_KINDS,
  computeEnterpriseFieldValues,
  enterpriseBlockClosure,
  enterpriseFieldSchema,
  enterpriseLinkRule,
  enterpriseLinkValidation,
  enterpriseWorkflowState,
  findWorkPackage,
  isEnterpriseRecordFinished,
  isWorkPackageStatus,
  workPackageFieldKeys,
  wouldCreateEnterpriseBlockCycle,
  type EnterpriseFieldDefinition,
  type EnterpriseFieldSchema,
  type EnterpriseFieldValues,
  type EnterpriseLinkKind,
  type EnterpriseWorkPackage,
} from '@fieldline/contracts';
import {
  enterpriseProjects,
  enterpriseSettings,
  enterpriseAuditEvents,
} from '../../db/schema/enterprise';
import {
  enterpriseBlueprintRecordLinks,
  enterpriseBlueprintRecords,
} from '../../db/schema/enterpriseBlueprint';
import { users } from '../../db/schema/auth';
import { memberships } from '../../db/schema/team';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';

const CodeParams = z.object({ code: z.string().regex(/^\d{3}$/) });
const RecordParams = z.object({ id: z.uuid() });
const LinkParams = z.object({ id: z.uuid(), linkId: z.uuid() });
const FieldValues = z.record(
  z.string().trim().min(1).max(60),
  z.union([z.string().trim().max(10000), z.number().finite()]),
);
const IsoDate = z.iso.date().refine((value) => {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}, 'Enter a real calendar date.');
const WorkflowFields = {
  ownerUserId: z.uuid().nullable().optional(),
  dueOn: IsoDate.nullable().optional(),
  slaHours: z.number().int().min(1).max(8760).nullable().optional(),
  blockedReason: z.string().trim().max(500).nullable().optional(),
};

const createInput = z.object({
  title: z.string().trim().min(2).max(255),
  fields: FieldValues.default({}),
  notes: z.string().trim().max(10000).optional(),
  projectId: z.uuid().optional(),
  clientRequestId: z.string().trim().min(8).max(80).optional(),
  ...WorkflowFields,
});
const updateInput = z
  .object({
    status: z.string().trim().min(1).max(60).optional(),
    fields: FieldValues.optional(),
    notes: z.string().trim().max(10000).optional(),
    ...WorkflowFields,
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      body.fields !== undefined ||
      body.notes !== undefined ||
      body.ownerUserId !== undefined ||
      body.dueOn !== undefined ||
      body.slaHours !== undefined ||
      body.blockedReason !== undefined,
    {
      message: 'Provide a status, fields, notes or workflow change.',
    },
  );
const exceptionQuery = z.object({
  kind: z.enum(['all', 'overdue', 'blocked', 'sla']).default('all'),
  owner: z.union([z.uuid(), z.literal('unassigned')]).optional(),
  package: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const recordSearchQuery = z.object({
  q: z.string().trim().max(120).optional(),
  package: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const linkInput = z.object({
  kind: z.enum(ENTERPRISE_LINK_KINDS),
  toRecordId: z.uuid(),
  note: z.string().trim().max(500).nullable().optional(),
});

async function checkEnabled(tx: Tx, orgId: string) {
  const [settings] = await tx
    .select()
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, orgId));
  if (!settings?.enabled)
    throw problem('forbidden', 'Enable the Enterprise Suite for your company first.');
}

async function checkProject(tx: Tx, orgId: string, projectId: string) {
  const [project] = await tx
    .select({ id: enterpriseProjects.id })
    .from(enterpriseProjects)
    .where(and(eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, projectId)));
  if (!project)
    throw problem('validation_failed', 'The selected commercial project is not in this company.');
}

async function checkOwner(tx: Tx, orgId: string, userId: string) {
  const [member] = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, userId),
        eq(memberships.status, 'active'),
      ),
    );
  if (!member)
    throw problem('validation_failed', 'The owner must be an active member of this company.');
}

function cleanBlockedReason(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface BlueprintRecordSummary {
  id: string;
  packageCode: string;
  title: string;
  status: string;
}

async function loadRecordSummaries(
  tx: Tx,
  orgId: string,
  ids: readonly string[],
): Promise<Map<string, BlueprintRecordSummary>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: enterpriseBlueprintRecords.id,
      packageCode: enterpriseBlueprintRecords.packageCode,
      title: enterpriseBlueprintRecords.title,
      status: enterpriseBlueprintRecords.status,
    })
    .from(enterpriseBlueprintRecords)
    .where(
      and(
        eq(enterpriseBlueprintRecords.orgId, orgId),
        inArray(enterpriseBlueprintRecords.id, [...ids]),
      ),
    );
  return new Map(rows.map((row) => [row.id, row]));
}

async function lockRecord(tx: Tx, orgId: string, id: string) {
  const [row] = await tx
    .select()
    .from(enterpriseBlueprintRecords)
    .where(and(eq(enterpriseBlueprintRecords.orgId, orgId), eq(enterpriseBlueprintRecords.id, id)))
    .for('update');
  return row;
}

function operablePackage(code: string): EnterpriseWorkPackage {
  const pkg = findWorkPackage(code);
  if (!pkg) throw problem('not_found');
  if (pkg.specification === 'indexed') {
    throw problem(
      'validation_failed',
      'This work package is indexed only in the supplied blueprint extract; its detailed pages are required before records can be created.',
    );
  }
  return pkg;
}

function validateFields(pkg: EnterpriseWorkPackage, fields: EnterpriseFieldValues) {
  const allowed = new Set(workPackageFieldKeys(pkg));
  const unknown = Object.keys(fields).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw problem(
      'validation_failed',
      'Unknown field keys for this work package: ' + unknown.join(', ') + '.',
    );
  }
}

function invalidField(field: EnterpriseFieldDefinition, detail: string): never {
  throw problem('validation_failed', `${field.label}: ${detail}`);
}

function validateFieldValue(
  field: Exclude<EnterpriseFieldDefinition, { type: 'computed' }>,
  raw: string | number,
): string | number {
  if (field.type === 'text') {
    if (typeof raw !== 'string') invalidField(field, 'enter a text value.');
    const value = raw.trim();
    if (!value) invalidField(field, 'is required.');
    if (value.length > (field.maxLength ?? 2000))
      invalidField(field, `must be at most ${field.maxLength ?? 2000} characters.`);
    return value;
  }
  if (field.type === 'money') {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw))
      invalidField(field, 'must be a whole number of minor units (for example, cents).');
    if (field.minMinor !== undefined && raw < field.minMinor)
      invalidField(field, `must be at least ${field.minMinor} minor units.`);
    if (field.maxMinor !== undefined && raw > field.maxMinor)
      invalidField(field, `must be at most ${field.maxMinor} minor units.`);
    return raw;
  }
  if (field.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw))
      invalidField(field, 'must be a finite number.');
    if (field.min !== undefined && raw < field.min)
      invalidField(field, `must be at least ${field.min}.`);
    if (field.max !== undefined && raw > field.max)
      invalidField(field, `must be at most ${field.max}.`);
    return raw;
  }
  if (field.type === 'date') {
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw))
      invalidField(field, 'must be an ISO date (YYYY-MM-DD).');
    const parsed = Date.parse(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== raw)
      invalidField(field, 'must be a real calendar date.');
    if (field.min !== undefined && raw < field.min)
      invalidField(field, `must be on or after ${field.min}.`);
    if (field.max !== undefined && raw > field.max)
      invalidField(field, `must be on or before ${field.max}.`);
    return raw;
  }
  if (field.type === 'enum') {
    if (typeof raw !== 'string' || !field.options.some((option) => option.value === raw))
      invalidField(
        field,
        `must be one of: ${field.options.map((option) => option.value).join(', ')}.`,
      );
    return raw;
  }
  if (typeof raw !== 'string' || !z.uuid().safeParse(raw).success)
    invalidField(field, 'must be a UUID reference.');
  return raw;
}

function validateTypedFields(
  schema: EnterpriseFieldSchema,
  fields: EnterpriseFieldValues,
  options: { required: boolean },
): EnterpriseFieldValues {
  const definitions = new Map(schema.fields.map((field) => [field.key, field]));
  const normalized: EnterpriseFieldValues = {};
  for (const [key, raw] of Object.entries(fields)) {
    const field = definitions.get(key);
    if (!field) {
      throw problem('validation_failed', 'Unknown field keys for this work package: ' + key + '.');
    }
    if (field.type === 'computed') {
      throw problem(
        'validation_failed',
        `${field.label} is computed by the server and cannot be supplied.`,
      );
    }
    if (typeof raw === 'string' && raw.trim() === '' && !field.required) continue;
    normalized[key] = validateFieldValue(field, raw);
  }
  if (options.required) {
    for (const field of schema.fields) {
      if (field.type === 'computed' || !field.required) continue;
      if (normalized[field.key] === undefined) invalidField(field, 'is required.');
    }
  }
  return normalized;
}

async function validateTypedReferences(
  tx: Tx,
  orgId: string,
  schema: EnterpriseFieldSchema,
  fields: EnterpriseFieldValues,
) {
  for (const field of schema.fields) {
    if (field.type !== 'reference') continue;
    const value = fields[field.key];
    if (typeof value !== 'string') continue;
    if (field.target === 'project') {
      const [project] = await tx
        .select({ id: enterpriseProjects.id })
        .from(enterpriseProjects)
        .where(and(eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, value)));
      if (!project) invalidField(field, 'must reference a commercial project in this company.');
      continue;
    }
    if (field.target === 'user') {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.userId, value),
            eq(memberships.status, 'active'),
          ),
        );
      if (!member) invalidField(field, 'must reference an active member of this company.');
      continue;
    }
    const conditions = [
      eq(enterpriseBlueprintRecords.orgId, orgId),
      eq(enterpriseBlueprintRecords.id, value),
    ];
    if (field.packageCodes?.length)
      conditions.push(inArray(enterpriseBlueprintRecords.packageCode, [...field.packageCodes]));
    const [record] = await tx
      .select({ id: enterpriseBlueprintRecords.id })
      .from(enterpriseBlueprintRecords)
      .where(and(...conditions));
    if (!record) invalidField(field, 'must reference a record in this company.');
  }
}

async function audit(
  tx: Tx,
  orgId: string,
  userId: string,
  objectId: string,
  action: string,
  beforeState?: unknown,
  afterState?: unknown,
) {
  await tx.insert(enterpriseAuditEvents).values({
    orgId,
    actorUserId: userId,
    objectType: 'blueprint_record',
    objectId,
    action,
    beforeState: beforeState ?? null,
    afterState: afterState ?? null,
  });
}

const enterpriseBlueprintModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/blueprint',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        summary: 'Blueprint coverage and record counts per work package',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const byPackage = await tx
          .select({
            packageCode: enterpriseBlueprintRecords.packageCode,
            total: sql<number>`count(*)::int`,
            updatedAt: sql<Date>`max(${enterpriseBlueprintRecords.updatedAt})`,
          })
          .from(enterpriseBlueprintRecords)
          .where(eq(enterpriseBlueprintRecords.orgId, org.orgId))
          .groupBy(enterpriseBlueprintRecords.packageCode);
        const byStatus = await tx
          .select({ status: enterpriseBlueprintRecords.status, total: sql<number>`count(*)::int` })
          .from(enterpriseBlueprintRecords)
          .where(eq(enterpriseBlueprintRecords.orgId, org.orgId))
          .groupBy(enterpriseBlueprintRecords.status);
        return {
          byPackage: byPackage.map((row) => ({
            packageCode: row.packageCode,
            total: row.total,
            updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
          })),
          byStatus,
          totalRecords: byPackage.reduce((sum, row) => sum + row.total, 0),
        };
      });
    },
  );

  app.get(
    '/enterprise/blueprint/exceptions',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        summary: 'Daily queue of overdue, blocked and SLA-breached blueprint records',
        querystring: exceptionQuery,
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const now = new Date();
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const rows = await tx
          .select({
            record: enterpriseBlueprintRecords,
            ownerName: users.displayName,
          })
          .from(enterpriseBlueprintRecords)
          .leftJoin(users, eq(users.id, enterpriseBlueprintRecords.ownerUserId))
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              notInArray(enterpriseBlueprintRecords.status, [...ENTERPRISE_FINISHED_STATUSES]),
              or(
                isNotNull(enterpriseBlueprintRecords.blockedReason),
                eq(enterpriseBlueprintRecords.status, 'blocked'),
                isNotNull(enterpriseBlueprintRecords.dueOn),
                isNotNull(enterpriseBlueprintRecords.slaHours),
              ),
            ),
          )
          .orderBy(
            asc(enterpriseBlueprintRecords.dueOn),
            desc(enterpriseBlueprintRecords.updatedAt),
          )
          .limit(2000);
        const all = rows.flatMap(({ record, ownerName }) => {
          const state = enterpriseWorkflowState(record, now);
          if (state.reasons.length === 0) return [];
          return [{ ...record, ownerName: ownerName ?? null, ...state }];
        });
        const counts = {
          overdue: all.filter((item) => item.overdue).length,
          blocked: all.filter((item) => item.blocked).length,
          slaBreached: all.filter((item) => item.slaBreached).length,
          unassigned: all.filter((item) => !item.ownerUserId).length,
          total: all.length,
        };
        let items = all;
        if (request.query.kind === 'overdue') items = items.filter((item) => item.overdue);
        else if (request.query.kind === 'blocked') items = items.filter((item) => item.blocked);
        else if (request.query.kind === 'sla') items = items.filter((item) => item.slaBreached);
        if (request.query.package)
          items = items.filter((item) => item.packageCode === request.query.package);
        if (request.query.owner === 'unassigned') items = items.filter((item) => !item.ownerUserId);
        else if (request.query.owner)
          items = items.filter((item) => item.ownerUserId === request.query.owner);
        items = [...items].sort((left, right) => {
          const rank = (item: (typeof all)[number]) =>
            item.blocked ? 0 : item.overdue ? 1 : item.slaBreached ? 2 : 3;
          return (
            rank(left) - rank(right) ||
            (left.dueOn ?? '9999-12-31').localeCompare(right.dueOn ?? '9999-12-31') ||
            (left.slaDueAt ?? '9999-12-31T23:59:59.999Z').localeCompare(
              right.slaDueAt ?? '9999-12-31T23:59:59.999Z',
            ) ||
            right.updatedAt.getTime() - left.updatedAt.getTime()
          );
        });
        return {
          generatedAt: now.toISOString(),
          today: now.toISOString().slice(0, 10),
          counts,
          items: items.slice(0, request.query.limit),
        };
      });
    },
  );

  app.get(
    '/enterprise/blueprint/records',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        querystring: recordSearchQuery,
        summary: 'Search blueprint records across work packages',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const conditions = [eq(enterpriseBlueprintRecords.orgId, org.orgId)];
        if (request.query.package)
          conditions.push(eq(enterpriseBlueprintRecords.packageCode, request.query.package));
        if (request.query.q) {
          const search = `%${request.query.q}%`;
          const clause = or(
            ilike(enterpriseBlueprintRecords.title, search),
            ilike(enterpriseBlueprintRecords.packageCode, search),
          );
          if (clause) conditions.push(clause);
        }
        const items = await tx
          .select({
            record: enterpriseBlueprintRecords,
            ownerName: users.displayName,
          })
          .from(enterpriseBlueprintRecords)
          .leftJoin(users, eq(users.id, enterpriseBlueprintRecords.ownerUserId))
          .where(and(...conditions))
          .orderBy(desc(enterpriseBlueprintRecords.updatedAt))
          .limit(request.query.limit);
        return {
          items: items.map(({ record, ownerName }) => ({
            ...record,
            ownerName: ownerName ?? null,
          })),
        };
      });
    },
  );

  app.get(
    '/enterprise/blueprint/:code/records',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: CodeParams,
        summary: 'List records for one work package',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const code = String(request.params.code);
      const pkg = findWorkPackage(code);
      if (!pkg) throw problem('not_found');
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const items = await tx
          .select({
            record: enterpriseBlueprintRecords,
            ownerName: users.displayName,
          })
          .from(enterpriseBlueprintRecords)
          .leftJoin(users, eq(users.id, enterpriseBlueprintRecords.ownerUserId))
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              eq(enterpriseBlueprintRecords.packageCode, code),
            ),
          )
          .orderBy(desc(enterpriseBlueprintRecords.updatedAt))
          .limit(100);
        return {
          items: items.map(({ record, ownerName }) => ({
            ...record,
            ownerName: ownerName ?? null,
          })),
        };
      });
    },
  );

  app.post(
    '/enterprise/blueprint/:code/records',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: CodeParams, body: createInput },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const code = String(request.params.code);
      const pkg = operablePackage(code);
      const schema = enterpriseFieldSchema(code);
      let fields = request.body.fields;
      let typedFields: EnterpriseFieldValues | null = null;
      if (schema) {
        typedFields = validateTypedFields(schema, fields, { required: true });
        fields = computeEnterpriseFieldValues(schema, typedFields);
      } else {
        validateFields(pkg, fields);
      }
      const typedProjectId =
        typedFields && typeof typedFields.project === 'string' ? typedFields.project : undefined;
      if (request.body.projectId && typedProjectId && request.body.projectId !== typedProjectId) {
        throw problem(
          'validation_failed',
          'The project field and projectId must reference the same project.',
        );
      }
      const projectId = request.body.projectId ?? typedProjectId;
      const ownerUserId = request.body.ownerUserId ?? null;
      const blockedReason = cleanBlockedReason(request.body.blockedReason);
      const created = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        if (schema && typedFields)
          await validateTypedReferences(tx, org.orgId, schema, typedFields);
        if (projectId) await checkProject(tx, org.orgId, projectId);
        if (ownerUserId) await checkOwner(tx, org.orgId, ownerUserId);
        if (request.body.clientRequestId) {
          const [existing] = await tx
            .select()
            .from(enterpriseBlueprintRecords)
            .where(
              and(
                eq(enterpriseBlueprintRecords.orgId, org.orgId),
                eq(enterpriseBlueprintRecords.clientRequestId, request.body.clientRequestId),
              ),
            );
          if (existing) return { record: existing, created: false };
        }
        const [row] = await tx
          .insert(enterpriseBlueprintRecords)
          .values({
            orgId: org.orgId,
            projectId: projectId ?? null,
            packageCode: code,
            title: request.body.title,
            status: pkg.lifecycle[0] ?? 'draft',
            fields,
            ownerUserId,
            dueOn: request.body.dueOn ?? null,
            slaHours: request.body.slaHours ?? null,
            blockedReason,
            blockedAt: blockedReason ? new Date() : null,
            notes: request.body.notes ?? null,
            clientRequestId: request.body.clientRequestId ?? null,
            createdByUserId: org.userId,
          })
          .returning();
        if (!row) throw new Error('Blueprint record insert failed');
        await audit(tx, org.orgId, org.userId, row.id, 'blueprint.record_created', null, row);
        return { record: row, created: true };
      });
      return reply.code(created.created ? 201 : 200).send(created.record);
    },
  );

  app.patch(
    '/enterprise/blueprint/records/:id',
    {
      config: { permission: 'job:write', rateLimit: { max: 90, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: RecordParams, body: updateInput },
    },
    async (request) => {
      const org = requireOrg(request);
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(enterpriseBlueprintRecords)
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              eq(enterpriseBlueprintRecords.id, request.params.id),
            ),
          )
          .for('update');
        if (!row) throw problem('not_found');
        assertRevision(row.revision, revision);
        const pkg = findWorkPackage(row.packageCode);
        if (!pkg)
          throw problem(
            'conflict',
            'This record references a work package that is no longer in the catalog.',
          );
        if (request.body.status !== undefined && !isWorkPackageStatus(pkg, request.body.status)) {
          throw problem('validation_failed', 'Status is not part of this work package lifecycle.');
        }
        const nextStatus = request.body.status ?? row.status;
        const finished = isEnterpriseRecordFinished(nextStatus);
        const requestedBlockedReason = cleanBlockedReason(request.body.blockedReason);
        if (finished && requestedBlockedReason) {
          throw problem('validation_failed', 'A finished record cannot be blocked.');
        }
        const nextBlockedReason = finished
          ? null
          : request.body.blockedReason !== undefined
            ? requestedBlockedReason
            : row.blockedReason;
        const nextBlockedAt = finished || !nextBlockedReason ? null : (row.blockedAt ?? new Date());
        if (request.body.ownerUserId && request.body.ownerUserId !== row.ownerUserId)
          await checkOwner(tx, org.orgId, request.body.ownerUserId);
        const schema = enterpriseFieldSchema(row.packageCode);
        let nextFields = row.fields;
        let nextProjectId = row.projectId;
        if (request.body.fields) {
          if (schema) {
            const normalized = validateTypedFields(schema, request.body.fields, {
              required: false,
            });
            await validateTypedReferences(tx, org.orgId, schema, normalized);
            if (typeof normalized.project === 'string') nextProjectId = normalized.project;
            nextFields = computeEnterpriseFieldValues(schema, {
              ...row.fields,
              ...normalized,
            });
          } else {
            validateFields(pkg, request.body.fields);
            nextFields = { ...row.fields, ...request.body.fields };
          }
        }
        const [updated] = await tx
          .update(enterpriseBlueprintRecords)
          .set({
            status: nextStatus,
            projectId: nextProjectId,
            fields: nextFields,
            ownerUserId:
              request.body.ownerUserId !== undefined ? request.body.ownerUserId : row.ownerUserId,
            dueOn: request.body.dueOn !== undefined ? request.body.dueOn : row.dueOn,
            slaHours: request.body.slaHours !== undefined ? request.body.slaHours : row.slaHours,
            blockedReason: nextBlockedReason,
            blockedAt: nextBlockedAt,
            notes: request.body.notes ?? row.notes,
            revision: row.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(enterpriseBlueprintRecords.id, row.id))
          .returning();
        await audit(tx, org.orgId, org.userId, row.id, 'blueprint.record_updated', row, updated);
        return updated;
      });
    },
  );

  app.get(
    '/enterprise/blueprint/records/:id/links',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: RecordParams,
        summary: 'List typed links and blocking impact for a blueprint record',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [record] = await tx
          .select({ id: enterpriseBlueprintRecords.id })
          .from(enterpriseBlueprintRecords)
          .where(
            and(
              eq(enterpriseBlueprintRecords.orgId, org.orgId),
              eq(enterpriseBlueprintRecords.id, request.params.id),
            ),
          );
        if (!record) throw problem('not_found');

        const rows = await tx
          .select()
          .from(enterpriseBlueprintRecordLinks)
          .where(
            and(
              eq(enterpriseBlueprintRecordLinks.orgId, org.orgId),
              or(
                eq(enterpriseBlueprintRecordLinks.fromRecordId, record.id),
                eq(enterpriseBlueprintRecordLinks.toRecordId, record.id),
              ),
            ),
          )
          .orderBy(desc(enterpriseBlueprintRecordLinks.createdAt))
          .limit(500);
        const blockRows = await tx
          .select({
            fromRecordId: enterpriseBlueprintRecordLinks.fromRecordId,
            toRecordId: enterpriseBlueprintRecordLinks.toRecordId,
          })
          .from(enterpriseBlueprintRecordLinks)
          .where(
            and(
              eq(enterpriseBlueprintRecordLinks.orgId, org.orgId),
              eq(enterpriseBlueprintRecordLinks.kind, 'blocks'),
            ),
          );
        const downstreamIds = enterpriseBlockClosure(blockRows, record.id, 'downstream');
        const upstreamIds = enterpriseBlockClosure(blockRows, record.id, 'upstream');
        const directIds = rows.flatMap((link) => [link.fromRecordId, link.toRecordId]);
        const summaries = await loadRecordSummaries(tx, org.orgId, [
          ...new Set([...directIds, ...downstreamIds, ...upstreamIds]),
        ]);
        const summary = (id: string) => summaries.get(id) ?? null;
        return {
          recordId: record.id,
          links: rows.flatMap((link) => {
            const otherId = link.fromRecordId === record.id ? link.toRecordId : link.fromRecordId;
            const other = summary(otherId);
            if (!other) return [];
            return [
              {
                id: link.id,
                kind: link.kind,
                direction: link.fromRecordId === record.id ? 'outgoing' : 'incoming',
                note: link.note,
                createdAt: link.createdAt,
                record: other,
              },
            ];
          }),
          impact: {
            upstream: upstreamIds.flatMap((id) => {
              const item = summary(id);
              return item ? [item] : [];
            }),
            downstream: downstreamIds.flatMap((id) => {
              const item = summary(id);
              return item ? [item] : [];
            }),
          },
        };
      });
    },
  );

  app.post(
    '/enterprise/blueprint/records/:id/links',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: RecordParams,
        body: linkInput,
        summary: 'Create a typed link between blueprint records',
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const source = await lockRecord(tx, org.orgId, request.params.id);
        if (!source) throw problem('not_found');
        if (source.id === request.body.toRecordId)
          throw problem('validation_failed', 'A record cannot link to itself.');
        const target = await lockRecord(tx, org.orgId, request.body.toRecordId);
        if (!target) throw problem('not_found');
        const invalid = enterpriseLinkValidation(
          request.body.kind as EnterpriseLinkKind,
          source.packageCode,
          target.packageCode,
          source.projectId,
          target.projectId,
        );
        if (invalid) throw problem('validation_failed', invalid);
        const [existing] = await tx
          .select({ id: enterpriseBlueprintRecordLinks.id })
          .from(enterpriseBlueprintRecordLinks)
          .where(
            and(
              eq(enterpriseBlueprintRecordLinks.orgId, org.orgId),
              eq(enterpriseBlueprintRecordLinks.fromRecordId, source.id),
              eq(enterpriseBlueprintRecordLinks.toRecordId, target.id),
              eq(enterpriseBlueprintRecordLinks.kind, request.body.kind),
            ),
          );
        if (existing) throw problem('conflict', 'These records already have that typed link.');
        if (enterpriseLinkRule(request.body.kind as EnterpriseLinkKind).cycleCheck) {
          const blockRows = await tx
            .select({
              fromRecordId: enterpriseBlueprintRecordLinks.fromRecordId,
              toRecordId: enterpriseBlueprintRecordLinks.toRecordId,
            })
            .from(enterpriseBlueprintRecordLinks)
            .where(
              and(
                eq(enterpriseBlueprintRecordLinks.orgId, org.orgId),
                eq(enterpriseBlueprintRecordLinks.kind, 'blocks'),
              ),
            );
          if (wouldCreateEnterpriseBlockCycle(blockRows, source.id, target.id))
            throw problem('validation_failed', 'That block link would create a dependency cycle.');
        }
        const [link] = await tx
          .insert(enterpriseBlueprintRecordLinks)
          .values({
            orgId: org.orgId,
            fromRecordId: source.id,
            toRecordId: target.id,
            kind: request.body.kind,
            note: cleanBlockedReason(request.body.note),
            createdByUserId: org.userId,
          })
          .returning();
        if (!link) throw new Error('Blueprint record link insert failed');
        await audit(
          tx,
          org.orgId,
          org.userId,
          source.id,
          'blueprint.record_link_created',
          null,
          link,
        );
        return reply.code(201).send(link);
      });
    },
  );

  app.delete(
    '/enterprise/blueprint/records/:id/links/:linkId',
    {
      config: { permission: 'job:write', rateLimit: { max: 90, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: LinkParams,
        summary: 'Remove an outgoing typed link from a blueprint record',
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [link] = await tx
          .select()
          .from(enterpriseBlueprintRecordLinks)
          .where(
            and(
              eq(enterpriseBlueprintRecordLinks.orgId, org.orgId),
              eq(enterpriseBlueprintRecordLinks.id, request.params.linkId),
              eq(enterpriseBlueprintRecordLinks.fromRecordId, request.params.id),
            ),
          );
        if (!link) throw problem('not_found');
        await tx
          .delete(enterpriseBlueprintRecordLinks)
          .where(eq(enterpriseBlueprintRecordLinks.id, link.id));
        await audit(
          tx,
          org.orgId,
          org.userId,
          link.fromRecordId,
          'blueprint.record_link_deleted',
          link,
          null,
        );
        return reply.code(204).send();
      });
    },
  );
};

export default enterpriseBlueprintModule;
