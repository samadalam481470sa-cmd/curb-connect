// Import only user-authorized exports from third-party bidding services.
// No provider credentials, scripts, HTML, remote scraping or automatic submission.
export interface CompanyBid {
  id:string; provider:string; title:string; company:string;
  location:string; dueDate:string|null; sourceUrl:string|null;
  notes:string; importedAt:string;
}
export const COMPANY_SOURCES=[
  'Autodesk BuildingConnected / Bid Board Pro','Procore','ConstructConnect',
  'PlanHub','BidNet Direct','Buildertrend','Other',
] as const;

type Row = Record<string,unknown>;
function object(value:unknown):Row {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
}
const norm=(value:unknown):string=>typeof value==='string'?value:
  value===null||value===undefined?'':String(value);
function pick(record:Row,fields:string[]):string {
  const lookup=new Map(Object.entries(record).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]/g,''),v]));
  for(const f of fields){
    const value=lookup.get(f.toLowerCase().replace(/[^a-z0-9]/g,''));
    if(value!==undefined&&value!==null&&norm(value).trim())return norm(value).trim();
  }
  return '';
}
function safeUrl(raw:string):string|null {
  if(!raw)return null;
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||
      !parsed.hostname.includes('.')||parsed.hostname.endsWith('.local')||
      /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(parsed.hostname))
      return null;
    parsed.hash='';
    return parsed.href.slice(0,1800);
  }catch{return null;}
}
function date(raw:string):string|null {
  if(!raw)return null;
  const parsed=new Date(raw);
  return Number.isFinite(parsed.getTime())?parsed.toISOString().slice(0,10):null;
}
export function readCsv(text:string):Row[] {
  const grid:string[][]=[];
  let field='';let row:string[]=[];let quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i]!;
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quoted=false;
      else field+=c;
    }else if(c==='"'&&field===''){quoted=true;}
    else if(c===','){row.push(field);field='';}
    else if(c==='\n'){row.push(field);grid.push(row);row=[];field='';}
    else if(c!=='\r')field+=c;
    if(field.length>16000)throw Error('CSV field exceeds the safe size limit.');
  }
  if(quoted)throw Error('Unclosed CSV quoted field.');
  if(row.length||field){row.push(field);grid.push(row);}
  const headers=(grid.shift()??[]).map(h=>h.trim().replace(/^\uFEFF/,''));
  if(headers.length<2||headers.length>60)throw Error('CSV must have a valid header row.');
  return grid.filter(r=>r.some(v=>v.trim())).slice(0,110).map(values=>
    Object.fromEntries(headers.map((header,i)=>[header,values[i]??''])));
}
export function parseCompanyBids(
  content:string,filename:string,provider:string,now:Date=new Date(),
):CompanyBid[] {
  if(content.length>900000)throw Error('Limit imported files to 900 KB.');
  const name=filename.toLowerCase();
  let rows:unknown[];
  if(name.endsWith('.csv'))rows=readCsv(content);
  else if(name.endsWith('.json')){
    let parsed:unknown;
    try{parsed=JSON.parse(content) as unknown;}
    catch{throw Error('Invalid JSON export.');}
    rows=Array.isArray(parsed)?parsed:Array.isArray(object(parsed).items)?object(parsed).items as unknown[]:[];
  }else throw Error('Use a CSV or JSON export from a provider you are authorized to access.');
  if(rows.length>100)throw Error('Limit imports to 100 opportunities per upload.');
  const seen=new Set<string>();
  const items:CompanyBid[]=[];
  for(let i=0;i<rows.length;i++){
    const record=object(rows[i]);
    const title=pick(record,['title','job title','project','project name','opportunity name','name']);
    if(title.length<3)continue;
    const company=pick(record,['company','general contractor','owner','buyer','client','customer','posted by']);
    const location=pick(record,['location','city','site address','project address','state']);
    const sourceUrl=safeUrl(pick(record,['url','link','project url','opportunity url','bid link']));
    const dueDate=date(pick(record,['due date','deadline','bid due','bid date','due','submission deadline']));
    const sourceId=pick(record,['id','opportunity id','bid id','project id']).slice(0,100);
    const notes=pick(record,['description','scope','notes','details']).slice(0,600);
    const id=provider+':'+(sourceId||sourceUrl||title+'@'+(dueDate||'')+'-'+i);
    if(seen.has(id))continue;
    seen.add(id);
    items.push({id:id.slice(0,240),provider,title:title.slice(0,180),
      company:company.slice(0,160),location:location.slice(0,160),
      dueDate,sourceUrl,notes,importedAt:now.toISOString()});
  }
  if(!items.length)throw Error('No usable bids found. Include a title or project-name column.');
  return items;
}
