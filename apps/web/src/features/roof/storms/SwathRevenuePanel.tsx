'use client';

// Potential-revenue hero for the storms section: for the selected hail event,
// the revenue estimate from the existing /v1/roof-storms/impact endpoint —
// matched stored roofs × the contractor's own average job value, radius 25
// miles, the same query StormResponsePanel uses. The number is always labelled
// an estimate; when the company has no priced roof estimates the endpoint
// returns null and this shows an honest "Insufficient data" state — never $0.
import { useQuery } from '@tanstack/react-query';
import { errorHint } from '../../../lib/api';
import { useApi } from '../../../lib/session';
import { ImpactSchema, usdFromMinor, type HailEvent } from './api';

const RADIUS_MILES = 25;

export interface SwathRevenuePanelProps {
  /** The hail event to price, chosen on the Hailstorm Map. Null until one is picked. */
  event: HailEvent | null;
}

export function SwathRevenuePanel({ event }: SwathRevenuePanelProps) {
  const { api } = useApi();

  const impactQuery = useQuery({
    queryKey: ['roof-storm-impact', event?.id, RADIUS_MILES],
    queryFn: () =>
      api.get(
        `/v1/roof-storms/impact?eventId=${encodeURIComponent(event!.id)}&radiusMiles=${RADIUS_MILES}`,
        { schema: ImpactSchema },
      ),
    enabled: event !== null,
    staleTime: 60_000,
    retry: false,
  });

  if (!event) {
    return (
      <section className="web-card" aria-label="Potential revenue">
        <h2>Potential revenue (estimate)</h2>
        <p className="web-muted">
          Pick a hail event on the map to see potential revenue.
        </p>
      </section>
    );
  }

  const impact = impactQuery.data ?? null;
  const impactError = impactQuery.error ? errorHint(impactQuery.error) : null;

  return (
    <section className="web-card" aria-label="Potential revenue">
      <h2>Potential revenue (estimate)</h2>
      <p className="web-muted web-small">
        {event.magnitudeIn.toFixed(2)}&quot; hail · {event.location}, {event.state} ·{' '}
        {event.date} {event.timeUtc} UTC · matched roofs within {RADIUS_MILES} miles
      </p>
      {impactQuery.isPending && (
        <p className="web-muted" aria-live="polite">
          Checking…
        </p>
      )}
      {impactError && (
        <p role="alert" className="web-small">
          Could not check revenue: {impactError}
        </p>
      )}
      {impact && impact.revenueEstimateMinor === null && (
        <>
          <p role="status" style={{ fontSize: '1.5rem', margin: '0.5rem 0' }}>
            <strong>Insufficient data</strong>
          </p>
          <p className="web-muted">{impact.revenueNote}</p>
        </>
      )}
      {impact && impact.revenueEstimateMinor !== null && (
        <>
          <p
            aria-label="Estimated potential revenue"
            style={{ fontSize: '2.25rem', lineHeight: 1.1, margin: '0.5rem 0' }}
          >
            <strong>{usdFromMinor(impact.revenueEstimateMinor)}</strong>{' '}
            <span className="web-muted web-small">(estimate)</span>
          </p>
          <p className="web-muted" role="status">
            {impact.matchedCount} matched roof{impact.matchedCount === 1 ? '' : 's'}
            {impact.averageJobValueMinor !== null &&
              ` · average job value ${usdFromMinor(impact.averageJobValueMinor)}`}
          </p>
          <p className="web-muted web-small">{impact.revenueNote}</p>
        </>
      )}
    </section>
  );
}
