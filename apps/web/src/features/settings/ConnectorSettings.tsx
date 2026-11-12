'use client';

// Safe, personal external-portal launchpad. No OAuth tokens or provider passwords are accepted.
// Provider APIs require a separate authorized integration before automatic bid sync can run.
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useApi, useSession, orgKey } from '../../lib/session';
import { PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useAccountDraft } from '../../lib/accountDrafts';
const OfficialCatalog=z.object({providers:z.array(z.object({
  id:z.enum(['sam','uk_finder','uk_tenders']),name:z.string(),geo:z.string(),
  url:z.url(),documentation:z.url(),status:z.enum(['ready','requires_setup']),
  connectionType:z.enum(['public','server_api_key']),
}))});
const COMPANY_CONNECTORS=[
  {name:'Autodesk BuildingConnected / Bid Board Pro',status:'OAuth approval and subscription required',
    docs:'https://aps.autodesk.com/developer/overview/buildingconnected-and-tradetapp-apis'},
  {name:'Procore',status:'OAuth app authorization required',
    docs:'https://developers.procore.com/'},
  {name:'ConstructConnect',status:'Provider access required',
    docs:'https://www.constructconnect.com/'},
  {name:'PlanHub',status:'Provider access required',
    docs:'https://www.planhub.com/'},
  {name:'BidNet Direct',status:'Vendor registration required',
    docs:'https://www.bidnetdirect.com/'},
  {name:'Texas ESBD',status:'Official bid portal (external submission)',
    docs:'https://comptroller.texas.gov/purchasing/contracts/bid-opportunities.php'},
  {name:'TxDOT letting plans',status:'Public letting documents; submission is external',
    docs:'https://www.txdot.gov/business/plans-online-bid-lettings.html'},
] as const;
const PROVIDERS=['Autodesk BuildingConnected','Procore','ConstructConnect','PlanHub',
  'Buildertrend','Jobber','ServiceTitan','AccuLynx','CompanyCam','Houzz Pro','Other'];
