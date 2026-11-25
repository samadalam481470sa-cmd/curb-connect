import { and, eq } from 'drizzle-orm';
import {
  enterpriseAuditEvents,
  enterpriseProjects,
  enterpriseSettings,
} from '../../db/schema/enterprise';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

export async function checkEnabled(tx: Tx, orgId: string) {
  const [settings] = await tx
    .select()
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.orgId, orgId));
  if (!settings?.enabled)
    throw problem('forbidden', 'Enable the Enterprise Suite for your company first.');
}

export async function checkProject(
  tx: Tx,
  orgId: string,
  projectId: string,
  lock: boolean | 'share' = false,
) {
  const query = tx
    .select()
    .from(enterpriseProjects)
    .where(and(eq(enterpriseProjects.orgId, orgId), eq(enterpriseProjects.id, projectId)));
  const [project] = lock ? await query.for(lock === 'share' ? 'share' : 'update') : await query;
  if (!project) throw problem('not_found');
  return project;
}

export async function audit(
  tx: Tx,
  orgId: string,
  userId: string,
  kind: string,
  objectId: string,
  action: string,
  beforeState?: unknown,
  afterState?: unknown,
) {
  await tx.insert(enterpriseAuditEvents).values({
    orgId,
    actorUserId: userId,
    objectType: kind,
    objectId,
    action,
    beforeState: beforeState ?? null,
    afterState: afterState ?? null,
  });
}
