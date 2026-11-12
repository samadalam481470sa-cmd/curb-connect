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
afterAll(async () => { await db?.end({ timeout: 5 }); });
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
  await tx.unsafe('insert into public.organizations(id,slug,legal_name,display_name) values($1,$2,$3,$4)',
    [id, 'draft-'+id, 'Drafts Test', 'Drafts Test']);
  return id;
}
async function makeUser(tx: Tx) {
  const id = randomUUID();
  await tx.unsafe('insert into public.users(id,display_name) values($1,$2)', [id, 'Test Draft User']);
  return id;
}
describe('account drafts isolation', () => {
  it('forces RLS for every draft and scopes by both active user and company', async () => {
    const [policy] = await db.unsafe(`select relrowsecurity,relforcerowsecurity from pg_class
      where oid='public.user_workspace_drafts'::regclass`);
    expect(policy).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    await rollback(async (tx) => {
      const orgA = await makeOrg(tx);
      const orgB = await makeOrg(tx);
      const userA = await makeUser(tx);
      const userB = await makeUser(tx);
      const insert = `insert into public.user_workspace_drafts(org_id,user_id,draft_key,value)
        values ($1,$2,'house-builder','{"spec":{"stories":2}}'::jsonb)`;
      await tx.unsafe(insert, [orgA,userA]);
      await tx.unsafe(insert, [orgA,userB]);
      await tx.unsafe(insert, [orgB,userA]);
      await tx.unsafe('set local role fieldline_app');
      await tx.unsafe('select set_config(\'app.org_id\',$1,true)', [orgA]);
      await tx.unsafe('select set_config(\'app.user_id\',$1,true)', [userA]);
      const records = await tx.unsafe('select org_id,user_id from public.user_workspace_drafts');
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({org_id:orgA,user_id:userA});
      const other = await tx.unsafe('update public.user_workspace_drafts set revision=2 where user_id=$1 returning id',[userB]);
      expect(other).toHaveLength(0);
      const still = await tx.unsafe('select revision from public.user_workspace_drafts');
      expect(still[0]?.revision).toBe(1);
    });
  });
});
