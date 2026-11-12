'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi, useSession, orgKey } from '../../lib/session';

const Group = z.object({
  currency:z.string(),
  draftToInvoiceMinor:z.number(),draftCount:z.number(),
  sentMinor:z.number(),sentCount:z.number(),
  receivableMinor:z.number(),receivedMinor:z.number(),receivedCount:z.number(),
  payableMinor:z.number(),paidIncomingMinor:z.number(),
});
const Summary=z.object({generatedAt:z.string(),scope:z.string(),groups:z.array(Group)});

const usd=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(minor/100);}
  catch{return (minor/100).toFixed(2)+' '+currency;}
};
const fields=[
  {key:'draftToInvoiceMinor',label:'Awaiting issue',note:'Draft and pending-approval invoice values'},
  {key:'sentMinor',label:'Sent invoices',note:'Lifetime invoice face value with recorded sent timestamp'},
  {key:'receivableMinor',label:'Still to collect',note:'Issued and partially paid invoices, net of recorded payments/refunds'},
  {key:'receivedMinor',label:'Invoices received',note:'Lifetime bills from other connected companies'},
  {key:'payableMinor',label:'Outstanding payable',note:'Received, approved and disputed bills awaiting settlement'},
  {key:'paidIncomingMinor',label:'Paid bills',note:'Received bills with confirmed paid status'},
] as const;

export function InvoiceMasterDashboard() {
  const {api}=useApi();
  const session=useSession();
  const allowed=session.can('invoice:read')&&session.can('bill:read');
  const overview=useQuery({
    queryKey:orgKey(session.orgId,'dashboard','invoices-summary'),
    queryFn:()=>api.get('/v1/dashboard/invoices-summary',{schema:Summary}),
    enabled:allowed,refetchInterval:120000,
  });
  return <main className="cc-invoice-master">
    <header className="cc-page-head">
      <div><div className="cc-eyebrow">Field Pro // Finance Command Center</div>
        <h1>Invoice Master Dashboard</h1>
        <p>Amounts across your current company, grouped by currency. Figures come directly
          from the invoice and received-bill ledgers—not estimates or email drafts.</p>
      </div>
      <div style={{display:'flex',gap:9,flexWrap:'wrap'}}>
        <Link className="cc-btn cc-btn--primary" href="/billing">Manage invoices</Link>
        <button className="cc-btn" type="button" disabled={!allowed||overview.isFetching}
          onClick={()=>void overview.refetch()}>Refresh totals</button>
      </div>
    </header>
    {!allowed ? <p className="web-denied-reason">This dashboard requires both invoice and received-bill read permissions.</p>
    : overview.error ? <ErrorNotice error={overview.error} title="Invoice totals unavailable"
        onRetry={()=>void overview.refetch()} />
    : overview.isPending ? <p role="status">Calculating all-company invoice totals…</p>
    : <>
      <p className="web-muted web-small">Generated {new Date(overview.data.generatedAt).toLocaleString()}.
        Automatically refreshes while this screen is open. Counts and money are company-scoped,
        not consolidated across unrelated workspaces. Drafts are not revenue.</p>
      {overview.data.groups.length===0 && <div className="web-card">
        <p>No invoices or received bills have been recorded in this workspace.</p>
        <Link href="/billing">Start an invoice in Billing</Link>
      </div>}
      {overview.data.groups.map(group=><section key={group.currency}
        className="web-section" aria-label={group.currency+' invoice summary'}>
        <h2>{group.currency} Overview</h2>
        <div className="cc-invoice-grid">
          {fields.map(({key,label,note})=><article key={key} className="web-card cc-invoice-card">
            <h3>{label}</h3><strong>{usd(group[key],group.currency)}</strong>
            <p className="web-muted web-small">{note}</p>
          </article>)}
        </div>
        <p className="web-muted web-small">{group.draftCount} drafts/pending ·
          {' '}{group.sentCount} sent · {group.receivedCount} received bills.
          Status reflects Field Pro records, not whether an external email was opened.
        </p>
      </section>)}
    </>}
    <div className="cc-callout cc-callout--info"><p>
      <strong>Accounting boundaries:</strong> The estimated work awaiting a new invoice is not
      derivable from invoice documents alone; use approved job progress and contract
      schedules for unbilled work in a future project-cost integration. Current
      “Awaiting issue” only totals existing drafts. Paid, void and uncollectible
      invoices are excluded from the receivable balance.
    </p></div>
  </main>;
}
