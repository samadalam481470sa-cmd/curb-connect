import { describe, expect, it, vi } from 'vitest';
import { normalizeOcds, normalizeSam, searchOfficialBids } from './providers';
const now=new Date('2026-11-12T17:00:00.000Z');
describe('public procurement connectors',()=>{
  it('does not expose SAM.gov API key or expired notices',()=>{
    const result=normalizeSam({opportunitiesData:[
      {noticeId:'abcde123456789',title:'Roof replacement',active:'Yes',
        reponseDeadLine:'2026-12-01T17:00:00Z',postedDate:'2026-11-11 12:00:00',
        fullParentPathName:'Federal Facilities',uiLink:'https://sam.gov/opp/abcde123456789/view',
        description:'https://api.sam.gov/example?api_key=PRIVATE',
        placeOfPerformance:{city:{name:'Fort Worth'},state:{code:'TX'}}},
      {noticeId:'expired123',title:'Expired contract',reponseDeadLine:'2026-01-01'},
    ]},now,20);
    expect(result).toHaveLength(1);
    expect(result[0]?.buyer).toBe('Federal Facilities');
    expect(result[0]?.location).toBe('Fort Worth, TX');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('rejects malicious external links and completed/expired awards',()=>{
    const result=normalizeOcds({releases:[
      {id:'notice1',tag:['tender'],tender:{title:'Electrical works',
        tenderPeriod:{endDate:'2027-01-01'},status:'active'},
      buyer:{name:'District Authority'},url:'https://evil.test/phishing'},
      {id:'notice2',tag:['award'],tender:{title:'Awarded',status:'complete'}},
    ]},'uk_finder',now,20,'electrical');
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toMatch(/^https:\/\/www\.contractsfinder\.service\.gov\.uk\//);
  });
  it('refuses to query SAM.gov without a server key',async()=>{
    const fetcher=vi.fn();
    const result=await searchOfficialBids({source:'sam',keyword:'roof',state:'TX',
      limit:20,now,fetcher:fetcher as unknown as typeof fetch});
    expect(result.status).toBe('requires_setup');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('searches only hard-coded, first-party upstream hosts',async()=>{
    const fetcher=vi.fn(async(url:string)=>{
      const u=new URL(url);
      expect(u.hostname).toBe('api.sam.gov');
      expect(u.searchParams.get('state')).toBe('TX');
      expect(u.searchParams.get('api_key')).toBe('server_secret');
      return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({
        opportunitiesData:[{noticeId:'id123456789',title:'Construction Services',active:'Yes'}],
      })};
    });
    const result=await searchOfficialBids({source:'sam',keyword:'construction',state:'TX',
      limit:10,samKey:'server_secret',now,fetcher:fetcher as unknown as typeof fetch});
    expect(result.status).toBe('ok');
    expect(result.items).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('server_secret');
  });
  it('reports upstream failures without emitting credential URLs',async()=>{
    const result=await searchOfficialBids({source:'sam',keyword:'roof',state:'TX',
      limit:10,samKey:'server_secret',now,
      fetcher:(async()=>{throw Error('https://api.sam.gov?api_key=server_secret');}) as typeof fetch});
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('server_secret');
  });
});
