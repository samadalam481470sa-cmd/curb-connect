// Evidence-backed compliance for the 18 control gates in the Enterprise control-level addendum.
// Each gate carries an owner, a refresh date, reviewed evidence and optional encrypted attachments.
// Gate status derives from accepted, unexpired evidence, and the audit packet is a checksummed
// snapshot an auditor can verify without trusting the screen.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import {
  CONTROL_AUDIT_PACKET_VERSION,
  CONTROL_COMPLIANCE_STATUSES,
  CONTROL_COMPLIANCE_WARNING_DAYS,
  CONTROL_EVIDENCE_MAX_BYTES,
  CONTROL_GATE_DEFINITIONS,
  ENTERPRISE_CONTROL_MODULES,
  controlGateCompliance,
  findControlGate,
  findControlModule,
  type ControlComplianceStatus,
  type ControlGateDefinition,
} from '@fieldline/contracts';
import { users } from '../../db/schema/auth';
import { organizations } from '../../db/schema/orgs';
import {
  enterpriseControlEvidence as evidence,
  enterpriseControlRequirements as requirements,
} from '../../db/schema/enterpriseControl';
import { memberships } from '../../db/schema/team';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { problem } from '../../http/problem';
import { orgIdFromKey, safeFileName } from '../../storage';
import { audit, checkEnabled } from './access';
import { controlPacketDigest, sha256Hex } from './controlPacket';
import { readVerifiedEnterpriseDocument } from './documentStorage';

const EVIDENCE_BODY_LIMIT = 4 * Math.ceil(CONTROL_EVIDENCE_MAX_BYTES / 3) + 32 * 1024;

const IsoDate = z.iso.date().refine((value) => {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}, 'Enter a real calendar date.');

