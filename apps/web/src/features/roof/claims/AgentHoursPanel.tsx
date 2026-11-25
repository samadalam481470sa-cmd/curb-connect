// Agent hours saved: per-agent totals computed from logged action durations only.
// Hours are an estimate — counted only where a duration was actually recorded — and
// agents with no measured time show "Not measured yet", never 0 presented as measured.
// Not wired into any page or nav yet.
'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../../components/common';
import { orgKey, useApi, useSession } from '../../../lib/session';
import { agentHoursLabel, AgentActivityTotalsSchema } from './claims';

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
          Estimate — hours are computed only from actions where a duration was actually recorded.
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
      </div>
    </section>
  );
}
