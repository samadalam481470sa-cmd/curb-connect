'use client';
// Authenticated account's manually imported external company bid exports.
// This screen never transmits third-party credentials or executes bids outside Field Pro.
import {useRef,useState} from 'react';
import {useAccountDraft} from '../../lib/accountDrafts';
import {COMPANY_SOURCES,parseCompanyBids,type CompanyBid} from './companyBidImports';
export function ExternalCompanyImports(){
  const [items,setItems]=useState<CompanyBid[]>([]);
  const [provider,setProvider]=useState<string>(COMPANY_SOURCES[0]!);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  const draft=useAccountDraft({
    key:'external-bid-imports',value:{items},legacyKey:'__no_local_external_bid_imports__',
    onRestore:(restored)=>{
      if(Array.isArray(restored.items))setItems(restored.items.filter((v):v is CompanyBid=>
        Boolean(v&&typeof v.id==='string'&&typeof v.provider==='string'&&
          typeof v.title==='string'&&typeof v.company==='string'&&typeof v.location==='string'&&
          typeof v.importedAt==='string'&&(v.sourceUrl===null||typeof v.sourceUrl==='string')&&
          (v.dueDate===null||typeof v.dueDate==='string')&&typeof v.notes==='string')).slice(0,100));
    },
  });
  const importFile=async(file:File|undefined)=>{
    if(!file)return;
    if(!draft.ready){setError('Load your account before importing company files.');return;}
    if(file.size>900000){setError('Limit imports to 900 KB.');return;}
    setLoading(true);setError('');setMessage('');
    try{
      const parsed=parseCompanyBids(await file.text(),file.name,provider);
      setItems(previous=>{
        const merged=[...parsed,...previous.filter(p=>!parsed.some(i=>i.id===p.id))];
        return merged.slice(0,100);
      });
      setMessage(parsed.length+' valid opportunities imported from your '+provider+
        ' export. Save status appears below.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not import this export.');}
    finally{setLoading(false);if(input.current)input.current.value='';}
  };
  return <section className="web-card cc-work-board__external" id="imported-bids" aria-labelledby="imported-bids-heading">
    <h2 id="imported-bids-heading">Import bids from company platforms</h2>
    <p className="web-muted">Bring opportunity exports from BuildingConnected, Procore, ConstructConnect,
      PlanHub, BidNet Direct or another provider. Upload only data your business may access and
      reuse. Entries are saved to <strong>your signed-in Field Pro account</strong> and remain read-only:
      official bid submission must occur on the original service.</p>
    <div className="cc-work-board__form">
      <label>Export source
        <select value={provider} onChange={event=>setProvider(event.target.value)}>
          {COMPANY_SOURCES.map(name=><option key={name}>{name}</option>)}
        </select>
      </label>
      <label>Upload authorized CSV or JSON export
        <input ref={input} type="file" accept=".csv,.json,text/csv,application/json"
          disabled={!draft.ready||loading} onChange={event=>void importFile(event.currentTarget.files?.[0])}/>
      </label>
    </div>
    <p className="web-muted web-small">Recognized columns: Project Name, General Contractor,
      Bid Due, Project URL and Description (or common equivalents). Up to 100 records / 900 KB.
      This imports exported records; it does not authenticate or sync a private company API.</p>
    {error&&<p className="web-error" role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    <p role="status" className="web-muted web-small">Account save: {draft.status}.
      {draft.message&&' '+draft.message}</p>
    {(draft.status==='conflict'||draft.status==='error')&&
      <button className="cc-btn" type="button" onClick={draft.reload}>Reload saved company bids</button>}
    {items.length===0?<p className="web-muted">No imported company invitations yet.</p>:
      <div className="cc-work-board__cards">
        {items.map(item=><article key={item.id} className="web-card">
          <small className="cc-work-board__source">Imported from {item.provider}</small>
          <strong>{item.title}</strong>
          <p className="web-muted web-small">{item.company||'Company not included'} · {item.location||'Location not included'}</p>
          {item.notes&&<p>{item.notes}</p>}
          <p className="web-muted web-small">Bid due: {item.dueDate||'Not provided'} · Imported: {item.importedAt.slice(0,10)}</p>
          {item.sourceUrl&&<a href={item.sourceUrl} className="cc-work-board__link" target="_blank"
            rel="noopener noreferrer">Open original listing</a>}
          <button className="cc-btn" type="button" disabled={!draft.ready}
            onClick={()=>setItems(list=>list.filter(i=>i.id!==item.id))}>Remove imported record</button>
        </article>)}
      </div>}
  </section>;
}
