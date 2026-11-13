// Regression tests for the live jobs and bidding screens. Exercise real RLS-backed
// database behavior rather than mocked in-memory records.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';

let ctx: TestContext;
beforeAll(async () => { ctx=await createTestContext(); });
afterEach(async () => { await ctx.cleanup(); });
afterAll(async () => { await ctx?.close(); });

describe('Jobs and Bidding persistence', () => {
  it('creates a job timeline and records only real stage changes', async () => {
    const company=await createCompany(ctx);
    const made=await call(ctx,'POST','/v1/jobs',{
      as:company.owner,body:{title:'Roof retrofit',productLine:'roof',estimatedValueMinor:250000},
    });
    expect(made.statusCode).toBe(201);
    const created=made.json() as {id:string;stage:string};
    expect(created.stage).toBe('intake');

    const changed=await call(ctx,'PATCH',`/v1/jobs/${created.id}/stage`,{
      as:company.owner,body:{stage:'estimating'},
    });
    expect(changed.statusCode).toBe(200);
    expect((changed.json() as {stage:string}).stage).toBe('estimating');
    const unchanged=await call(ctx,'PATCH',`/v1/jobs/${created.id}/stage`,{
      as:company.owner,body:{stage:'estimating'},
    });
    expect(unchanged.statusCode).toBe(200);
    const history=await ctx.owner.client<{
      event_type:string;from_stage:string|null;to_stage:string|null;actor_user_id:string|null;
    }[]>`select event_type,from_stage,to_stage,actor_user_id from job_events
      where job_id=${created.id}::uuid order by occurred_at,id`;
    expect(history).toHaveLength(2);
    expect(history.map(e=>[e.event_type,e.from_stage,e.to_stage])).toEqual([
      ['job_created',null,'intake'],
      ['stage_changed','intake','estimating'],
    ]);
    expect(history.every(e=>e.actor_user_id===company.owner.userId)).toBe(true);
    const [row]=await ctx.owner.client<{stage_key:string;revision:number}[]>`
      select stage_key,revision from jobs where id=${created.id}::uuid`;
    expect(row?.stage_key).toBe('estimating');
    expect(row?.revision).toBe(2);
  });

  it('rejects expired bid deadlines and keeps private invitations off other companies boards', async () => {
    const owner=await createCompany(ctx);
    const unrelated=await createCompany(ctx);
    const input={
      title:'Curb demolition project',
      description:'Remove 120 feet of curb under approved plans.',
      trade:'curb',city:'Fort Worth',region:'TX',visibility:'connections',
      dueOn:'2025-01-01',
    };
    const expired=await call(ctx,'POST','/v1/bidding/opportunities',{
      as:owner.owner,body:input,
    });
    expect(expired.statusCode).toBe(400);

    const post=await call(ctx,'POST','/v1/bidding/opportunities',{
      as:owner.owner,body:{...input,dueOn:'2099-01-01'},
    });
    expect(post.statusCode).toBe(201);
    const ownList=await call(ctx,'GET','/v1/bidding/opportunities',{as:owner.owner});
    expect(ownList.statusCode).toBe(200);
    expect((ownList.json() as {items:{id:string}[]}).items.some(i=>i.id===(post.json() as {id:string}).id)).toBe(true);
    const outsiders=await call(ctx,'GET','/v1/bidding/opportunities',{as:unrelated.owner});
    expect(outsiders.statusCode).toBe(200);
    expect((outsiders.json() as {items:{id:string}[]}).items).toHaveLength(0);
  });

  it('hides expired connections-only opportunities from other tenants even when still marked open', async () => {
    const owner=await createCompany(ctx);
    const outsider=await createCompany(ctx);
    // Make a marketplace-visible post to ensure the listing filter is exercised without
    // needing a connection. The test uses fixture SQL only to simulate an elapsed deadline.
    await ctx.owner.client`update organizations set directory_opt_in=true where id=${owner.orgId}::uuid`;
    const post=await call(ctx,'POST','/v1/bidding/opportunities',{
      as:owner.owner,body:{
        title:'Commercial roofing bid',description:'Bids for a commercial roofing installation.',
        trade:'roof',city:'Fort Worth',region:'TX',visibility:'marketplace',dueOn:'2099-01-01',
      },
    });
    expect(post.statusCode).toBe(201);
    const id=(post.json() as {id:string}).id;
    const open=await call(ctx,'GET','/v1/bidding/opportunities',{as:outsider.owner});
    expect(open.statusCode).toBe(200);
    expect((open.json() as {items:{id:string}[]}).items.some(i=>i.id===id)).toBe(true);
    await ctx.owner.client`update bid_opportunities set due_on='2020-01-01'
      where id=${id}::uuid`;
    const expired=await call(ctx,'GET','/v1/bidding/opportunities',{as:outsider.owner});
    expect(expired.statusCode).toBe(200);
    expect((expired.json() as {items:{id:string}[]}).items.some(i=>i.id===id)).toBe(false);
    const ownerView=await call(ctx,'GET','/v1/bidding/opportunities',{as:owner.owner});
    expect((ownerView.json() as {items:{id:string}[]}).items.some(i=>i.id===id)).toBe(true);
  });
});
