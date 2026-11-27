'use client';

import { EnterpriseBudgetSummary } from '@fieldline/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EnterpriseCostForecasts } from './EnterpriseCostForecasts';
import { FinanceProjectActivity } from './FinanceProjectActivity';

export function EnterpriseFinanceScenarios({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const { orgId, me } = useSession();
  const client = useQueryClient();
  const key = orgKey(orgId, 'enterprise', 'project-budget', projectId);
  const budget = useQuery({
    queryKey: [...key, '', ''],
    enabled: Boolean(projectId),
    queryFn: () =>
      api.get('/v1/enterprise/projects/' + projectId + '/budget', {
        schema: EnterpriseBudgetSummary,
      }),
    refetchOnMount: 'always',
  });
  const unavailable = isApiError(budget.error) && [401, 403, 404].includes(budget.error.status);
  const waitingForScope = budget.isFetching && !budget.isFetchedAfterMount;
  const summary = budget.isError || waitingForScope ? undefined : budget.data;
  const company = me.memberships.find((membership) => membership.orgId === orgId)?.orgDisplayName;

  function refresh() {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({
      queryKey: orgKey(orgId, 'enterprise', 'finance-activity', projectId),
    });
  }

  return (
    <main className="enterprise-suite enterprise-finance-layout enterprise-financials-view enterprise-finance-scenarios">
      <header className="enterprise-hero">
        <nav aria-label="Scenario breadcrumb">
          <Link href="/enterprise/costing" className="enterprise-back">
            ← Job Costing
          </Link>
          {summary && (
            <Link href={'/enterprise/projects/' + projectId + '/budget'}>Project budget</Link>
          )}
        </nav>
        <h1>Cost scenarios</h1>
        {summary && <p>{[company, summary.projectName].filter(Boolean).join(' · ')}</p>}
      </header>
      {!projectId && (
        <section className="enterprise-panel enterprise-finance-workspace-status">
          <p>Choose a project budget to open its forecasts and scenarios.</p>
          <Link href="/enterprise/costing">Open Job Costing</Link>
        </section>
      )}
      {projectId && (budget.isPending || waitingForScope) && (
        <div className="enterprise-finance-workspace-status">
          <Skeleton variant="card" label="Loading project finance" />
        </div>
      )}
      {projectId && budget.isError && (
        <section className="enterprise-panel" role="alert">
          <p>{unavailable ? 'This scenario workspace is unavailable.' : errorHint(budget.error)}</p>
          {!unavailable && (
            <>
              {isApiError(budget.error) && <p>Support reference {budget.error.correlationId}</p>}
              <button type="button" onClick={() => void budget.refetch()}>
                Retry project finance
              </button>
            </>
          )}
        </section>
      )}
      {summary && (
        <>
          <nav className="enterprise-finance-primary-actions" aria-label="Scenario actions">
            <a href="#cost-forecasts">Forecasts and scenarios</a>
            <Link href={'/enterprise/projects/' + projectId + '/budget#budget-baseline'}>
              Approved budget
            </Link>
          </nav>
          <EnterpriseCostForecasts
            projectId={projectId}
            summary={summary}
            historical={false}
            onUpdated={refresh}
          />
          <FinanceProjectActivity projectId={projectId} />
        </>
      )}
    </main>
  );
}
