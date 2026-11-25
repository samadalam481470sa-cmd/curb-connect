'use client';

// Storm Response panel: for one NOAA hail event, show the company's addresses in
// the hail path, the revenue estimate (labelled as an estimate — or an honest
// "insufficient data" state when the company has no priced roof estimates),
// draft texts for opted-in contacts only, and a send button that stays gated
// until an SMS provider is connected. Drafts are previews; nothing is sent
// until Send is pressed, and the server rebuilds the recipient list itself.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorHint } from '../../../lib/api';
import { useApi } from '../../../lib/session';
import {
  DraftResponseSchema,
  ImpactSchema,
  SendResponseSchema,
  SmsStatusSchema,
  usdFromMinor,
  type DraftResponse,
  type HailEvent,
  type SendResponse,
} from './api';

const RADIUS_OPTIONS = [10, 25, 50, 100];

export interface StormResponsePanelProps {
  /** The hail event to respond to, chosen on the Hailstorm Map. Null until one is picked. */
  event: HailEvent | null;
}

export function StormResponsePanel({ event }: StormResponsePanelProps) {
  const { api } = useApi();
  const [radiusMiles, setRadiusMiles] = useState(25);
  const [drafts, setDrafts] = useState<DraftResponse | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<SendResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const smsQuery = useQuery({
    queryKey: ['roof-storm-sms-status'],
    queryFn: () => api.get('/v1/roof-storms/sms/status', { schema: SmsStatusSchema }),
    staleTime: 60_000,
    retry: false,
  });

  const impactQuery = useQuery({
    queryKey: ['roof-storm-impact', event?.id, radiusMiles],
    queryFn: () =>
      api.get(
        `/v1/roof-storms/impact?eventId=${encodeURIComponent(event!.id)}&radiusMiles=${radiusMiles}`,
        { schema: ImpactSchema },
      ),
    enabled: event !== null,
    staleTime: 60_000,
    retry: false,
  });

  const loadDrafts = async () => {
    if (!event) return;
    setDraftBusy(true);
    setDraftError(null);
    setSendResult(null);
    try {
      const data = await api.post(
        '/v1/roof-storms/sms/draft',
        { eventId: event.id, radiusMiles },
        { schema: DraftResponseSchema },
      );
      setDrafts(data);
    } catch (err) {
      setDrafts(null);
      setDraftError(errorHint(err));
    } finally {
      setDraftBusy(false);
    }
  };

  const sendDrafts = async () => {
    if (!event || !drafts) return;
    setSendBusy(true);
    setSendError(null);
    setSendResult(null);
    try {
      const data = await api.post(
        '/v1/roof-storms/sms/send',
        { eventId: event.id, radiusMiles },
        { schema: SendResponseSchema },
      );
      setSendResult(data);
    } catch (err) {
      setSendError(errorHint(err));
    } finally {
      setSendBusy(false);
    }
  };

  if (!event) {
    return (
      <section className="web-card" aria-label="Storm response">
        <h2>Storm Response</h2>
        <p className="web-muted">Pick a hail event on the map to see who is in its path.</p>
      </section>
    );
  }

  // Drafts / send results belong to the event + radius they were made for.
  const currentDrafts =
    drafts && drafts.event.id === event.id && drafts.radiusMiles === radiusMiles ? drafts : null;
  const currentSend =
    sendResult && sendResult.event.id === event.id ? sendResult : null;
  const impact = impactQuery.data ?? null;
  const impactBusy = impactQuery.isPending;
  const impactError = impactQuery.error ? errorHint(impactQuery.error) : null;
  const smsStatus = smsQuery.data ?? null;
  const smsConfigured = smsStatus?.configured === true;
  const sourceLabel = (source: string) =>
    source === 'roof_job' ? 'Roof job' : source === 'crm_lead' ? 'CRM lead' : 'Property';

  return (
    <section className="web-card" aria-label="Storm response">
      <h2>Storm Response</h2>
      <p>
        {event.magnitudeIn.toFixed(2)}&quot; hail · {event.location}, {event.state} · {event.date}{' '}
        {event.timeUtc} UTC
      </p>
      <p className="web-muted web-small">Source: {event.source}. {event.comments}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fl-space-3)', alignItems: 'center', marginBottom: 'var(--fl-space-3)' }}>
        <label htmlFor="storm-radius">Hail path radius</label>
        <select
          id="storm-radius"
          className="cc-input"
          value={radiusMiles}
          onChange={(e) => setRadiusMiles(Number(e.currentTarget.value))}
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r} miles
            </option>
          ))}
        </select>
        <button type="button" className="cc-btn cc-btn--sm" onClick={() => void impactQuery.refetch()} disabled={impactBusy}>
          {impactBusy ? 'Checking…' : 'Check impact'}
        </button>
      </div>

      {impactError && (
        <p role="alert" className="web-small">
          Could not check impact: {impactError}
        </p>
      )}
      {impact && (
        <>
          <h3>Matched addresses (estimate)</h3>
          <p className="web-muted web-small" role="status">
            {impact.matchedCount} address(es) with a pin inside {impact.radiusMiles} miles of the hail report.
            {impact.propertiesWithoutLocation > 0 &&
              ` ${impact.propertiesWithoutLocation} company propert(ies) have no location on file and could not be matched.`}
          </p>
          <ul aria-label="Matched addresses">
            {impact.matched.map((m) => (
              <li key={m.propertyId}>
                {m.address}
                {m.city ? `, ${m.city}` : ''}
                {m.state ? ` ${m.state}` : ''} · {m.distanceMiles} mi · {sourceLabel(m.source)}
                {m.contact ? ` · ${m.contact.name}${m.contact.smsOptedIn ? ' (SMS opted in)' : ' (no SMS consent)'}` : ' · no contact on file'}
              </li>
            ))}
            {impact.matched.length === 0 && <li role="status">No company addresses in this hail path.</li>}
          </ul>

          <h3>Potential revenue (estimate)</h3>
          {impact.revenueEstimateMinor === null ? (
            <p className="web-muted" role="status">
              Insufficient data: the company has no priced roof estimates yet, so no revenue estimate can be calculated.
            </p>
          ) : (
            <>
              <p aria-label="Estimated potential revenue">
                <strong>{usdFromMinor(impact.revenueEstimateMinor)}</strong> (estimate)
              </p>
              <p className="web-muted web-small">{impact.revenueNote}</p>
            </>
          )}

          <h3>Storm texts</h3>
          {smsStatus && (
            <p className="web-muted web-small" role="status">
              SMS: {smsStatus.configured ? 'connected (Twilio).' : `not connected — ${smsStatus.message}`}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--fl-space-3)', alignItems: 'center' }}>
            <button
              type="button"
              className="cc-btn cc-btn--sm"
              onClick={() => void loadDrafts()}
              disabled={draftBusy || impact.matchedCount === 0}
            >
              {draftBusy ? 'Drafting…' : 'Draft texts'}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn--sm cc-btn--primary"
              onClick={() => void sendDrafts()}
              disabled={!smsConfigured || !currentDrafts || currentDrafts.drafts.length === 0 || sendBusy}
              aria-describedby="storm-send-gate"
            >
              {sendBusy ? 'Sending…' : `Send ${currentDrafts?.drafts.length ?? 0} text(s)`}
            </button>
          </div>
          <p id="storm-send-gate" className="web-muted web-small">
            {!smsConfigured
              ? 'Sending is off until an SMS provider is connected (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER on the API service). Drafts still work.'
              : 'Only contacts with granted SMS consent receive a text. The server rebuilds the recipient list — no cold leads are ever texted.'}
          </p>
          {draftError && (
            <p role="alert" className="web-small">
              Could not draft texts: {draftError}
            </p>
          )}
          {currentDrafts && (
            <>
              <p className="web-muted web-small" role="status">
                {currentDrafts.drafts.length} draft(s). Excluded: {currentDrafts.excluded.noPhone} without a phone number,{' '}
                {currentDrafts.excluded.noSmsConsent} without SMS consent. {currentDrafts.note}
              </p>
              <ul aria-label="Draft texts">
                {currentDrafts.drafts.map((d) => (
                  <li key={d.contactId}>
                    <strong>{d.name}</strong> · {d.address}
                    <p className="web-muted web-small">{d.body}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sendError && (
            <p role="alert" className="web-small">
              Could not send: {sendError}
            </p>
          )}
          {currentSend && (
            <p role="status">
              Sent {currentSend.sent} text(s)
              {currentSend.failed > 0 ? `, ${currentSend.failed} failed.` : '.'}
              {currentSend.results
                .filter((r) => !r.ok)
                .map((r) => ` ${r.name}: ${r.error ?? 'send failed.'}`)
                .join('')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
