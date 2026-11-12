import { randomUUID } from 'node:crypto';
import postgres, { type TransactionSql } from 'postgres';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

type Tx = TransactionSql<Record<string, never>>;
class Rollback extends Error {}
let db: postgres.Sql;
beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  db = postgres(process.env.TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
});
afterAll(async () => { await db?.end({ timeout: 5 }); });

async function rollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.begin(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
async function code(tx: Tx, fn: (sp: Tx) => Promise<unknown>) {
  try {
    await tx.savepoint(async (sp) => fn(sp as unknown as Tx));
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}
async function createOrg(tx: Tx) {
  const id = randomUUID();
  await tx.unsafe('insert into public.organizations(id,slug,legal_name,display_name) values($1,$2,$3,$4)',
    [id, 'enttest-' + id, 'Fictional Test Org', 'Fictional Test Org']);
  return id;
}
async function createProject(tx: Tx, orgId: string) {
  const rows = await tx.unsafe('insert into enterprise_suite.projects(org_id,name,created_by_user_id) values($1,$2,$3) returning id',
    [orgId, 'Fictional commercial project', randomUUID()]);
  return String(rows[0]!.id);
}

describe('enterprise tenant schema', () => {
  it('forces RLS on all tenant-owned enterprise tables', async () => {
    const rows = await db.unsafe("select relrowsecurity,relforcerowsecurity from pg_class where relnamespace='enterprise_suite'::regnamespace and relkind='r'");
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  });

  it('isolates two organizations and refuses cross-org project references', async () => {
    await rollback(async (tx) => {
      const a = await createOrg(tx);
      const b = await createOrg(tx);
      const projectA = await createProject(tx, a);
      const projectB = await createProject(tx, b);
      await tx.unsafe('set local role fieldline_app');
      expect(await tx.unsafe('select id from enterprise_suite.projects')).toHaveLength(0);
      await tx.unsafe("select set_config('app.org_id',$1,true)", [a]);
      const rows = await tx.unsafe('select id from enterprise_suite.projects');
      expect(rows.map((r) => r.id)).toEqual([projectA]);
      const bad = await code(tx, (sp) => sp.unsafe(
        'insert into enterprise_suite.rfis(org_id,project_id,rfi_number,subject,question,ball_in_court,created_by_user_id) values($1,$2,1,$3,$4,$5,$6)',
        [a, projectB, 'Cross-org', 'Cannot view another tenant', 'Reviewer', randomUUID()]));
      expect(bad).toBe('23503');
      const good = await code(tx, (sp) => sp.unsafe(
        'insert into enterprise_suite.rfis(org_id,project_id,rfi_number,subject,question,ball_in_court,created_by_user_id) values($1,$2,1,$3,$4,$5,$6)',
        [a, projectA, 'Same-org', 'Valid RFI', 'Reviewer', randomUUID()]));
      expect(good).toBeNull();
      expect(await tx.unsafe('update enterprise_suite.projects set name=$1 where org_id=$2 returning id',
        ['Unauthorized', b])).toHaveLength(0);
    });
  });

  it('enforces unique RFI numbering and SOV overbilling constraints', async () => {
    await rollback(async (tx) => {
      const orgId = await createOrg(tx);
      const projectId = await createProject(tx, orgId);
      const insertRfi = 'insert into enterprise_suite.rfis(org_id,project_id,rfi_number,subject,question,ball_in_court,created_by_user_id) values($1,$2,1,$3,$4,$5,$6)';
      await tx.unsafe(insertRfi, [orgId, projectId, 'A', 'First', 'Reviewer', randomUUID()]);
      expect(await code(tx, (sp) => sp.unsafe(insertRfi,
        [orgId, projectId, 'B', 'Duplicate', 'Reviewer', randomUUID()]))).toBe('23505');
      expect(await code(tx, (sp) => sp.unsafe(
        'insert into enterprise_suite.sov_lines(org_id,project_id,line_number,cost_code,description,scheduled_minor,previous_minor,current_minor) values($1,$2,1,$3,$4,1000,900,200)',
        [orgId, projectId, '03 30 00', 'Concrete']))).toBe('23514');
    });
  });

  it('rejects audit event updates and deletes', async () => {
    await rollback(async (tx) => {
      const orgId = await createOrg(tx);
      const rows = await tx.unsafe(
        'insert into enterprise_suite.audit_events(org_id,actor_user_id,object_type,object_id,action) values($1,$2,$3,$4,$5) returning id',
        [orgId, randomUUID(), 'test', randomUUID(), 'test.created']);
      const id = rows[0]!.id;
      expect(await code(tx, (sp) => sp.unsafe(
        'update enterprise_suite.audit_events set action=$1 where id=$2', ['tampered', id]))).toBe('FL001');
      expect(await code(tx, (sp) => sp.unsafe(
        'delete from enterprise_suite.audit_events where id=$1', [id]))).toBe('FL001');
    });
  });
});
