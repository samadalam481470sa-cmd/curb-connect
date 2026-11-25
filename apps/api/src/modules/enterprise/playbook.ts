// Project playbook: a phase-by-phase view of the required blueprint records for one project.
// The package selection is read-only guidance from @fieldline/contracts; record state is joined
// from the tenant-scoped blueprint records so owners and next actions stay live.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ENTERPRISE_PLAYBOOK_PHASES,
  ENTERPRISE_PLAYBOOK_PHASE_KEYS,
  ENTERPRISE_PROJECT_TYPE_KEYS,
  enterprisePlaybookPhase,
  enterprisePlaybookSelection,
  enterpriseProjectType,
  enterpriseWorkflowState,
  findWorkPackage,
  isEnterpriseRecordFinished,
  nextLifecycleStage,
  workPackageLabel,
} from '@fieldline/contracts';
import { enterpriseBlueprintRecords } from '../../db/schema/enterpriseBlueprint';
import { users } from '../../db/schema/auth';
import { requireOrg, tenantTx } from '../../http/context';
import { checkEnabled, checkProject } from './access';

const ProjectPlaybookParams = z.object({ projectId: z.uuid() });
const playbookQuery = z.object({
  type: z.enum(ENTERPRISE_PROJECT_TYPE_KEYS),
  phase: z.enum(ENTERPRISE_PLAYBOOK_PHASE_KEYS).optional(),
});

type PlaybookStepStatus = 'missing' | 'in_progress' | 'blocked' | 'at_risk' | 'complete';
type PlaybookGateStatus = 'not_started' | 'in_progress' | 'at_risk' | 'blocked' | 'complete';
type PlaybookActionKind = 'create' | 'advance' | 'clear_block' | 'review' | 'complete';

interface PlaybookNextAction {
  readonly kind: PlaybookActionKind;
  readonly label: string;
  readonly detail: string;
}

function nextAction(
  pkg: NonNullable<ReturnType<typeof findWorkPackage>>,
  latest: { record: typeof enterpriseBlueprintRecords.$inferSelect } | undefined,
  state: ReturnType<typeof enterpriseWorkflowState> | null,
  status: PlaybookStepStatus,
): PlaybookNextAction {
  if (!latest || status === 'missing') {
    return {
      kind: 'create',
      label: `Create the ${pkg.title} record`,
      detail: pkg.actions[0] ?? 'Open the work package and create the first record.',
    };
  }
  if (status === 'blocked') {
    return {
      kind: 'clear_block',
      label: 'Clear the record block',
      detail: latest.record.blockedReason ?? 'The record is explicitly blocked.',
    };
  }
  if (status === 'at_risk') {
    const reasons: string[] = [];
    if (state?.overdue) reasons.push(`due ${latest.record.dueOn ?? 'date passed'}`);
    if (state?.slaBreached) reasons.push('SLA target passed');
    return {
      kind: 'review',
      label: 'Review the overdue record',
      detail: reasons.join(' · ') || 'The record needs attention before the gate can close.',
    };
  }
  if (status === 'complete') {
    return {
      kind: 'complete',
      label: 'Required record complete',
      detail: `Latest record is ${workPackageLabel(latest.record.status)}.`,
    };
  }
  const next = nextLifecycleStage(pkg, latest.record.status);
  if (next) {
    return {
      kind: 'advance',
      label: `Advance to ${workPackageLabel(next)}`,
      detail: `Current stage is ${workPackageLabel(latest.record.status)}.`,
    };
  }
  return {
    kind: 'review',
    label: 'Review the current stage',
    detail: 'The record is active but has no next lifecycle stage.',
  };
}

const enterprisePlaybookModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/projects/:projectId/playbook',
    {
      config: { permission: 'job:read' },
      schema: {
        tags: ['enterprise'],
        params: ProjectPlaybookParams,
        querystring: playbookQuery,
        summary: 'Required blueprint records, gates, owners and next actions for a project',
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const now = new Date();
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, org.orgId);
        const project = await checkProject(tx, org.orgId, request.params.projectId);
        const projectType = enterpriseProjectType(request.query.type);
        const selection = enterprisePlaybookSelection(request.query.type, request.query.phase);
        const codes = [...new Set(selection.map((step) => step.packageCode))];
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
              eq(enterpriseBlueprintRecords.projectId, project.id),
              inArray(enterpriseBlueprintRecords.packageCode, codes),
            ),
          )
          .orderBy(
            desc(enterpriseBlueprintRecords.updatedAt),
            desc(enterpriseBlueprintRecords.createdAt),
          );

        const byPackage = new Map<string, typeof rows>();
        for (const row of rows) {
          const packageRows = byPackage.get(row.record.packageCode) ?? [];
          packageRows.push(row);
          byPackage.set(row.record.packageCode, packageRows);
        }

        const steps = selection.flatMap(({ packageCode, phase }) => {
          const pkg = findWorkPackage(packageCode);
          if (!pkg) return [];
          const packageRows = byPackage.get(packageCode) ?? [];
          const latest = packageRows[0];
          const state = latest ? enterpriseWorkflowState(latest.record, now) : null;
          const status: PlaybookStepStatus = !latest
            ? 'missing'
            : isEnterpriseRecordFinished(latest.record.status)
              ? 'complete'
              : state?.blocked
                ? 'blocked'
                : state?.overdue || state?.slaBreached
                  ? 'at_risk'
                  : 'in_progress';
          return [
            {
              packageCode,
              title: pkg.title,
              domain: pkg.domain,
              releaseGate: pkg.gate,
              phase,
              owner: {
                name: latest?.ownerName ?? pkg.owner,
                role: pkg.owner,
                source: latest?.ownerName ? ('record' as const) : ('package' as const),
              },
              recordCount: packageRows.length,
              record: latest ? { ...latest.record, ownerName: latest.ownerName } : null,
              status,
              nextAction: nextAction(pkg, latest, state, status),
            },
          ];
        });

        const phaseDefinitions = request.query.phase
          ? [enterprisePlaybookPhase(request.query.phase)]
          : ENTERPRISE_PLAYBOOK_PHASES;
        const phases = phaseDefinitions.map((definition) => {
          const phaseSteps = steps.filter((step) => step.phase === definition.key);
          const required = phaseSteps.length;
          const recorded = phaseSteps.filter((step) => step.status !== 'missing').length;
          const complete = phaseSteps.filter((step) => step.status === 'complete').length;
          const blocked = phaseSteps.filter((step) => step.status === 'blocked').length;
          const atRisk = phaseSteps.filter((step) => step.status === 'at_risk').length;
          const status: PlaybookGateStatus =
            required > 0 && complete === required
              ? 'complete'
              : blocked > 0
                ? 'blocked'
                : atRisk > 0
                  ? 'at_risk'
                  : recorded > 0
                    ? 'in_progress'
                    : 'not_started';
          return {
            key: definition.key,
            label: definition.label,
            description: definition.description,
            gate: {
              label: definition.gateLabel,
              description: definition.gateDescription,
              status,
              required,
              recorded,
              complete,
              blocked,
              atRisk,
            },
            steps: phaseSteps,
          };
        });

        const allSteps = phases.flatMap((phase) => phase.steps);
        const nextStep = allSteps.find((step) => step.status !== 'complete') ?? null;
        return {
          project: { id: project.id, name: project.name },
          projectType,
          phase: request.query.phase ? enterprisePlaybookPhase(request.query.phase) : null,
          generatedAt: now.toISOString(),
          summary: {
            required: allSteps.length,
            recorded: allSteps.filter((step) => step.status !== 'missing').length,
            complete: allSteps.filter((step) => step.status === 'complete').length,
            missing: allSteps.filter((step) => step.status === 'missing').length,
            blocked: allSteps.filter((step) => step.status === 'blocked').length,
            atRisk: allSteps.filter((step) => step.status === 'at_risk').length,
            nextAction: nextStep
              ? {
                  packageCode: nextStep.packageCode,
                  title: nextStep.title,
                  ...nextStep.nextAction,
                }
              : null,
          },
          phases,
        };
      });
    },
  );
};

export default enterprisePlaybookModule;
