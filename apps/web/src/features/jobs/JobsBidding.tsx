'use client';

// Live, tenant-scoped jobs and opt-in contractor bid marketplace. Never populate fake bids.
import { useState, type FormEvent } from 'react';
import { ExternalBidDiscovery } from './ExternalBidDiscovery';
import { ExternalCompanyImports } from './ExternalCompanyImports';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { PageHeader, ErrorNotice } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { useApi, useSession, orgKey } from '../../lib/session';
import { errorHint } from '../../lib/api';

const Job = z.object({
  id:z.string(),number:z.string(),title:z.string(),productLine:z.string(),
  stage:z.string(),status:z.string(),estimatedValueMinor:z.number().nullable(),
  currency:z.string(),createdAt:z.string(),
});
const Opportunity = z.object({
  id:z.string(),ownerOrgId:z.string(),ownerName:z.string(),title:z.string(),
  description:z.string(),trade:z.string(),city:z.string(),region:z.string(),
  currency:z.string(),budgetMinor:z.number().nullable(),dueOn:z.string().nullable(),
  visibility:z.string(),status:z.string(),createdAt:z.string(),
  offerCount:z.number(),myOfferStatus:z.string().nullable(),
});
const Offer = z.object({
  id:z.string(),opportunityId:z.string(),bidderOrgId:z.string(),bidderName:z.string(),
  amountMinor:z.number(),estimatedDays:z.number().nullable(),message:z.string(),
  status:z.string(),createdAt:z.string(),
});
type BidPost = z.infer<typeof Opportunity>;
const JobsList=z.object({items:z.array(Job)});
const OpportunityList=z.object({items:z.array(Opportunity)});
const OfferList=z.object({items:z.array(Offer)});

const STAGES=['intake','estimating','scheduled','in_progress','completed'] as const;
const LABELS:Record<string,string>={
  intake:'Intake',estimating:'Estimating',scheduled:'Scheduled',
  in_progress:'In progress',completed:'Completed',
};
const TRADES=['roof','curb','plumbing','hvac','electrical','concrete','general','other'];
const dollarValue=(minor:number|null,currency='USD')=>minor===null?'Not specified':
  new Intl.NumberFormat('en-US',{style:'currency',currency}).format(minor/100);
function parseDollars(value:string,optional=false):number|null {
  const clean=value.trim().replace(/,/g,'');
  if(optional&&!clean)return null;
  if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(clean))throw Error('Enter a positive amount with at most two decimal places.');
  const cents=Math.round(Number(clean)*100);
  if(!Number.isSafeInteger(cents)||cents<=0)throw Error('Enter an amount greater than zero.');
  return cents;
}

