// Public, official procurement feeds only. No screen scraping, private session access or
// cross-provider bid submission. Keep upstream credentials server-side and restrict destinations.
export type ExternalSource = 'sam' | 'uk_finder' | 'uk_tenders';
export type SourceStatus = 'ok' | 'requires_setup' | 'unavailable';
export interface ExternalOpportunity {
  source: ExternalSource;
  externalId: string;
  title: string;
  buyer: string;
  location: string;
  summary: string;
  publishedAt: string | null;
  dueAt: string | null;
  url: string;
  submission: 'provider_site';
}
export interface ExternalSearchResult {
  source: ExternalSource;
  status: SourceStatus;
  fetchedAt: string;
  items: ExternalOpportunity[];
  message: string;
}
export const OFFICIAL_SOURCES = {
  sam: { name:'SAM.gov – U.S. federal', url:'https://sam.gov/opportunities',
    needsKey:true, geo:'United States', documentation:'https://open.gsa.gov/api/get-opportunities-public-api/' },
  uk_finder: { name:'Contracts Finder – UK', url:'https://www.contractsfinder.service.gov.uk/Search',
    needsKey:false, geo:'United Kingdom', documentation:'https://www.gov.uk/government/publications/open-contracting' },
  uk_tenders: { name:'Find a Tender – UK', url:'https://www.find-tender.service.gov.uk/Search',
    needsKey:false, geo:'United Kingdom', documentation:'https://www.gov.uk/government/publications/open-contracting' },
} as const;

type Obj = Record<string, unknown>;
const obj=(value:unknown):Obj=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  ? value as Obj:{};
const str=(value:unknown,max=400):string=>typeof value==='string'?value.trim().slice(0,max):'';
function stamp(value:unknown):string|null {
  const raw=str(value,60);
  if(!raw)return null;
  const date=new Date(/^\d{4}-\d\d-\d\d \d\d/.test(raw)?raw.replace(' ','T')+'Z':raw);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}
function officialUrl(raw:unknown,host:string,fallback:string):string {
  try{
    const url=new URL(str(raw,2000));
    if(url.protocol==='https:'&&url.hostname===host&&!url.username&&!url.password)return url.href;
  }catch{ /* use known fixed host */ }
  return fallback;
}
const cap=(items:ExternalOpportunity[],limit:number):ExternalOpportunity[]=>
  [...new Map(items.map(item=>[item.source+':'+item.externalId,item])).values()].slice(0,limit);

/** SAM.gov responses must not leak the API key embedded in their description hrefs. */
export function normalizeSam(payload:unknown,now:Date,limit:number):ExternalOpportunity[] {
  const list=obj(payload).opportunitiesData;
  if(!Array.isArray(list))return [];
  const result:ExternalOpportunity[]=[];
  for(const raw of list){
    const r=obj(raw);const id=str(r.noticeId,90);
    const title=str(r.title,200);
    if(!title||!id)continue;
    if(String(r.active).toLowerCase()==='no')continue;
    const dueAt=stamp(r.reponseDeadLine ?? r.responseDeadLine);
    if(dueAt&&Date.parse(dueAt)<now.getTime())continue;
    const place=obj(r.placeOfPerformance);
    const city=str(obj(place.city).name,80);
    const state=str(obj(place.state).code,10)||str(obj(place.state).name,40);
    const location=[city,state].filter(Boolean).join(', ')||'Location not provided';
    const url=officialUrl(r.uiLink,'sam.gov',
      /^[-a-zA-Z0-9]{8,90}$/.test(id)?'https://sam.gov/opp/'+encodeURIComponent(id)+'/view':
      OFFICIAL_SOURCES.sam.url);
    result.push({
      source:'sam',externalId:id,title,buyer:str(r.fullParentPathName,160)||'Federal agency',
      location,summary:str(r.solicitationNumber,80)?'Solicitation '+str(r.solicitationNumber,80):'',
      publishedAt:stamp(r.postedDate),dueAt,url,submission:'provider_site',
    });
  }
  return cap(result,limit);
}

