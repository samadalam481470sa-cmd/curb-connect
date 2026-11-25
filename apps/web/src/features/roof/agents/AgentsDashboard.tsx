'use client';

// AI Agents for Roofing dashboard: one polished surface for the roofing agents
// from the @colton.ai.dean reel — hailstorm map + Storm Response, claims, agent
// time saved, follow-up queue, Front Desk inspection booking, and business search.
// Auto roof measuring lives in the Roof Workspace (/roof) and is linked from here.
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorNotice, PageHeader } from '../../../components/common';
import { orgKey, useApi, useSession } from '../../../lib/session';
import { BusinessSearchPanel } from '../../assistant/BusinessSearchPanel';
import { AgentHoursPanel } from '../claims/AgentHoursPanel';
import { ClaimDetail } from '../claims/ClaimDetail';
import { ClaimsList } from '../claims/ClaimsList';
import { FollowUpQueue } from '../followups/FollowUpQueue';
import { InspectionBooking } from '../inspections/InspectionBooking';
import { HailStormMap } from '../storms/HailStormMap';
import { StormResponsePanel } from '../storms/StormResponsePanel';
import { HailFeedSchema } from '../storms/api';

const AGENT_CARDS = [
  {
    id: 'storms',
    name: 'Storms',
    blurb: 'Hail events on the map, matched roofs, and Storm Response texts.',
  },
  {
    id: 'claims',
    name: 'Claims',
    blurb: 'Insurance claims per roof job, with the inspection report as evidence.',
  },
  {
    id: 'agents',
    name: 'Time saved',
    blurb: 'Hours the agents saved, measured from logged actions — an estimate.',
  },
  {
    id: 'followups',
    name: 'Follow-ups',
    blurb: 'Dry leads resurface for a timed re-contact. Manual only; no auto-send.',
  },
  {
    id: 'inspections',
    name: 'Front Desk',
    blurb: 'Book and confirm inspections in-app. No phone calls are placed.',
  },
  {
    id: 'search',
    name: 'Estimator',
    blurb: 'Ask about your own signed jobs, open quotes, pipeline, and invoices.',
  },
] as const;

export function AgentsDashboard() {
  const { api } = useApi();
  const { orgId } = useSession();
  const [selectedStormId, setSelectedStormId] = useState<string | null>(null);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  const feed = useQuery({
    queryKey: orgKey(orgId, 'roof-storms-events', 30),
    queryFn: () =>
      api.get('/v1/roof-storms/events', {
        schema: HailFeedSchema,
        query: { days: 30 },
      }),
    staleTime: 60_000,
  });

  const events = feed.data?.events ?? [];
  const selectedEvent =
    events.find((e) => e.id === selectedStormId) ?? events[0] ?? null;

  return (
    <>
      <PageHeader
        title="AI Agents for Roofing"
        description="Hailstorms, claims, follow-ups, inspections, and answers from your own business data — one dashboard. Estimates are labelled as estimates, and anything gated tells you what to connect."
        actions={
          <Link className="cc-btn cc-btn--sm" href="/roof">
            Open Roof Workspace
          </Link>
        }
      />

      {/* Agent pipeline strip */}
      <nav className="web-section" aria-label="Roofing agents">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {AGENT_CARDS.map((agent) => (
            <a
              key={agent.id}
              href={`#${agent.id}`}
              className="web-card"
              style={{ display: 'block', textDecoration: 'none' }}
            >
              <strong>{agent.name}</strong>
              <span
                className="web-muted web-small"
                style={{ display: 'block', marginTop: '0.25rem' }}
              >
                {agent.blurb}
              </span>
              {agent.id === 'storms' && feed.data ? (
                <span
                  className="web-small"
                  style={{ display: 'block', marginTop: '0.25rem' }}
                >
                  {feed.data.events.length} hail event
                  {feed.data.events.length === 1 ? '' : 's'} in the last{' '}
                  {feed.data.daysFetched} day
                  {feed.data.daysFetched === 1 ? '' : 's'}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      </nav>

      {/* Storms: hail map + response, side by side */}
      <section
        id="storms"
        className="web-section"
        aria-labelledby="agents-storms-heading"
      >
        <h2 id="agents-storms-heading">Hailstorm map &amp; Storm Response</h2>
        {feed.isError ? (
          <ErrorNotice
            error={feed.error}
            title="Hail events could not be loaded"
            onRetry={() => void feed.refetch()}
          />
        ) : null}
        {feed.data?.status === 'unavailable' ? (
          <p className="web-muted web-small">
            {feed.data.message} Checked at{' '}
            {new Date(feed.data.checkedAt).toLocaleString()}.
          </p>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          <HailStormMap
            events={events}
            selectedId={selectedEvent?.id ?? null}
            onSelect={setSelectedStormId}
          />
          <StormResponsePanel event={selectedEvent} />
        </div>
        {feed.data ? (
          <p className="web-muted web-small">
            Source: {feed.data.source} · checked{' '}
            {new Date(feed.data.checkedAt).toLocaleString()}
          </p>
        ) : null}
      </section>

      {/* Claims */}
      <section
        id="claims"
        className="web-section"
        aria-labelledby="agents-claims-heading"
      >
        <h2 id="agents-claims-heading">Claims</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1rem',
            alignItems: 'start',
          }}
        >
          <ClaimsList onSelect={(claim) => setSelectedClaimId(claim.id)} />
          {selectedClaimId ? (
            <ClaimDetail claimId={selectedClaimId} />
          ) : (
            <p className="web-muted">
              Select a claim to see its status, adjuster, and evidence documents.
            </p>
          )}
        </div>
      </section>

      {/* Time saved */}
      <section
        id="agents"
        className="web-section"
        aria-labelledby="agents-hours-heading"
      >
        <h2 id="agents-hours-heading">Time saved by agent</h2>
        <AgentHoursPanel />
      </section>

      {/* Follow-ups */}
      <section
        id="followups"
        className="web-section"
        aria-labelledby="agents-followups-heading"
      >
        <h2 id="agents-followups-heading">Follow-up queue</h2>
        <FollowUpQueue />
      </section>

      {/* Front Desk booking */}
      <section
        id="inspections"
        className="web-section"
        aria-labelledby="agents-inspections-heading"
      >
        <h2 id="agents-inspections-heading">Front Desk — inspection booking</h2>
        <p className="web-muted web-small">
          Book and confirm inspections in the app. No phone call is placed — the
          voice layer needs a telephony provider connected first.
        </p>
        <InspectionBooking />
      </section>

      {/* Business search */}
      <section
        id="search"
        className="web-section"
        aria-labelledby="agents-search-heading"
      >
        <BusinessSearchPanel
          idPrefix="agents"
          title="Ask about your business"
          placeholder="e.g. How many jobs signed this month?"
        />
      </section>

      {/* Auto measuring lives in the Roof Workspace */}
      <section
        id="measuring"
        className="web-section"
        aria-labelledby="agents-measuring-heading"
      >
        <h2 id="agents-measuring-heading">Auto roof measuring</h2>
        <div className="web-card">
          <p>
            Detect a roof outline from satellite imagery and confirm the facets
            before any numbers are used. Auto-detected outlines are never
            survey-grade, and nothing is priced until you confirm it.
          </p>
          <p>
            <Link href="/roof">Open the Roof Workspace to auto-detect →</Link>
          </p>
        </div>
      </section>
    </>
  );
}
