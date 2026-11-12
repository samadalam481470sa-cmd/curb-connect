'use client';
// Official public sources with real URLs. External postings are not Field Pro bids.
// Each provider owns eligibility, documents and bid submission.
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi, useSession, orgKey } from '../../lib/session';

const Source=z.enum(['sam','uk_finder','uk_tenders']);
const Provider=z.object({
  id:Source,name:z.string(),geo:z.string(),url:z.url(),documentation:z.url(),
  status:z.enum(['ready','requires_setup']),connectionType:z.enum(['public','server_api_key']),
});
const Catalog=z.object({providers:z.array(Provider)});
const OutsideOpportunity=z.object({
  source:Source,externalId:z.string(),title:z.string(),buyer:z.string(),
  location:z.string(),summary:z.string(),publishedAt:z.string().nullable(),
  dueAt:z.string().nullable(),url:z.url(),submission:z.literal('provider_site'),
});
const Search=z.object({
  source:Source,status:z.enum(['ok','requires_setup','unavailable']),
  fetchedAt:z.string(),items:z.array(OutsideOpportunity),message:z.string(),
});
type Query={source:z.infer<typeof Source>;q:string;state:string};
const LABELS:Record<z.infer<typeof Source>,string>={
  sam:'SAM.gov (U.S.)',uk_finder:'UK Contracts Finder',uk_tenders:'UK Find a Tender',
};
function niceDate(value:string|null){
  if(!value)return 'No deadline provided';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleDateString('en-US'):value.slice(0,10);
}

export function ExternalBidDiscovery(){
  const {api}=useApi();
  const {orgId}=useSession();
  const [source,setSource]=useState<z.infer<typeof Source>>('sam');
  const [keyword,setKeyword]=useState('');
  const [state,setState]=useState('TX');
  const [search,setSearch]=useState<Query|null>(null);
  const catalog=useQuery({
    queryKey:orgKey(orgId,'bidding','external','providers'),
    queryFn:()=>api.get('/v1/bidding/external/providers',{schema:Catalog}),
  });
  const results=useQuery({
    queryKey:orgKey(orgId,'bidding','external','search',search?.source??'',search?.q??'',search?.state??''),
    queryFn:()=>api.get('/v1/bidding/external/search',{schema:Search,query:{
      source:search!.source,q:search!.q,state:search!.source==='sam'?search!.state:'',
      limit:20,
    }}),
    enabled:!!search,staleTime:60000,retry:0,
  });
  const submit=(event:FormEvent)=>{event.preventDefault();
    setSearch({source,q:keyword.trim(),state:source==='sam'?state:''});
  };
  const selectedProvider=catalog.data?.providers.find(p=>p.id===source);
  return <section className="web-card cc-work-board__external" aria-labelledby="external-bids-heading">
    <h2 id="external-bids-heading">External bidding opportunities</h2>
    <p className="web-muted">Search official, published tenders alongside Field Pro company jobs. External bids are read-only here: open the issuing site for bid documents, eligibility, registration and submission. Results are not endorsements or guaranteed available jobs.</p>
    <form className="cc-work-board__form" onSubmit={submit}>
      <label>Public opportunity source
        <select value={source} onChange={event=>setSource(event.target.value as z.infer<typeof Source>)}>
          {Object.entries(LABELS).map(([id,name])=><option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <label>Title keywords (optional)
        <input type="search" maxLength={80} value={keyword} onChange={event=>setKeyword(event.target.value)}
          placeholder="roof, concrete, building, electrical…"/>
      </label>
      {source==='sam'&&<label>U.S. state
        <select value={state} onChange={event=>setState(event.target.value)}>
          <option value="TX">Texas</option><option value="">All U.S. states</option>
          <option value="OK">Oklahoma</option><option value="LA">Louisiana</option>
          <option value="AR">Arkansas</option><option value="NM">New Mexico</option>
          <option value="CA">California</option><option value="FL">Florida</option>
          <option value="NY">New York</option>
        </select>
      </label>}
      <button className="cc-btn cc-btn--primary" type="submit" disabled={results.isFetching}>
        {results.isFetching?'Searching provider…':'Find external opportunities'}
      </button>
    </form>
    {catalog.error&&<ErrorNotice error={catalog.error} title="Could not load provider status" onRetry={()=>void catalog.refetch()}/>}
    {selectedProvider&&<p className="web-muted web-small">
      {selectedProvider.status==='ready'?'Provider is available for an API request.':
        'Provider requires server-side account setup before live search can work.'}
      {' '}<a href={selectedProvider.documentation} target="_blank" rel="noopener noreferrer">API documentation</a>
    </p>}
    {search&&results.isPending&&<p role="status">Checking the official {LABELS[search.source]} source…</p>}
    {results.error&&<ErrorNotice error={results.error} title="External provider search failed" onRetry={()=>void results.refetch()}/>}
    {results.data&&<div aria-live="polite">
      <p className="web-muted">{results.data.message}</p>
      {results.data.status==='ok'&&<p className="web-muted web-small">
        {results.data.items.length} matching notices from the recent provider page ·
        checked {new Date(results.data.fetchedAt).toLocaleString()}
      </p>}
      {results.data.status==='ok'&&results.data.items.length===0&&<p className="web-muted">
        No matching recent notices returned. Try another keyword, region, or provider.
      </p>}
      <div className="cc-work-board__cards">
        {results.data.items.map(item=><article className="web-card" key={item.source+':'+item.externalId}>
          <small className="cc-work-board__source">Official external notice · {LABELS[item.source]}</small>
          <strong>{item.title}</strong>
          <p className="web-muted web-small">{item.buyer} · {item.location}</p>
          {item.summary&&<p>{item.summary}</p>}
          <p className="web-muted web-small">
            {item.dueAt?'Response deadline: '+niceDate(item.dueAt):'Response deadline not provided'}
          </p>
          <a className="cc-work-board__link" href={item.url} target="_blank" rel="noopener noreferrer">
            View original notice / bidding instructions
          </a>
        </article>)}
      </div>
    </div>}
    <p className="web-muted web-small">
      Your saved BuildingConnected, Procore, ConstructConnect and other company portals are in
      {' '}<a href="/settings/connectors">Settings → Bidding integrations</a>.
      Their private company invitations require authorized account integration; Field Pro does not
      scrape private portals or submit bids without your consent.
    </p>
  </section>;
}
