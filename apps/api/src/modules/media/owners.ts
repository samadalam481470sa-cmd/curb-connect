// Media owner resources: which table backs each owner type, and which RBAC actions read or upload
// media for it. The owner must exist in the caller's org (checked under RLS), so a media asset can
// never be attached to another tenant's record.
import type { Action, MediaOwnerType } from '@fieldline/contracts';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';

interface OwnerRule {
  table: string;
  read: Action;
  upload: Action;
}

export const MEDIA_OWNER_RULES: Record<MediaOwnerType, OwnerRule> = {
  curb_project: { table: 'curb_projects', read: 'curb_project:read', upload: 'curb_media:upload' },
  roof_order: { table: 'roof_orders', read: 'roof_order:read', upload: 'roof_report:edit_geometry' },
  roof_report: { table: 'roof_reports', read: 'roof_report:read', upload: 'roof_report:edit_geometry' },
  property: { table: 'properties', read: 'property:read', upload: 'property:write' },
  job: { table: 'jobs', read: 'job:read', upload: 'job:write' },
  proposal: { table: 'proposals', read: 'proposal:read', upload: 'proposal:write' },
  change_order: { table: 'change_orders', read: 'change_order:read', upload: 'change_order:write' },
  note: { table: 'notes', read: 'customer:read', upload: 'note:write' },
  customer: { table: 'customers', read: 'customer:read', upload: 'customer:write' },
  organization: { table: 'organizations', read: 'org:read', upload: 'org:update' },
};

/** True when the owner record exists and is visible in the transaction's org. */
export async function ownerExists(tx: Tx, orgId: string, ownerType: MediaOwnerType, ownerId: string): Promise<boolean> {
  if (ownerType === 'organization') return ownerId === orgId;
  const table = MEDIA_OWNER_RULES[ownerType].table;
  // Table names come from the fixed map above, never from the request.
  const rows = await tx.execute(
    sql`select 1 from ${sql.identifier(table)} where org_id = ${orgId}::uuid and id = ${ownerId}::uuid limit 1`,
  );
  return rows.length > 0;
}