/** Both UK providers use OCDS release packages. Never claim that award notices are open bids. */
export function normalizeOcds(
  payload:unknown,source:'uk_finder'|'uk_tenders',now:Date,limit:number,keyword:string,
):ExternalOpportunity[] {
  const releases=obj(payload).releases;
  if(!Array.isArray(releases))return [];
  const result:ExternalOpportunity[]=[];
  for(const raw of releases){
    const r=obj(raw);const tender=obj(r.tender);
    const title=str(tender.title,200)||str(r.ocid,140);
    if(!title)continue;
    const tag=r.tag;
    if(Array.isArray(tag)&&tag.includes('award')&&!tag.includes('tender'))continue;
    const status=str(tender.status,25);
    if(['complete','cancelled','unsuccessful','withdrawn'].includes(status))continue;
    const dueAt=stamp(obj(tender.tenderPeriod).endDate);
    if(dueAt&&Date.parse(dueAt)<now.getTime())continue;
    const buyer=str(obj(r.buyer).name,160)||'Public-sector buyer';
    const summary=str(tender.description,450);
    const match=[title,buyer,summary].join(' ').toLowerCase();
    if(keyword&&!match.includes(keyword.toLowerCase()))continue;
    const externalId=str(r.id,180)||str(r.ocid,180);
    if(!externalId)continue;
    const region=obj(tender.deliveryLocations);
    const location=str(obj(region).name,100)||'United Kingdom';
    const fallback=OFFICIAL_SOURCES[source].url;
    // Only official provider domains may be used as outgoing links.
    const trustedHost=source==='uk_finder'
      ?'www.contractsfinder.service.gov.uk':'www.find-tender.service.gov.uk';
    const url=officialUrl(obj(r).url,trustedHost,fallback);
    result.push({source,externalId,title,buyer,location,summary,
      publishedAt:stamp(r.date),dueAt,url,submission:'provider_site'});
  }
  return cap(result,limit);
}

type FetchLike = typeof fetch;
async function jsonFrom(url:URL,fetcher:FetchLike):Promise<unknown> {
  // This function is called only with hard-coded official HTTPS URLs, not user-supplied hosts.
  const response=await fetcher(url.href,{
    method:'GET',redirect:'error',headers:{accept:'application/json'},
    signal:AbortSignal.timeout(9000),cache:'no-store',
  });
  if(!response.ok)throw Error('Provider unavailable ('+response.status+').');
  if(Number(response.headers.get('content-length')??'0')>2_000_000)
    throw Error('Provider response exceeded safe size.');
  const text=await response.text();
  if(text.length>2_000_000)throw Error('Provider response exceeded safe size.');
  return JSON.parse(text) as unknown;
}
function day(date:Date):string {return date.toISOString().slice(0,10);}
function usDate(date:Date):string {
  return String(date.getUTCMonth()+1).padStart(2,'0')+'/'+
    String(date.getUTCDate()).padStart(2,'0')+'/'+date.getUTCFullYear();
}
export async function searchOfficialBids(input:{
  source:ExternalSource; keyword:string; state:string; limit:number; samKey?:string;
  now?:Date; fetcher?:FetchLike;
}):Promise<ExternalSearchResult> {
  const now=input.now??new Date();
  const keyword=input.keyword.trim().slice(0,80);
  const response:ExternalSearchResult={source:input.source,status:'unavailable',
    fetchedAt:now.toISOString(),items:[],message:'Provider search unavailable. Try again later.'};
  if(input.source==='sam'&&!input.samKey){
    return {...response,status:'requires_setup',
      message:'SAM.gov requires an API key. Configure SAM_GOV_API_KEY on the API server; never enter it in the browser.'};
  }
  const from=new Date(now.getTime()-14*86_400_000);
  try {
    let payload:unknown;
    if(input.source==='sam'){
      const url=new URL('https://api.sam.gov/opportunities/v2/search');
      url.searchParams.set('api_key',input.samKey!);
      url.searchParams.set('postedFrom',usDate(from));
      url.searchParams.set('postedTo',usDate(now));
      url.searchParams.set('ptype','o');
      url.searchParams.set('limit',String(Math.min(50,input.limit)));
      url.searchParams.set('offset','0');
      if(input.state)url.searchParams.set('state',input.state);
      if(keyword)url.searchParams.set('title',keyword);
      payload=await jsonFrom(url,input.fetcher??fetch);
      return {...response,status:'ok',items:normalizeSam(payload,now,input.limit),
        message:'Official SAM.gov solicitations. Apply on SAM.gov; these are not Field Pro bids.'};
    }
    if(input.source==='uk_finder'){
      const url=new URL('https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search');
      url.searchParams.set('publishedFrom',day(from));
      url.searchParams.set('publishedTo',day(now));
      url.searchParams.set('stages','tender');
      url.searchParams.set('limit','50');
      payload=await jsonFrom(url,input.fetcher??fetch);
      return {...response,status:'ok',items:normalizeOcds(payload,'uk_finder',now,input.limit,keyword),
        message:'Public UK notices. Search is limited to the returned recent page; apply on the source site.'};
    }
    const url=new URL('https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages');
    url.searchParams.set('updatedFrom',day(from)+'T00:00:00');
    url.searchParams.set('updatedTo',day(now)+'T23:59:59');
    url.searchParams.set('stages','tender');
    url.searchParams.set('limit','50');
    payload=await jsonFrom(url,input.fetcher??fetch);
    return {...response,status:'ok',items:normalizeOcds(payload,'uk_tenders',now,input.limit,keyword),
      message:'UK Find a Tender official OCDS releases. Apply through the original notice.'};
  }catch {
    // Never log full request URLs: SAM.gov includes a server-side key in the URL.
    return response;
  }
}