type Portal={id:string;provider:string;label:string;url:string;addedAt:string};
function cleanPortalUrl(raw:string):string {
  const value=new URL(raw.trim());
  if(value.protocol!=='https:'||!value.hostname||value.username||value.password)throw Error(
    'Enter a full HTTPS portal URL with no embedded username or password.');
  if(['localhost','127.0.0.1','0.0.0.0'].includes(value.hostname))throw Error('Use a public HTTPS provider URL.');
  value.hash='';
  return value.toString();
}
export function ConnectorSettings(){
  return <RouteGate routeId="settings.connectors"><PortalWorkspace/></RouteGate>;
}
function PortalWorkspace(){
  const {api}=useApi();
  const {orgId}=useSession();
  const feeds=useQuery({
    queryKey:orgKey(orgId,'bidding','external','providers'),
    queryFn:()=>api.get('/v1/bidding/external/providers',{schema:OfficialCatalog}),
  });
  const [portals,setPortals]=useState<Portal[]>([]);
  const [provider,setProvider]=useState(PROVIDERS[0]!);
  const [label,setLabel]=useState('');
  const [url,setUrl]=useState('');
  const [error,setError]=useState('');
  const draft=useAccountDraft({
    key:'bid-portals',value:{portals},legacyKey:'__no_legacy_bid_portals__',
    onRestore:restored=>{
      if(Array.isArray(restored.portals))setPortals(restored.portals.filter((p):p is Portal=>
        Boolean(p&&typeof p.id==='string'&&typeof p.provider==='string'&&
          typeof p.label==='string'&&typeof p.url==='string'&&p.url.startsWith('https://')&&
          typeof p.addedAt==='string')).slice(0,30));
    },
  });
  const save=(event:FormEvent)=>{
    event.preventDefault();setError('');
    if(!draft.ready){setError('Account storage is still loading.');return;}
    try {
      const checked=cleanPortalUrl(url);
      const portal={id:crypto.randomUUID(),provider,label:(label.trim()||provider).slice(0,100),
        url:checked,addedAt:new Date().toISOString()};
      if(portals.some(p=>p.url===portal.url)){setError('This portal URL is already saved.');return;}
      if(portals.length>=30){setError('You have reached the 30-portal limit. Remove an old one first.');return;}
      setPortals(list=>[portal,...list]);setUrl('');setLabel('');
    }catch(cause){setError(cause instanceof Error?cause.message:'Invalid portal URL.');}
  };
  const remove=(id:string)=>setPortals(list=>list.filter(p=>p.id!==id));
  return <main className="cc-work-board">
    <PageHeader title="Bidding integrations & portals" description="Organize the construction services your business uses and quickly open their bidding dashboards."/>
    <section className="web-card">
      <h2>Save an external bidding portal</h2>
      <p className="web-muted">This is a secure portal shortcut, <strong>not</strong> a live OAuth or API connection. No bids, leads, messages or emails are imported automatically. Never paste passwords or API secrets.</p>
      <form className="cc-work-board__form" onSubmit={save}>
        <label>Provider<select value={provider} onChange={e=>setProvider(e.target.value)}>
          {PROVIDERS.map(name=><option key={name} value={name}>{name}</option>)}
        </select></label>
        <label>Shortcut name<input value={label} maxLength={100} onChange={e=>setLabel(e.target.value)} placeholder="Our company bid board"/></label>
        <label className="cc-work-board__wide">Your portal URL<input required type="url" inputMode="url" maxLength={2000}
          value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://your-provider.com/company/…"/></label>
        <button className="cc-btn cc-btn--primary" type="submit" disabled={!draft.ready||!url.trim()}>Save portal</button>
      </form>
      {error&&<p role="alert" className="web-error">{error}</p>}
      <p className="web-muted web-small" role="status">Cloud storage: {draft.status}.
        {draft.message&&' '+draft.message}</p>
      {(draft.status==='error'||draft.status==='conflict')&&
        <button className="cc-btn" type="button" onClick={draft.reload}>Reload account portals</button>}
    </section>
    <section className="web-section">
      <h2>Your saved portals</h2>
      {portals.length===0&&<p className="web-card">No external portals saved. Add a service URL above.</p>}
      <div className="cc-work-board__cards">
        {portals.map(portal=><article className="web-card" key={portal.id}>
          <strong>{portal.label}</strong>
          <p className="web-muted web-small">{portal.provider} · Shortcut only</p>
          <p className="web-muted web-small" style={{overflowWrap:'anywhere'}}>{portal.url}</p>
          <div className="cc-work-board__links">
            <a className="cc-work-board__link" target="_blank" rel="noopener noreferrer" href={portal.url}>Open provider portal ↗</a>
            <button type="button" className="cc-btn" onClick={()=>remove(portal.id)}>Remove</button>
          </div>
        </article>)}
      </div>
    </section>
    <section className="web-card">
      <h2>Official public bidding feeds</h2>
      <p className="web-muted">These connectors use published government APIs rather than private portal sessions. Some need an administrator to configure server-side credentials. Status refers to API setup, not a provider login.</p>
      {feeds.isLoading&&<p>Checking connected feed setup…</p>}
      {feeds.error&&<p role="alert">Could not read official feed setup. Refresh this page.</p>}
      <div className="cc-work-board__cards">
        {feeds.data?.providers.map(p=><article className="web-card" key={p.id}>
          <strong>{p.name}</strong>
          <p className="web-muted">{p.geo} · {p.status==='ready'?'Ready to query':'Server API key required'}</p>
          <a href={p.documentation} target="_blank" rel="noopener noreferrer">Provider API documentation</a>
          <a href="/bidding">Find external bidding opportunities</a>
        </article>)}
      </div>
      <p className="web-muted web-small">For SAM.gov, set SAM_GOV_API_KEY in Render API environment settings. Keys must never be stored in browser storage or an email draft.</p>
    </section>
    <section className="web-card">
      <h2>External company connector directory</h2>
      <p className="web-muted">Provider access requires your own account, subscription, and approved OAuth/API setup. These options are clearly marked as not connected until the provider authorizes access. You can save a portal shortcut above in the meantime.</p>
      <div className="cc-work-board__cards">
        {COMPANY_CONNECTORS.map(p=><article className="web-card" key={p.name}>
          <strong>{p.name}</strong><p className="web-muted web-small">{p.status}</p>
          <a className="cc-work-board__link" href={p.docs} target="_blank" rel="noopener noreferrer">Provider / developer site</a>
        </article>)}
      </div>
    </section>
    <section className="web-card">
      <h2>Connected companies inside Field Pro</h2>
      <p className="web-muted">Use the Contractor Network to find opted-in companies and request an active project-scoped connection. Once connected, your private bid invitations can be visible to those partners.</p>
      <a className="cc-work-board__link" href="/network">Open Contractor Network</a>
      <p className="web-muted web-small">External API integrations need each provider’s approved OAuth/API setup and credentials. This screen does not claim access or sync status for those services.</p>
    </section>
  </main>;
}
