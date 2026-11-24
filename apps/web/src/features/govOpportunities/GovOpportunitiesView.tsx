// Gov Opportunities: the finder that finds .gov listing opportunities FOR the contractor and
// tells them. The app scans city/state .gov resource pages for dead links every morning,
// checks SAM.gov registration and the Texas CMBL, and shows the contractor what it found —
// the contractor does no researching. Nothing is sent anywhere from this page; the contractor
// decides what to do with each opportunity. A link is shown as dead only because an actual
// HTTP check said so (checked-at time on every card); CMBL can never be checked automatically,
// so it always says so with the exact steps.
'use client';

import type { GovOpportunity } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';
import { formatCheckedAt, listingLabel } from './govOpportunities';

const TRADES = {
  grading: 'Grading and site work',
  concrete: 'Concrete and curb cutting',
  roofing: 'Roofing',
  materials: 'Building materials supply',
  framing: 'Framing and lumber',
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  general: 'General subcontracting',
} as const;
type Trade = keyof typeof TRADES;

export function GovOpportunitiesView() {
  return (
    <RouteGate routeId="govOpportunities">
      <GovOpportunitiesContent />
    </RouteGate>
  );
}

function GovOpportunitiesContent() {
  const { endpoints } = useApi();
  const { orgId } = useSession();
  const queryClient = useQueryClient();
  const [trade, setTrade] = useState<Trade>('general');
  const [company, setCompany] = useState('');
  const [draftFor, setDraftFor] = useState<GovOpportunity | null>(null);
  const [draft, setDraft] = useState<string | null>(null);

  const status = useQuery({
    queryKey: orgKey(orgId, 'gov-opportunities', 'status'),
    queryFn: () => endpoints.govOpportunitiesStatus(),
    staleTime: 300000,
  });
  const data = useQuery({
    queryKey: orgKey(orgId, 'gov-opportunities', trade, company.trim()),
    queryFn: () => endpoints.govOpportunities({ trade, company: company.trim() || undefined }),
    staleTime: 300000,
  });
  const refresh = useMutation({
    mutationFn: () => endpoints.govOpportunitiesRefresh(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'gov-opportunities') });
    },
  });
  const draftMutation = useMutation({
    mutationFn: (opp: GovOpportunity) =>
      endpoints.govOpportunitiesDraft({
        pageName: opp.pageName,
        pageUrl: opp.pageUrl,
        deadUrl: opp.deadUrl,
        linkText: opp.linkText,
        trade: opp.trade,
        company: company.trim(),
        yourName: '',
        website: '',
      }),
    onSuccess: (result, opp) => {
      setDraftFor(opp);
      setDraft(result.draft);
    },
  });

  const opps = data.data?.opportunities ?? [];
  const listings = data.data?.listings ?? [];

  return (
    <div>
      <PageHeader
        title="Gov Opportunities"
        description="Field Pro finds .gov listing opportunities for you and tells you about them — you do no researching. Every morning it checks city and state resource pages for dead links you could replace, and checks whether your company is listed on SAM.gov and the Texas CMBL."
      />

      <section className="web-card" aria-labelledby="gov-scan-heading">
        <h2 id="gov-scan-heading">Daily scan</h2>
        <p className="web-muted web-small">
          {status.data
            ? `Last scan ${formatCheckedAt(status.data.lastCheckedAt)}. ${status.data.pages.length} resource pages checked.`
            : 'Scan status loading…'}
        </p>
        <p className="web-muted web-small">{data.data?.emailNote ?? status.data?.emailNote ?? ''}</p>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? 'Scanning…' : 'Scan now'}
        </button>
        {refresh.isError && (
          <ErrorNotice error={refresh.error} />
        )}
        {refresh.data && (
          <p className="web-small">
            Scan finished: {refresh.data.linksChecked} links checked, {refresh.data.deadFound} dead
            links found, {refresh.data.unknownCount} could not be checked.
          </p>
        )}
      </section>

      <section className="web-card" aria-labelledby="gov-listings-heading">
        <h2 id="gov-listings-heading">Where your company is listed</h2>
        <p className="web-muted web-small">
          Enter your company name to check SAM.gov. The CMBL has no public search, so Field Pro
          cannot check it for you — the steps to look yourself up are listed there.
        </p>
        <label className="cc-field">
          <span>Company name</span>
          <input
            className="cc-input"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="e.g. Acme Roofing LLC"
            autoComplete="organization"
          />
        </label>
        {listings.length === 0 && data.isPending && <p className="web-muted">Checking listings…</p>}
        <ul className="web-list">
          {listings.map((listing) => (
            <li key={listing.id}>
              <strong>{listing.name}</strong> — {listingLabel(listing.status)}
              <p className="web-muted web-small">{listing.detail}</p>
              {listing.steps && (
                <ol className="web-small">
                  {listing.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              <p className="web-small">
                <a href={listing.url} target="_blank" rel="noreferrer">
                  Open {listing.id === 'sam' ? 'SAM.gov' : 'CMBL search'}
                </a>
                {listing.checkedAt ? ` · ${formatCheckedAt(listing.checkedAt)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="web-card" aria-labelledby="gov-dead-links-heading">
        <h2 id="gov-dead-links-heading">Dead links you could replace</h2>
        <label className="cc-field">
          <span>Your trade</span>
          <select className="cc-input" value={trade} onChange={(event) => setTrade(event.target.value as Trade)}>
            {(Object.keys(TRADES) as Trade[]).map((t) => (
              <option key={t} value={t}>
                {TRADES[t]}
              </option>
            ))}
          </select>
        </label>
        {data.isPending && <p className="web-muted">Finding opportunities…</p>}
        {data.isError && <ErrorNotice error={data.error} />}
        {data.data && opps.length === 0 && (
          <p className="web-muted">
            No dead links found for {TRADES[trade]} on the scanned resource pages
            {data.data.lastCheckedAt ? ` (last scan ${formatCheckedAt(data.data.lastCheckedAt)})` : ''}.
            The scan runs again tomorrow morning.
          </p>
        )}
        <ul className="web-list">
          {opps.map((opp) => (
            <li key={`${opp.pageId}:${opp.deadUrl}`}>
              <strong>
                {opp.match === 'strong' ? 'Strong match — ' : ''}
                {opp.linkText}
              </strong>
              <p className="web-muted web-small">
                On {opp.pageName} ({opp.pageCity}) · dead link: {opp.deadUrl}
                {opp.httpStatus ? ` (HTTP ${opp.httpStatus})` : ''} · {formatCheckedAt(opp.checkedAt)}
              </p>
              <p className="web-small">{opp.whatToOffer}</p>
              <p className="web-small">
                <a href={opp.pageUrl} target="_blank" rel="noreferrer">
                  Open the resource page
                </a>
              </p>
              {data.data?.aiConfigured && company.trim() && (
                <button
                  type="button"
                  className="cc-btn"
                  disabled={draftMutation.isPending}
                  onClick={() => {
                    setDraft(null);
                    draftMutation.mutate(opp);
                  }}
                >
                  {draftMutation.isPending && draftFor?.deadUrl === opp.deadUrl
                    ? 'Drafting…'
                    : 'Draft outreach email'}
                </button>
              )}
              {draftFor?.deadUrl === opp.deadUrl && draftMutation.isError && (
                <ErrorNotice error={draftMutation.error} />
              )}
              {draftFor?.deadUrl === opp.deadUrl && draft && (
                <pre className="web-small" style={{ whiteSpace: 'pre-wrap' }}>
                  {draft}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="web-card" aria-labelledby="gov-pages-heading">
        <h2 id="gov-pages-heading">Resource pages scanned</h2>
        <ul className="web-list">
          {(status.data?.pages ?? []).map((page) => (
            <li key={page.id}>
              <strong>{page.name}</strong> ({page.city})
              <p className="web-muted web-small">
                {page.linksChecked} links checked · {page.deadLinks} dead · {page.liveLinks} live ·{' '}
                {page.unknownLinks} could not be checked · {formatCheckedAt(page.lastCheckedAt)}
              </p>
              <p className="web-small">
                <a href={page.url} target="_blank" rel="noreferrer">
                  Open the page
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
