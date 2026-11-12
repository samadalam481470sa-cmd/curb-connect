import {describe,expect,it} from 'vitest';
import {parseCompanyBids,readCsv} from './companyBidImports';
const now=new Date('2026-11-12T00:00:00Z');
describe('authorized company bid imports',()=>{
  it('parses multiline quoted CSV fields without executing formulas',()=>{
    const rows=readCsv('Project Name,Company,Description\n"Roof, Complex",Acme,"line one\nline two"');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['Project Name']).toBe('Roof, Complex');
    expect(rows[0]?.Description).toBe('line one\nline two');
  });
  it('recognizes common contractor export column headings',()=>{
    const bids=parseCompanyBids('Project Name,General Contractor,Bid Due,Project URL\n'+
      'Concrete cutting,ABC Builders,2026-12-01,https://example.com/bid/1',
      'private.csv','Procore',now);
    expect(bids).toHaveLength(1);
    expect(bids[0]?.company).toBe('ABC Builders');
    expect(bids[0]?.dueDate).toBe('2026-12-01');
  });
  it('rejects local / embedded-credential links from imported files',()=>{
    const bids=parseCompanyBids(JSON.stringify([
      {title:'Roof estimate',url:'http://localhost/private'},
      {title:'Other estimate',url:'https://user:pass@example.com/private'},
    ]),'data.json','Other',now);
    expect(bids.every(b=>b.sourceUrl===null)).toBe(true);
  });
  it('prevents oversized files, unsupported formats and empty imports',()=>{
    expect(()=>parseCompanyBids('x'.repeat(900001),'a.csv','Other')).toThrow();
    expect(()=>parseCompanyBids('bad','a.html','Other')).toThrow();
    expect(()=>parseCompanyBids('[{"other":"value"}]','a.json','Other')).toThrow();
  });
});