export function JobsWorkspace(){
  return <RouteGate routeId="jobs"><JobsContent/></RouteGate>;
}
function JobsContent(){
  const session=useSession();
  const {api}=useApi();
  const queryClient=useQueryClient();
  const key=orgKey(session.orgId,'jobs','list');
  const list=useQuery({queryKey:key,queryFn:()=>api.get('/v1/jobs',{schema:JobsList})});
  const [title,setTitle]=useState('');
  const [line,setLine]=useState<'roof'|'curb'>('roof');
  const [amount,setAmount]=useState('');
  const [error,setError]=useState('');
  const canWrite=session.check('job:write');
  const canMove=session.check('job:move_stage');
  const create=useMutation({
    mutationFn:()=>api.post('/v1/jobs',{title:title.trim(),productLine:line,estimatedValueMinor:parseDollars(amount,true)},{schema:Job}),
    onSuccess:()=>{setTitle('');setAmount('');setError('');void queryClient.invalidateQueries({queryKey:key});},
    onError:(cause)=>setError(errorHint(cause)),
  });
  const move=useMutation({
    mutationFn:({id,stage}:{id:string;stage:string})=>api.patch('/v1/jobs/'+encodeURIComponent(id)+'/stage',{stage},{schema:Job}),
    onSuccess:()=>{setError('');void queryClient.invalidateQueries({queryKey:key});},
    onError:(cause)=>setError(errorHint(cause)),
  });
  const submit=(event:FormEvent)=>{event.preventDefault();try{
    if(title.trim().length<4){setError('Job title must contain at least four characters.');return;}
    setError('');create.mutate();
  }catch(cause){setError(cause instanceof Error?cause.message:'Invalid job.');}};
  return <main className="cc-work-board">
    <PageHeader title="Jobs" description="Track real company jobs from intake through completion. Saved to your company account."/>
    <div className="cc-work-board__links">
      <Link href="/bidding" className="cc-work-board__link">Open contractor bidding →</Link>
      <Link href="/network" className="cc-work-board__link">Contractor network →</Link>
    </div>
    <section className="web-card" aria-labelledby="job-create-title">
      <h2 id="job-create-title">Create job</h2>
      <form className="cc-work-board__form" onSubmit={submit}>
        <label>Job title<input required minLength={4} maxLength={180} value={title}
          onChange={e=>setTitle(e.target.value)} placeholder="Roof replacement · 123 Main St"/></label>
        <label>Work category<select value={line} onChange={e=>setLine(e.target.value as 'roof'|'curb')}>
          <option value="roof">Roofing</option><option value="curb">Curb cutting</option>
        </select></label>
        <label>Estimated value ($, optional)<input type="text" inputMode="decimal" value={amount}
          onChange={e=>setAmount(e.target.value)} placeholder="12500.00"/></label>
        <button className="cc-btn cc-btn--primary" type="submit" disabled={!canWrite.allowed||create.isPending}>
          {create.isPending?'Saving job…':'Create job'}
        </button>
      </form>
      {!canWrite.allowed&&<p className="web-muted">{canWrite.reason}</p>}
    </section>
    <section className="web-section" aria-labelledby="jobs-list-title">
      <h2 id="jobs-list-title">Company pipeline</h2>
      {list.isPending&&<p role="status">Loading your jobs…</p>}
      {list.error&&<ErrorNotice error={list.error} title="Could not load jobs" onRetry={()=>void list.refetch()}/>}
      {list.data?.items.length===0&&<p className="web-card">No jobs yet. Create your first job above.</p>}
      <div className="cc-work-board__cards">
        {list.data?.items.map(job=><article className="web-card" key={job.id}>
          <div className="cc-work-board__cardhead"><strong>{job.title}</strong><span>{job.number}</span></div>
          <p className="web-muted">{job.productLine==='roof'?'Roofing':'Curb cutting'} · {dollarValue(job.estimatedValueMinor,job.currency)}</p>
          <label>Pipeline stage
            <select value={STAGES.includes(job.stage as typeof STAGES[number])?job.stage:'intake'}
              disabled={!canMove.allowed||move.isPending||job.status==='cancelled'}
              aria-label={'Stage for '+job.title}
              onChange={e=>move.mutate({id:job.id,stage:e.target.value})}>
              {STAGES.map(stage=><option value={stage} key={stage}>{LABELS[stage]}</option>)}
            </select>
          </label>
          <p className="web-muted web-small">Current: {LABELS[job.stage]??job.stage} · {job.status}</p>
        </article>)}
      </div>
    </section>
    {error&&<p className="web-error" role="alert">{error}</p>}
  </main>;
}

