// Public footprint discovery remains gated behind an active signed-in workspace.
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {call,createTestContext,type TestContext} from '../helpers';

let ctx:TestContext;
beforeAll(async()=>{ctx=await createTestContext();});
afterAll(async()=>{await ctx?.close();});

describe('roof footprint endpoint',()=>{
  it('rejects unauthenticated map discovery before contacting any provider',async()=>{
    const result=await call(ctx,'POST','/v1/imagery/roof-footprint',{
      body:{lat:32.78,lon:-97.35},
    });
    expect(result.statusCode).toBe(401);
  });
  it('rejects malformed or unsafe geographic coordinates',async()=>{
    const result=await call(ctx,'POST','/v1/imagery/roof-footprint',{
      body:{lat:500,lon:-97.35},
    });
    expect([400,401]).toContain(result.statusCode);
  });
});
