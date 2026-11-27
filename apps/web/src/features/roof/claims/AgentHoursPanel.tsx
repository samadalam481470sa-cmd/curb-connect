// Agent hours saved: per-agent totals computed from logged action durations.
// Hours are an estimate — counted only where a duration was recorded (your
// saved time baselines applied to completed actions, or a duration recorded
// directly) — and agents with no measured time show "Not measured yet",
// never 0 presented as measured. The baselines editor below is where the
// contractor sets their minutes per task type; unset types show the labeled
// starting estimate and count toward nothing until saved.
// Not wired into any page or nav yet.
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../../components/common';
import { orgKey, useApi, useSession } from '../../../lib/session';
import {
  agentHoursLabel,
  AgentActivityTotalsSchema,
  baselineSourceLabel,
  TimeBaselinesResponseSchema,
  TimeBaselineSchema,
  type TimeBaseline,
} from './claims';

function BaselineRow({ baseline }: { baseline: TimeBaseline }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(baseline.minutes);
  const dirty = draft !== null && draft !== String(baseline.minutes);
  const save = useMutation({
    mutationFn: (minutes: number) =>
      api.put(
        `/v1/roof-agents/time-baselines/${encodeURIComponent(baseline.taskType)}`,
        { minutes },
        { schema: TimeBaselineSchema },
      ),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'roof-agents', 'time-baselines') });
    },
  });
  const minutes = Number(value);
  const valid = Number.isInteger(minutes) && minutes >= 0 && minutes <= 60 * 24;
  return (
    <tr>
      <td>{baseline.label}</td>
      <td>
        <input
          className="cc-input"
          type="number"
          min={0}
          max={60 * 24}
          step={1}
          aria-label={`Minutes saved for ${baseline.label}`}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
        />{' '}
        min
      </td>
      <td>{baselineSourceLabel(baseline)}</td>
      <td>
        <button
          type="button"
          className="cc-btn"
          disabled={!dirty || !valid || save.isPending}
          onClick={() => save.mutate(minutes)}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {save.isError ? <ErrorNotice error={save.error} /> : null}
      </td>
    </tr>
  );
}

function TimeBaselinesSection() {
  const { api } = useApi();
  const { orgId } = useSession();
  const queryClient = useQueryClient();
  const baselines = useQuery({
    queryKey: orgKey(orgId, 'roof-agents', 'time-baselines'),
    queryFn: () => api.get('/v1/roof-agents/time-baselines', { schema: TimeBaselinesResponseSchema }),
    staleTime: 60_000,
  });
  const applyTemplate = useMutation({
    mutationFn: () =>
      api.post('/v1/roof-agents/time-baselines/apply-template', {}, { schema: TimeBaselinesResponseSchema }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'roof-agents', 'time-baselines') }),
  });

  if (baselines.isError) {
    return (
      <ErrorNotice
        error={baselines.error}
        title="Time baselines could not be loaded"
        onRetry={() => void baselines.refetch()}
      />
    );
  }
  const anyTemplate = (baselines.data?.baselines ?? []).some((b) => b.source === 'template');
  return (
    <>
      <h3 style={{ marginTop: 'var(--fl-space-3)', marginBottom: 'var(--fl-space-2)' }}>
        Time baselines — minutes saved per task
      </h3>
      <p style={{ marginBottom: 'var(--fl-space-3)' }}>
        When an agent action completes, Field Pro logs your minutes for that task type automatically.
        Rows marked “Starting estimate” are placeholders — edit them to your numbers. Nothing is
        counted until you save your own numbers.
      </p>
      {baselines.isPending ? (
        <p>Loading time baselines…</p>
      ) : (
        <>
          <table className="cc-table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Minutes saved</th>
                <th scope="col">Source</th>
                <th scope="col">Save</th>
              </tr>
            </thead>
            <tbody>
              {(baselines.data?.baselines ?? []).map((b) => (
                <BaselineRow key={b.taskType} baseline={b} />
              ))}
            </tbody>
          </table>
          {anyTemplate ? (
            <p style={{ marginTop: 'var(--fl-space-2)' }}>
              <button
                type="button"
                className="cc-btn"
                disabled={applyTemplate.isPending}
                onClick={() => applyTemplate.mutate()}
              >
                {applyTemplate.isPending ? 'Applying…' : 'Use starting estimates as my baselines'}
              </button>{' '}
              <span className="web-muted web-small">
                Fills in only the task types you have not set yet — your saved numbers are kept.
              </span>
            </p>
          ) : null}
          {applyTemplate.isError ? <ErrorNotice error={applyTemplate.error} /> : null}
        </>
      )}
    </>
  );
}

export function AgentHoursPanel() {
  const { api } = useApi();
  const { orgId } = useSession();

  const activity = useQuery({
    queryKey: orgKey(orgId, 'roof-agents', 'activity'),
    queryFn: () => api.get('/v1/roof-agents/activity', { schema: AgentActivityTotalsSchema }),
    staleTime: 60_000,
  });

  if (activity.isError) {
    return (
      <ErrorNotice
        error={activity.error}
        title="Agent hours could not be loaded"
        onRetry={() => void activity.refetch()}
      />
    );
  }

  return (
    <section aria-labelledby="agent-hours-title" className="cc-panel">
      <div className="cc-panel__body">
        <h2 id="agent-hours-title" style={{ marginBottom: 'var(--fl-space-2)' }}>
          Agent hours saved
        </h2>
        <p style={{ marginBottom: 'var(--fl-space-3)' }}>
          Estimate — hours are computed from recorded durations: your saved time baselines below,
          applied automatically when an agent action completes.
        </p>
        {activity.isPending ? (
          <p>Loading agent hours…</p>
        ) : (
          <>
            <p style={{ marginBottom: 'var(--fl-space-3)' }}>
              <strong>Total: </strong>
              {activity.data.measured && activity.data.totalHoursSaved !== null
                ? `${activity.data.totalHoursSaved} hrs (estimate)`
                : 'Not measured yet'}
            </p>
            <table className="cc-table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Actions logged</th>
                  <th scope="col">Actions with time measured</th>
                  <th scope="col">Hours saved</th>
                </tr>
              </thead>
              <tbody>
                {activity.data.agents.map((agent) => (
                  <tr key={agent.agent}>
                    <td>{agent.label}</td>
                    <td>{agent.actions}</td>
                    <td>{agent.measuredActions}</td>
                    <td>{agentHoursLabel(agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ marginTop: 'var(--fl-space-2)' }}>{activity.data.note}</p>
          </>
        )}
        <TimeBaselinesSection />
      </div>
    </section>
  );
}
