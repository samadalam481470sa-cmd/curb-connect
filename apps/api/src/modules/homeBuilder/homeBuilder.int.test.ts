import { randomUUID } from 'node:crypto';
import postgres, { type TransactionSql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Tx = TransactionSql<Record<string, never>>;
class Rollback extends Error {}

let db: postgres.Sql;

beforeAll(() => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL missing');
  db = postgres(process.env.TEST_DATABASE_URL, { max: 1 });
});
afterAll(async () => {
  await db?.end({ timeout: 5 });
});

async function rollback(fn: (tx: Tx) => Promise<void>) {
  try {
    await db.begin(async (tx) => {
      await fn(tx as unknown as Tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function makeOrg(tx: Tx) {
  const id = randomUUID();
  await tx.unsafe('insert into public.organizations(id,slug,legal_name,display_name) values($1,$2,$3,$4)', [
    id,
    `home-${id}`,
    'Home Test',
    'Home Test',
  ]);
  return id;
}

describe('home builder tenancy', () => {
  it('forces RLS on both home tables', async () => {
    const rows = await db.unsafe(`select relname, relrowsecurity, relforcerowsecurity from pg_class
      where oid in ('public.home_projects'::regclass,'public.home_design_versions'::regclass)`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ relrowsecurity: true });
  });

  it('keeps one company from reading or changing another company’s projects and versions', async () => {
    await rollback(async (tx) => {
      const orgA = await makeOrg(tx);
      const orgB = await makeOrg(tx);
      const projectB = randomUUID();
      await tx.unsafe(
        'insert into public.home_projects(id,org_id,name,target_area_sqft,budget_cents) values($1,$2,$3,$4,$5)',
        [projectB, orgB, 'B house', 2500, 0],
      );
      await tx.unsafe(
        `insert into public.home_design_versions(org_id,project_id,version_number,design)
         values($1,$2,1,'{"name":"b"}'::jsonb)`,
        [orgB, projectB],
      );

      await tx.unsafe('set local role fieldline_app');
      await tx.unsafe("select set_config('app.org_id',$1,true)", [orgA]);
      await tx.unsafe("select set_config('app.user_id',$1,true)", [randomUUID()]);

      expect(await tx.unsafe('select id from public.home_projects')).toHaveLength(0);
      expect(await tx.unsafe('select id from public.home_design_versions')).toHaveLength(0);
      const write = await tx.unsafe('update public.home_projects set name=$1 where id=$2 returning id', ['hacked', projectB]);
      expect(write).toHaveLength(0);
    });
  });

  it('rejects a version whose project belongs to another company (composite tenant FK)', async () => {
    await rollback(async (tx) => {
      const orgA = await makeOrg(tx);
      const orgB = await makeOrg(tx);
      const projectB = randomUUID();
      await tx.unsafe(
        'insert into public.home_projects(id,org_id,name,target_area_sqft,budget_cents) values($1,$2,$3,$4,$5)',
        [projectB, orgB, 'B house', 2500, 0],
      );
      await expect(
        tx.unsafe(
          'insert into public.home_design_versions(org_id,project_id,version_number,design) values($1,$2,1,$3::jsonb)',
          [orgA, projectB, '{}'],
        ),
      ).rejects.toThrow(/foreign key|violates/i);
    });
  });

  it('enforces one version number per project', async () => {
    await rollback(async (tx) => {
      const org = await makeOrg(tx);
      const project = randomUUID();
      await tx.unsafe(
        'insert into public.home_projects(id,org_id,name,target_area_sqft,budget_cents) values($1,$2,$3,$4,$5)',
        [project, org, 'House', 2500, 0],
      );
      const insert = "insert into public.home_design_versions(org_id,project_id,version_number,design) values($1,$2,1,'{}'::jsonb)";
      await tx.unsafe(insert, [org, project]);
      await expect(tx.unsafe(insert, [org, project])).rejects.toThrow(/unique|duplicate/i);
    });
  });

  it('rejects a design that is not a JSON object', async () => {
    await rollback(async (tx) => {
      const org = await makeOrg(tx);
      const project = randomUUID();
      await tx.unsafe(
        'insert into public.home_projects(id,org_id,name,target_area_sqft,budget_cents) values($1,$2,$3,$4,$5)',
        [project, org, 'House', 2500, 0],
      );
      await expect(
        tx.unsafe(
          "insert into public.home_design_versions(org_id,project_id,version_number,design) values($1,$2,1,'[]'::jsonb)",
          [org, project],
        ),
      ).rejects.toThrow(/check/i);
    });
  });
});
