'use client';

import { EnterpriseFinanceProjectActivity } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { Drawer, formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const labels = {
  baseline_approved: 'Budget baseline approved',
  revision_requested: 'Budget revision requested',
  revision_approved: 'Budget revision approved',
  revision_rejected: 'Budget revision rejected',
  purchase_committed: 'Purchase commitment recorded',
  variance_requested: 'Purchase overrun submitted',
  variance_decided: 'Owner overrun decision recorded',
  bill_posted: 'Approved bill posted',
  forecast_saved: 'Cost forecast saved',
  scenario_saved: 'Cost scenario saved',
};

export function FinanceProjectActivity({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const { orgId, me } = useSession();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: orgKey(orgId, 'enterprise', 'finance-activity', projectId),
    queryFn: () =>
      api.get('/v1/enterprise/finance/projects/' + projectId + '/activity', {
        schema: EnterpriseFinanceProjectActivity,
      }),
    refetchOnMount: 'always',
  });
  const denied = isApiError(query.error) && [401, 403, 404].includes(query.error.status);
  const source = query.isError || query.isFetching ? undefined : query.data;
  const financials = '/enterprise/projects/' + projectId + '/financials';
  const overrun = (orderId: string) =>
    '/enterprise/projects/' + projectId + '/purchase-orders/' + orderId + '/variance';

  const body = (
    <>
      {query.isFetching && <Skeleton variant="card" label="Loading finance activity" />}
      {query.isError && (
        <div role="alert">
          <p>
            {denied ? 'This project’s finance activity is unavailable.' : errorHint(query.error)}
          </p>
          {!denied && (
            <>
              {isApiError(query.error) && <p>Support reference {query.error.correlationId}</p>}
              <button type="button" onClick={() => void query.refetch()}>
                Retry finance activity
              </button>
            </>
          )}
        </div>
      )}
      {source && (
        <>
          <section aria-label="Finance exceptions">
            <h3>Exceptions</h3>
            {source.currentVariances.length === 0 && <p>No active purchase overruns.</p>}
            <ul className="enterprise-change-history">
              {source.currentVariances.map((variance) => (
                <li key={variance.id}>
                  <strong>
                    {formatMinorUnits(BigInt(variance.overrunMinor), 'USD', me.user.locale)}{' '}
                    purchase overrun
                  </strong>
                  <span>Allocation version {variance.budgetVersion}</span>
                  <Link href={overrun(variance.orderId)}>
                    {variance.canDecide ? 'Review owner decision' : 'Open overrun'}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Recent finance activity">
            <h3>Recent activity</h3>
            {source.activity.length === 0 && (
              <p>This project has no recorded finance activity yet.</p>
            )}
            <ol className="enterprise-change-history">
              {source.activity.map((record) => {
                let href = financials + '#budget-baseline';
                if (record.orderId && record.kind.startsWith('variance_'))
                  href = overrun(record.orderId);
                else if (record.kind === 'purchase_committed')
                  href = financials + '#purchase-commitments';
                else if (record.kind === 'bill_posted') href = financials + '#actual-costs';
                else if (record.kind === 'forecast_saved') href = financials + '#cost-forecasts';
                else if (record.kind === 'scenario_saved')
                  href = '/enterprise/finance/scenarios?projectId=' + projectId;
                return (
                  <li key={record.kind + record.recordId}>
                    <Link href={href}>{labels[record.kind]}</Link>
                    <time dateTime={record.recordedAt}>
                      {new Date(record.recordedAt).toLocaleString()}
                    </time>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      )}
    </>
  );

  return (
    <>
      <aside
        className="enterprise-panel enterprise-finance-activity"
        aria-label="Activity and exceptions"
      >
        <h2>Activity and exceptions</h2>
        {body}
      </aside>
      <button
        className="enterprise-finance-activity-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Activity and exceptions
      </button>
      <Drawer title="Activity and exceptions" open={open} onClose={() => setOpen(false)}>
        <div className="enterprise-suite enterprise-finance-activity-drawer">{body}</div>
      </Drawer>
    </>
  );
}
