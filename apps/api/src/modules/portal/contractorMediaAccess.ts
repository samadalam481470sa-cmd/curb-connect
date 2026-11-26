import { and, asc, desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseMediaProjectGrants as grants } from '../../db/schema/enterpriseMedia';
import { enterpriseEvidenceAssignments as assignments } from '../../db/schema/enterpriseMediaEvidence';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { requireMediaProject } from '../enterprise/jobsiteMediaAccess';

export const contractorJobsPath = '/portal/contractor/jobs';
export const contractorMediaPath = contractorJobsPath + '/:projectId/media';

export type Contractor = ReturnType<typeof requireOrg>;

export function contractorFor(request: Parameters<typeof requireOrg>[0]) {
  const org = requireOrg(request);
  if (org.role !== 'crew_manager') throw problem('not_found');
  return org;
}

export function contractorTasks(tx: Tx, org: Contractor, projectId?: string) {
  const latest = tx
    .selectDistinctOn([assignments.taskId], {
      taskId: assignments.taskId,
      projectId: assignments.projectId,
      actor: assignments.contractorMembershipId,
      requiredMedia: assignments.minimumMedia,
      active: assignments.active,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.orgId, org.orgId),
        projectId ? eq(assignments.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(assignments.taskId), desc(assignments.revision))
    .as('latest_contractor_evidence_assignments');
  const access = tx
    .selectDistinctOn([grants.projectId], { projectId: grants.projectId, active: grants.active })
    .from(grants)
    .where(
      and(
        eq(grants.orgId, org.orgId),
        eq(grants.membershipId, org.membershipId),
        projectId ? eq(grants.projectId, projectId) : undefined,
      ),
    )
    .orderBy(asc(grants.projectId), desc(grants.revision))
    .as('granted_contractor_media_projects');
  return tx
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      startsOn: tasks.startsOn,
      progress: tasks.progressPercent,
      requiredMedia: latest.requiredMedia,
    })
    .from(latest)
    .innerJoin(access, and(eq(access.projectId, latest.projectId), eq(access.active, true)))
    .innerJoin(
      tasks,
      and(
        eq(tasks.orgId, org.orgId),
        eq(tasks.projectId, latest.projectId),
        eq(tasks.id, latest.taskId),
      ),
    )
    .where(and(eq(latest.actor, org.membershipId), eq(latest.active, true)))
    .as('contractor_media_tasks');
}

export const requireContractorMediaProject: typeof requireMediaProject = async (
  request,
  tx,
  projectId,
  lock = 'share',
) => {
  contractorFor(request);
  const current = await requireMediaProject(request, tx, projectId, lock || 'share');
  const own = contractorTasks(tx, current.org, projectId);
  const [assigned] = await tx.select({ id: own.id }).from(own).limit(1);
  if (!assigned) throw problem('not_found');
  return current;
};