export function BiddingWorkspace(){
  return <RouteGate routeId="bidding"><BiddingContent/></RouteGate>;
}
function BiddingContent(){
  const session=useSession();
  const {api}=useApi();
  const client=useQueryClient();
  const key=orgKey(session.orgId,'bidding','opportunities');
  const list=useQuery({queryKey:key,queryFn:()=>api.get('/v1/bidding/opportunities',{schema:OpportunityList})});
  const [title,setTitle]=useState('');
  const [description,setDescription]=useState('');
  const [trade,setTrade]=useState('roof');
  const [city,setCity]=useState('');
  const [region,setRegion]=useState('Texas');
  const [budget,setBudget]=useState('');
  const [deadline,setDeadline]=useState('');
  const [visibility,setVisibility]=useState<'connections'|'marketplace'>('connections');
  const [searchCity,setSearchCity]=useState('');
  const [searchTrade,setSearchTrade]=useState('');
  const [selected,setSelected]=useState<BidPost|null>(null);
  const [bidAmount,setBidAmount]=useState('');
  const [bidDays,setBidDays]=useState('');
  const [bidMessage,setBidMessage]=useState('');
  const [feedback,setFeedback]=useState('');
  const [error,setError]=useState('');
  const canWrite=session.check('job:write');
  const offersKey=orgKey(session.orgId,'bidding','offers',selected?.id??'');
  const offers=useQuery({queryKey:offersKey,queryFn:()=>api.get('/v1/bidding/opportunities/'+
    encodeURIComponent(selected!.id)+'/offers',{schema:OfferList}),enabled:!!selected});
  const invalidate=()=>{void client.invalidateQueries({queryKey:key});void client.invalidateQueries({queryKey:offersKey});};
  const create=useMutation({
    mutationFn:()=>api.post('/v1/bidding/opportunities',{
      title:title.trim(),description:description.trim(),trade,
      city:city.trim(),region:region.trim(),budgetMinor:parseDollars(budget,true),
      dueOn:deadline||null,visibility,
    },{schema:Opportunity}),
    onSuccess:()=>{setTitle('');setDescription('');setBudget('');setDeadline('');setFeedback('Job invitation published.');setError('');invalidate();},
    onError:cause=>setError(errorHint(cause)),
  });
  const submitBid=useMutation({
    mutationFn:()=>api.post('/v1/bidding/opportunities/'+encodeURIComponent(selected!.id)+'/offers',{
      amountMinor:parseDollars(bidAmount),estimatedDays:bidDays?Number(bidDays):null,
      message:bidMessage.trim(),
    },{schema:Offer}),
    onSuccess:()=>{setFeedback('Your company bid was submitted. The owner can now review it.');setError('');setBidAmount('');setBidMessage('');invalidate();},
    onError:cause=>setError(errorHint(cause)),
  });
  const decide=useMutation({
    mutationFn:({offerId,decision}:{offerId:string;decision:'accepted'|'declined'})=>
      api.post('/v1/bidding/offers/'+encodeURIComponent(offerId)+'/decision',{decision},{schema:Offer}),
    onSuccess:()=>{setFeedback('Bid decision saved.');setError('');invalidate();},
    onError:cause=>setError(errorHint(cause)),
  });
  const close=useMutation({
    mutationFn:(id:string)=>api.post('/v1/bidding/opportunities/'+encodeURIComponent(id)+'/close',{}),
    onSuccess:()=>{setFeedback('Invitation closed.');setError('');setSelected(null);invalidate();},
    onError:cause=>setError(errorHint(cause)),
  });
  const post=(event:FormEvent)=>{event.preventDefault();try{
    if(title.trim().length<4||description.trim().length<10){setError('Enter a clear title and job description.');return;}
    if(city.trim().length<2||region.trim().length<2){setError('Add your city and state/region.');return;}
    setError('');create.mutate();
  }catch(cause){setError(cause instanceof Error?cause.message:'Invalid invitation.');}};
  const bid=(event:FormEvent)=>{event.preventDefault();try{
    if(bidMessage.trim().length<10){setError('Enter at least ten characters about your bid.');return;}
    if(bidDays&&(!Number.isInteger(Number(bidDays))||Number(bidDays)<1||Number(bidDays)>3650)){
      setError('Estimated days must be between 1 and 3650.');return;
    }
    setError('');submitBid.mutate();
  }catch(cause){setError(cause instanceof Error?cause.message:'Invalid bid.');}};
  const items=(list.data?.items??[]).filter(item=>
    (!searchCity||[item.city,item.region].join(' ').toLowerCase().includes(searchCity.toLowerCase()))&&
    (!searchTrade||item.trade===searchTrade));
  const owned=items.filter(item=>item.ownerOrgId===session.orgId);
  const available=items.filter(item=>item.ownerOrgId!==session.orgId);
  const selectPost=(item:BidPost)=>{setSelected(item);setFeedback('');setError('');};
  return <main className="cc-work-board">
    <PageHeader title="Bidding" description="Publish real job opportunities and exchange bids with connected contractors or opted-in Field Pro companies."/>
    <div className="cc-work-board__links">
      <Link href="/jobs" className="cc-work-board__link">Company jobs →</Link>
      <Link href="/network" className="cc-work-board__link">Find / connect contractors →</Link>
      <Link href="/settings/connectors" className="cc-work-board__link">External bidding portal settings →</Link>
    </div>
    <p className="web-muted web-small">The marketplace lists only jobs posted inside Field Pro. External services are not scraped or synced without their authorized APIs. Sharing publicly requires opting in to the company directory in Network.</p>
    <section className="web-card" aria-labelledby="bid-publish-title">
      <h2 id="bid-publish-title">Post a job for bids</h2>
      <form className="cc-work-board__form" onSubmit={post}>
        <label>Job title<input required minLength={4} maxLength={180} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Concrete apron replacement"/></label>
        <label>Trade<select value={trade} onChange={e=>setTrade(e.target.value)}>{TRADES.map(t=><option key={t} value={t}>{t.toUpperCase()}</option>)}</select></label>
        <label>City<input required maxLength={100} value={city} onChange={e=>setCity(e.target.value)} placeholder="Fort Worth"/></label>
        <label>State / region<input required maxLength={100} value={region} onChange={e=>setRegion(e.target.value)}/></label>
        <label>Budget ($, optional)<input type="text" inputMode="decimal" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="15000.00"/></label>
        <label>Bid deadline (optional)<input type="date" value={deadline} onChange={e=>setDeadline(e.target.value)}/></label>
        <label className="cc-work-board__wide">Job details<textarea required minLength={10} maxLength={8000} rows={3} value={description}
          onChange={e=>setDescription(e.target.value)} placeholder="Scope, materials, requirements and timing. Do not publish private homeowner details."/></label>
        <label>Who may bid?<select value={visibility} onChange={e=>setVisibility(e.target.value as 'connections'|'marketplace')}>
          <option value="connections">Connected companies (projects scope)</option>
          <option value="marketplace">Field Pro marketplace (opt-in directory)</option>
        </select></label>
        <button className="cc-btn cc-btn--primary" disabled={!canWrite.allowed||create.isPending} type="submit">{create.isPending?'Publishing…':'Publish job invitation'}</button>
      </form>
      {!canWrite.allowed&&<p className="web-muted">{canWrite.reason}</p>}
    </section>
    <section className="web-section">
      <h2>Find local jobs</h2>
      <div className="cc-work-board__form">
        <label>Search city / region<input value={searchCity} onChange={e=>setSearchCity(e.target.value)} placeholder="Dallas, Texas"/></label>
        <label>Filter trade<select value={searchTrade} onChange={e=>setSearchTrade(e.target.value)}><option value="">All trades</option>
          {TRADES.map(t=><option value={t} key={t}>{t.toUpperCase()}</option>)}</select></label>
        <button type="button" className="cc-btn" onClick={()=>{setSearchCity('');setSearchTrade('');}}>Clear filters</button>
      </div>
      {list.isPending&&<p role="status">Loading actual opportunities…</p>}
      {list.error&&<ErrorNotice title="Could not load bidding" error={list.error} onRetry={()=>void list.refetch()}/>}
      <h3>Available to bid ({available.length})</h3>
      {list.data&&available.length===0&&<p className="web-card">No matching shared invitations yet. Search another area or connect with companies in Network.</p>}
      <div className="cc-work-board__cards">
        {available.map(item=><OpportunityCard key={item.id} item={item} selected={selected?.id===item.id} onSelect={()=>selectPost(item)}/>)}
      </div>
      <h3>My company’s invitations ({owned.length})</h3>
      {list.data&&owned.length===0&&<p className="web-card">You have not published any matching jobs.</p>}
      <div className="cc-work-board__cards">
        {owned.map(item=><OpportunityCard key={item.id} item={item} selected={selected?.id===item.id} onSelect={()=>selectPost(item)}/>)}
      </div>
    </section>
    <ExternalBidDiscovery />
    <ExternalCompanyImports />
    {selected&&<section className="web-card cc-work-board__detail" aria-labelledby="bid-detail-title">
      <div className="cc-work-board__cardhead"><h2 id="bid-detail-title">{selected.title}</h2>
        <button type="button" className="cc-btn" onClick={()=>setSelected(null)}>Close details</button></div>
      <p className="web-muted">{selected.ownerName} · {selected.city}, {selected.region} · {selected.trade} · {selected.status}</p>
      <p>{selected.description}</p>
      {selected.ownerOrgId===session.orgId?<div>
        <h3>Bids received</h3>
        {offers.isPending&&<p>Loading company offers…</p>}
        {offers.error&&<ErrorNotice error={offers.error} title="Could not load bids" onRetry={()=>void offers.refetch()}/>}
        {offers.data?.items.length===0&&<p>No offers received yet.</p>}
        {offers.data?.items.map(offer=><div className="cc-work-board__offer" key={offer.id}>
          <div className="cc-work-board__cardhead"><strong>{offer.bidderName}</strong><strong>{dollarValue(offer.amountMinor,selected.currency)}</strong></div>
          <p>{offer.message}</p>
          <p className="web-muted web-small">{offer.status} · {offer.estimatedDays??'Unspecified'} day(s)</p>
          {offer.status==='submitted'&&selected.status==='open'&&canWrite.allowed&&<>
            <button type="button" disabled={decide.isPending} className="cc-btn cc-btn--primary"
              onClick={()=>decide.mutate({offerId:offer.id,decision:'accepted'})}>Accept bid</button>
            <button type="button" disabled={decide.isPending} className="cc-btn"
              onClick={()=>decide.mutate({offerId:offer.id,decision:'declined'})}>Decline bid</button>
          </>}
        </div>)}
        {selected.status==='open'&&<button type="button" className="cc-btn" disabled={close.isPending||!canWrite.allowed}
          onClick={()=>close.mutate(selected.id)}>Close bidding on this job</button>}
        <p className="web-muted web-small">Accepting a bid marks the invitation awarded. It does not execute a contract or take payment.</p>
      </div>:<div>
        <h3>Your company’s bid</h3>
        {offers.isPending&&<p>Checking prior offers…</p>}
        {offers.error&&<ErrorNotice error={offers.error} title="Could not check your offers" onRetry={()=>void offers.refetch()}/>}
        {offers.data?.items.map(offer=><div className="cc-work-board__offer" key={offer.id}>
          <strong>{dollarValue(offer.amountMinor,selected.currency)}</strong>
          <p>{offer.message}</p><p className="web-muted">Status: {offer.status}</p>
        </div>)}
        {selected.status==='open'&&!selected.myOfferStatus&&offers.data?.items.length===0&&
        <form className="cc-work-board__form" onSubmit={bid}>
          <label>Bid amount ($)<input required inputMode="decimal" value={bidAmount} onChange={e=>setBidAmount(e.target.value)} placeholder="12000.00"/></label>
          <label>Estimated days (optional)<input type="number" min={1} max={3650} value={bidDays} onChange={e=>setBidDays(e.target.value)}/></label>
          <label className="cc-work-board__wide">Proposal notes<textarea required minLength={10} maxLength={4000} rows={3}
            value={bidMessage} onChange={e=>setBidMessage(e.target.value)} placeholder="Scope included, exclusions, schedule…"/></label>
          <button className="cc-btn cc-btn--primary" type="submit" disabled={submitBid.isPending||!canWrite.allowed}>
            {submitBid.isPending?'Submitting…':'Submit bid to company'}
          </button>
        </form>}
        {selected.myOfferStatus&&<p className="web-muted">Your company has submitted an offer ({selected.myOfferStatus}).</p>}
      </div>}
    </section>}
    {feedback&&<p role="status" className="web-card">{feedback}</p>}
    {error&&<p role="alert" className="web-error">{error}</p>}
  </main>;
}
function OpportunityCard({item,selected,onSelect}:{item:BidPost;selected:boolean;onSelect:()=>void}){
  return <article className="web-card">
    <div className="cc-work-board__cardhead"><strong>{item.title}</strong><span>{item.trade}</span></div>
    <p className="web-muted">{item.ownerName} · {item.city}, {item.region}</p>
    <p>{item.description.length>180?item.description.slice(0,180)+'…':item.description}</p>
    <p className="web-muted web-small">Budget {dollarValue(item.budgetMinor,item.currency)} · {item.dueOn?'Bids due '+item.dueOn:'No stated deadline'} · {item.offerCount} bids · {item.status}</p>
    <button type="button" className="cc-btn cc-btn--primary" aria-pressed={selected} onClick={onSelect}>{selected?'Viewing details':'View / manage bids'}</button>
  </article>;
}