const ModuleGateParams = z.object({
  moduleKey: z.string().trim().min(1).max(80),
  gateKey: z.string().trim().min(1).max(80),
});
const EvidenceParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  module: z.string().trim().min(1).max(80).optional(),
});
const RequirementInput = z
  .object({
    ownerUserId: z.uuid().nullable().optional(),
    expiresOn: IsoDate.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (body) =>
      body.ownerUserId !== undefined || body.expiresOn !== undefined || body.notes !== undefined,
    { message: 'Provide an owner, expiry date or note.' },
  );
const EvidenceInput = z
  .object({
    title: z.string().trim().min(2).max(180),
    note: z.string().trim().max(4000).optional(),
    evidenceOn: IsoDate,
    expiresOn: IsoDate.nullable().optional(),
    sourceReference: z.string().trim().max(1000).nullable().optional(),
    filename: z.string().trim().min(1).max(180).optional(),
    contentBase64: z
      .base64()
      .min(4)
      .max(4 * Math.ceil(CONTROL_EVIDENCE_MAX_BYTES / 3))
      .optional(),
  })
  .refine((body) => (body.filename === undefined) === (body.contentBase64 === undefined), {
    message: 'Provide both a filename and the PDF contents, or neither.',
  })
  .refine((body) => !body.expiresOn || body.expiresOn >= body.evidenceOn, {
    message: 'Evidence expiry must be on or after the evidence date.',
  });
const ReviewInput = z.object({
  decision: z.enum(['accepted', 'rejected']),
  note: z.string().trim().min(3).max(2000),
});

type RequirementRow = typeof requirements.$inferSelect;
type EvidenceRow = typeof evidence.$inferSelect;

interface RequirementScope {
  readonly moduleKey: string;
  readonly gateKey: string;
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function checkedScope(params: RequirementScope): {
  module: (typeof ENTERPRISE_CONTROL_MODULES)[number];
  gate: ControlGateDefinition;
} {
  const module = findControlModule(params.moduleKey);
  if (!module) throw problem('not_found', 'That control module is not in the addendum.');
  const gate = findControlGate(params.gateKey);
  if (!gate) throw problem('not_found', 'That control gate is not in the addendum.');
  return { module, gate };
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

function cleanOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function evidenceDto(row: EvidenceRow) {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    evidenceOn: row.evidenceOn,
    expiresOn: row.expiresOn,
    sourceReference: row.sourceReference,
    filename: row.filename,
    hasAttachment: Boolean(row.storageKey),
    sha256Hex: row.fileSha256,
    byteSize: row.fileBytes,
    reviewStatus: row.reviewStatus,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewNote: row.reviewNote,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

interface ComplianceGateDto {
  moduleKey: string;
  gateKey: string;
  order: number;
  title: string;
  requirement: string;
  evidenceStandard: string;
  validityDays: number;
  id: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  expiresOn: string | null;
  notes: string | null;
  revision: number;
  updatedAt: string | null;
  status: ControlComplianceStatus;
  reasons: readonly string[];
  nextExpiry: string | null;
  counts: { accepted: number; pending: number; rejected: number; expired: number };
  evidence: ReturnType<typeof evidenceDto>[];
}

function summarizeGates(gates: readonly ComplianceGateDto[]) {
  const byStatus = Object.fromEntries(
    CONTROL_COMPLIANCE_STATUSES.map((status) => [status, 0]),
  ) as Record<ControlComplianceStatus, number>;
  for (const gate of gates) byStatus[gate.status] += 1;
  return {
    total: gates.length,
    ...byStatus,
    ownersAssigned: gates.filter((gate) => gate.ownerUserId !== null).length,
    attachments: gates.reduce(
      (total, gate) => total + gate.evidence.filter((item) => item.hasAttachment).length,
      0,
    ),
  };
}

async function loadCompliance(tx: Tx, orgId: string, moduleKey?: string) {
  const modules = moduleKey ? [findControlModule(moduleKey)] : [...ENTERPRISE_CONTROL_MODULES];
  if (modules.some((module) => !module)) throw problem('not_found');
  const moduleKeys = modules.flatMap((module) => (module ? [module.key] : []));

  const requirementRows = await tx
    .select({ requirement: requirements, ownerName: users.displayName })
    .from(requirements)
    .leftJoin(users, eq(users.id, requirements.ownerUserId))
    .where(and(eq(requirements.orgId, orgId), inArray(requirements.moduleKey, moduleKeys)));
  const evidenceRows = await tx
    .select()
    .from(evidence)
    .where(and(eq(evidence.orgId, orgId), inArray(evidence.moduleKey, moduleKeys)))
    .orderBy(desc(evidence.createdAt), desc(evidence.id));

  const assignments = new Map<string, { requirement: RequirementRow; ownerName: string | null }>();
  for (const row of requirementRows) {
    assignments.set(`${row.requirement.moduleKey}:${row.requirement.gateKey}`, row);
  }
  const evidenceByGate = new Map<string, EvidenceRow[]>();
  for (const row of evidenceRows) {
    const key = `${row.moduleKey}:${row.gateKey}`;
    const list = evidenceByGate.get(key) ?? [];
    list.push(row);
    evidenceByGate.set(key, list);
  }

  const today = todayIso();
  const payload = modules.flatMap((module) => {
    if (!module) return [];
    const gates: ComplianceGateDto[] = CONTROL_GATE_DEFINITIONS.map((gate) => {
      const assignment = assignments.get(`${module.key}:${gate.key}`);
      const gateEvidence = evidenceByGate.get(`${module.key}:${gate.key}`) ?? [];
      const compliance = controlGateCompliance({
        ownerUserId: assignment?.requirement.ownerUserId ?? null,
        expiresOn: assignment?.requirement.expiresOn ?? null,
        evidence: gateEvidence.map((row) => ({
          reviewStatus: row.reviewStatus,
          expiresOn: row.expiresOn,
        })),
        today,
      });
      return {
        moduleKey: module.key,
        gateKey: gate.key,
        order: gate.order,
        title: gate.title,
        requirement: gate.requirement,
        evidenceStandard: gate.evidenceStandard,
        validityDays: gate.validityDays,
        id: assignment?.requirement.id ?? null,
        ownerUserId: assignment?.requirement.ownerUserId ?? null,
        ownerName: assignment?.ownerName ?? null,
        expiresOn: assignment?.requirement.expiresOn ?? null,
        notes: assignment?.requirement.notes ?? null,
        revision: assignment?.requirement.revision ?? 0,
        updatedAt: assignment?.requirement.updatedAt.toISOString() ?? null,
        status: compliance.status,
        reasons: compliance.reasons,
        nextExpiry: compliance.nextExpiry,
        counts: {
          accepted: compliance.accepted,
          pending: compliance.pending,
          rejected: compliance.rejected,
          expired: compliance.expired,
        },
        evidence: gateEvidence.map(evidenceDto),
      };
    });
    return [
      {
        key: module.key,
        title: module.title,
        summary: module.summary,
        workPackageCodes: module.workPackageCodes,
        counts: summarizeGates(gates),
        requirements: gates,
      },
    ];
  });

  const allGates = payload.flatMap((module) => module.requirements);
  return {
    today,
    warningDays: CONTROL_COMPLIANCE_WARNING_DAYS,
    scope: moduleKey ?? null,
    counts: summarizeGates(allGates),
    modules: payload,
  };
}

async function ensureRequirement(tx: Tx, orgId: string, userId: string, scope: RequirementScope) {
  await tx
    .insert(requirements)
    .values({
      orgId,
      moduleKey: scope.moduleKey,
      gateKey: scope.gateKey,
      createdByUserId: userId,
      updatedByUserId: userId,
    })
    .onConflictDoNothing({
      target: [requirements.orgId, requirements.moduleKey, requirements.gateKey],
    });
}

const enterpriseControlModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/blueprint/controls',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        querystring: ListQuery,
        summary: 'List evidence-backed control gate requirements',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        return loadCompliance(tx, org.orgId, request.query.module);
      });
    },
  );

  app.put(
    '/enterprise/blueprint/controls/:moduleKey/:gateKey',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ModuleGateParams,
        body: RequirementInput,
        summary: 'Assign an owner, expiry or note to a control gate',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const scope = checkedScope(request.params);
      const body = request.body;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        if (body.ownerUserId) await checkOwner(tx, org.orgId, body.ownerUserId);
        const [existing] = await tx
          .select()
          .from(requirements)
          .where(
            and(
              eq(requirements.orgId, org.orgId),
              eq(requirements.moduleKey, scope.module.key),
              eq(requirements.gateKey, scope.gate.key),
            ),
          )
          .for('update');

        const values = {
          ownerUserId: body.ownerUserId,
          expiresOn: body.expiresOn === undefined ? undefined : body.expiresOn,
          notes: body.notes === undefined ? undefined : cleanOptional(body.notes),
        };

        let updated: RequirementRow | undefined;
        if (existing) {
          assertRevision(existing.revision, parseIfMatch(request));
          [updated] = await tx
            .update(requirements)
            .set({
              ownerUserId:
                values.ownerUserId === undefined ? existing.ownerUserId : values.ownerUserId,
              expiresOn: values.expiresOn === undefined ? existing.expiresOn : values.expiresOn,
              notes: values.notes === undefined ? existing.notes : values.notes,
              updatedByUserId: org.userId,
              revision: existing.revision + 1,
              updatedAt: new Date(),
            })
            .where(eq(requirements.id, existing.id))
            .returning();
        } else {
          [updated] = await tx
            .insert(requirements)
            .values({
              orgId: org.orgId,
              moduleKey: scope.module.key,
              gateKey: scope.gate.key,
              ownerUserId: values.ownerUserId ?? null,
              expiresOn: values.expiresOn ?? null,
              notes: values.notes ?? null,
              createdByUserId: org.userId,
              updatedByUserId: org.userId,
            })
            .onConflictDoNothing({
              target: [requirements.orgId, requirements.moduleKey, requirements.gateKey],
            })
            .returning();
          if (!updated) {
            const [raced] = await tx
              .select()
              .from(requirements)
              .where(
                and(
                  eq(requirements.orgId, org.orgId),
                  eq(requirements.moduleKey, scope.module.key),
                  eq(requirements.gateKey, scope.gate.key),
                ),
              )
              .for('update');
            if (!raced) throw problem('conflict', 'The requirement changed. Reload and try again.');
            assertRevision(raced.revision, parseIfMatch(request));
            [updated] = await tx
              .update(requirements)
              .set({
                ownerUserId:
                  values.ownerUserId === undefined ? raced.ownerUserId : values.ownerUserId,
                expiresOn: values.expiresOn === undefined ? raced.expiresOn : values.expiresOn,
                notes: values.notes === undefined ? raced.notes : values.notes,
                updatedByUserId: org.userId,
                revision: raced.revision + 1,
                updatedAt: new Date(),
              })
              .where(eq(requirements.id, raced.id))
              .returning();
          }
        }
        if (!updated) throw new Error('Control requirement update failed.');
        await audit(
          tx,
          org.orgId,
          org.userId,
          'control_requirement',
          updated.id,
          'control.requirement_assigned',
          existing ?? null,
          updated,
        );
        return { ...updated, updatedAt: updated.updatedAt.toISOString() };
      });
    },
  );

  app.post(
    '/enterprise/blueprint/controls/:moduleKey/:gateKey/evidence',
    {
      bodyLimit: EVIDENCE_BODY_LIMIT,
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: ModuleGateParams,
        body: EvidenceInput,
        summary: 'Attach evidence to a control gate for review',
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const scope = checkedScope(request.params);
      const { storage, scanner, config } = request.server;
      const evidenceId = crypto.randomUUID();
      let bytes: Buffer | null = null;
      let storageKey: string | null = null;
      let storageAttempted = false;

      if (request.body.contentBase64) {
        bytes = Buffer.from(request.body.contentBase64, 'base64');
        if (bytes.length > Math.min(CONTROL_EVIDENCE_MAX_BYTES, config.storage.maxUploadBytes)) {
          throw problem('payload_too_large', 'This evidence file exceeds the upload limit.');
        }
        const kind = await fileTypeFromBuffer(bytes).catch(() => undefined);
        if (kind?.mime !== 'application/pdf')
          throw problem('unsupported_media_type', 'Evidence attachments must be PDF documents.');
        const scanStatus = await scanner.scan(bytes);
        if (scanStatus === 'infected')
          throw problem('media_rejected', 'The file scan rejected this PDF.');
        if (scanStatus !== 'clean' && scanStatus !== 'not_scanned')
          throw problem('conflict', 'The file scan did not finish. Try uploading again.');
        storageKey = `orgs/${org.orgId}/enterprise/control-evidence/${evidenceId}`;
      }

      try {
        const created = await tenantTx(request, async (tx) => {
          await checkEnabled(tx, org.orgId);
          await ensureRequirement(tx, org.orgId, org.userId, {
            moduleKey: scope.module.key,
            gateKey: scope.gate.key,
          });
          if (bytes && storageKey) {
            storageAttempted = true;
            await storage.put(storageKey, bytes, 'application/pdf');
          }
          const [row] = await tx
            .insert(evidence)
            .values({
              id: evidenceId,
              orgId: org.orgId,
              moduleKey: scope.module.key,
              gateKey: scope.gate.key,
              title: request.body.title,
              note: cleanOptional(request.body.note),
              evidenceOn: request.body.evidenceOn,
              expiresOn:
                request.body.expiresOn ?? addDays(request.body.evidenceOn, scope.gate.validityDays),
              sourceReference: cleanOptional(request.body.sourceReference),
              filename: request.body.filename ? safeFileName(request.body.filename) : null,
              storageKey,
              fileSha256: bytes ? sha256Hex(bytes) : null,
              fileBytes: bytes ? bytes.length : null,
              createdByUserId: org.userId,
            })
            .returning();
          if (!row) throw new Error('Control evidence insert failed.');
          await audit(
            tx,
            org.orgId,
            org.userId,
            'control_evidence',
            row.id,
            'control.evidence_added',
            null,
            { moduleKey: row.moduleKey, gateKey: row.gateKey, title: row.title },
          );
          return row;
        });
        return reply.code(201).send(evidenceDto(created));
      } catch (error) {
        if (storageAttempted && storageKey) {
          try {
            const [registered] = await tenantTx(request, (tx) =>
              tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.id, evidenceId)),
            );
            if (!registered) await storage.delete(storageKey);
          } catch {
            request.log.warn(
              { evidenceId },
              'Could not reconcile an interrupted control evidence upload',
            );
          }
        }
        throw error;
      }
    },
  );

  app.post(
    '/enterprise/blueprint/control-evidence/:id/review',
    {
      config: { permission: 'review_task:decide', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: EvidenceParams,
        body: ReviewInput,
        summary: 'Accept or reject control evidence',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [row] = await tx
          .select()
          .from(evidence)
          .where(and(eq(evidence.orgId, org.orgId), eq(evidence.id, request.params.id)))
          .for('update');
        if (!row) throw problem('not_found');
        if (row.reviewStatus !== 'pending')
          throw problem('conflict', 'This evidence already has a review decision.');
        if (row.createdByUserId === org.userId && request.body.decision === 'accepted') {
          throw problem(
            'forbidden',
            'A different reviewer must accept evidence that you submitted.',
          );
        }
        const [updated] = await tx
          .update(evidence)
          .set({
            reviewStatus: request.body.decision,
            reviewedByUserId: org.userId,
            reviewedAt: new Date(),
            reviewNote: request.body.note,
          })
          .where(eq(evidence.id, row.id))
          .returning();
        if (!updated) throw new Error('Control evidence review failed.');
        await audit(
          tx,
          org.orgId,
          org.userId,
          'control_evidence',
          row.id,
          'control.evidence_reviewed',
          { reviewStatus: row.reviewStatus },
          { reviewStatus: updated.reviewStatus, reviewNote: updated.reviewNote },
        );
        return evidenceDto(updated);
      });
    },
  );

  app.get(
    '/enterprise/blueprint/control-evidence/:id/download',
    {
      config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: EvidenceParams,
        summary: 'Download a control evidence attachment',
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const row = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const [item] = await tx
          .select()
          .from(evidence)
          .where(and(eq(evidence.orgId, org.orgId), eq(evidence.id, request.params.id)));
        if (!item?.storageKey || !item.fileSha256 || !item.fileBytes) throw problem('not_found');
        if (orgIdFromKey(item.storageKey) !== org.orgId) throw problem('not_found');
        return item;
      });
      const bytes = await readVerifiedEnterpriseDocument(app.storage, org.orgId, {
        storageKey: row.storageKey!,
        byteSize: row.fileBytes!,
        sha256Hex: row.fileSha256!,
      });
      await tenantTx(request, (tx) =>
        audit(tx, org.orgId, org.userId, 'control_evidence', row.id, 'control.evidence_downloaded'),
      );
      return reply
        .type('application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="${safeFileName(row.filename ?? 'evidence.pdf')}"`,
        )
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );

  app.get(
    '/enterprise/blueprint/controls/audit-packet',
    {
      config: { permission: 'job:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        querystring: ListQuery,
        summary: 'Export a checksummed control compliance audit packet',
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const generatedAt = new Date();
      const packet = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const compliance = await loadCompliance(tx, org.orgId, request.query.module);
        const [organization] = await tx
          .select({ id: organizations.id, name: organizations.displayName })
          .from(organizations)
          .where(eq(organizations.id, org.orgId));
        const payload = {
          packetVersion: CONTROL_AUDIT_PACKET_VERSION,
          generatedAt: generatedAt.toISOString(),
          generatedByUserId: org.userId,
          organization: organization ?? { id: org.orgId, name: null },
          scope: {
            moduleKey: request.query.module ?? null,
            modules: compliance.modules.length,
            gates: compliance.counts.total,
          },
          policy: {
            warningDays: CONTROL_COMPLIANCE_WARNING_DAYS,
            evidenceRule:
              'A gate is satisfied only by accepted evidence that has not expired; pending and rejected evidence is not proof.',
            reviewRule:
              'Evidence is reviewed by a member with review_task:decide, and the submitter cannot accept their own evidence.',
            digestRule:
              'SHA-256 of the canonical JSON packet (recursively sorted object keys) with the integrity field removed.',
            statuses: CONTROL_COMPLIANCE_STATUSES,
          },
          summary: compliance.counts,
          modules: compliance.modules,
        };
        const digest = controlPacketDigest(payload);
        const body = {
          ...payload,
          integrity: { algorithm: 'sha256' as const, digest },
        };
        await audit(
          tx,
          org.orgId,
          org.userId,
          'control_audit_packet',
          org.orgId,
          'control.audit_packet_exported',
          null,
          { moduleKey: request.query.module ?? null, digest },
        );
        return body;
      });
      const suffix = request.query.module ? `-${request.query.module}` : '';
      return reply
        .header(
          'content-disposition',
          `attachment; filename="fieldline-control-audit-${todayIso(generatedAt)}${safeFileName(suffix)}.json"`,
        )
        .header('cache-control', 'private, no-store')
        .send(packet);
    },
  );
};

export default enterpriseControlModule;
