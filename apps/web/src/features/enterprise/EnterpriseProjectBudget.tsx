'use client';

import { EnterpriseBudgetSummary } from '@fieldline/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { type BudgetFormMode, EnterpriseBudgetForm } from './EnterpriseBudgetForms';
import { EnterpriseBudgetRevisions } from './EnterpriseBudgetRevisions';
import { EnterpriseActualBillCosts } from './EnterpriseActualBillCosts';
import { EnterpriseCostForecasts } from './EnterpriseCostForecasts';
import { EnterprisePendingBidCosts } from './EnterprisePendingBidCosts';
import { EnterprisePurchasingSummary } from './EnterprisePurchasing';
import { FinanceProjectActivity } from './FinanceProjectActivity';
import { ProjectBudgetGrants } from './JobsiteMediaGrants';

const notices: Record<BudgetFormMode, string> = {
  create: 'Draft baseline created.',
  costCode: 'Project cost code saved.',
  line: 'Budget line saved.',
  approve: 'Budget baseline approved.',
};

export function EnterpriseProjectBudget({
  projectId,
  financials = false,
}: {
  projectId: string;
  financials?: boolean;
}) {
  const { api } = useApi();
  const session = useSession();
  const path = '/v1/enterprise/projects/' + projectId + '/budget';
  const client = useQueryClient();
  const queryKey = orgKey(session.orgId, 'enterprise', 'project-budget', projectId);
  const [asOf, setAsOf] = useState('');
  const [costCodeId, setCostCodeId] = useState('');
  const [editing, setEditing] = useState<BudgetFormMode | null>(null);
  const [notice, setNotice] = useState('');
  const [showPurchaseSources, setShowPurchaseSources] = useState(false);
  const summary = useQuery({
    queryKey: [...queryKey, asOf, costCodeId],
    queryFn: () =>
      api.get(path, {
        schema: EnterpriseBudgetSummary,
        query: { asOf: asOf || null, costCodeId: costCodeId || null },
      }),
    refetchOnMount: 'always',
  });
  const denied = isApiError(summary.error) && [401, 403, 404].includes(summary.error.status);
  const waitingForScope = financials && summary.isFetching && !summary.isFetchedAfterMount;
  const data = denied || waitingForScope ? undefined : summary.data;
  const baseline = data?.baseline;
  const company = session.me.memberships.find(
    (item) => item.orgId === session.orgId,
  )?.orgDisplayName;

  function refresh() {
    void client.invalidateQueries({ queryKey });
    void client.invalidateQueries({
      queryKey: orgKey(session.orgId, 'enterprise', 'finance-activity', projectId),
    });
    void client.invalidateQueries({
      queryKey: orgKey(session.orgId, 'enterprise', 'finance-projects'),
    });
  }

  function open(mode: BudgetFormMode) {
    setNotice('');
    setEditing(mode);
  }

  return (
    <main
      className={
        financials
          ? 'enterprise-suite enterprise-finance-layout enterprise-financials-view'
          : 'enterprise-suite'
      }
    >
      <div className="enterprise-hero">
        <nav aria-label={financials ? 'Finance breadcrumb' : 'Budget breadcrumb'}>
          <Link
            href={
              financials
                ? '/enterprise/finance/projects?projectId=' + projectId
                : '/enterprise/costing'
            }
            className="enterprise-back"
          >
            {financials ? '← Finance projects' : '← Costing'}
          </Link>
        </nav>
        <h1>{financials ? 'Project financials' : 'Project budget'}</h1>
        {data && (
          <p>
            {financials && company ? company + ' · ' : ''}
            {data.projectName}
          </p>
        )}
      </div>
      {(summary.isPending || waitingForScope) && (
        <Skeleton variant="card" label="Loading project budget" />
      )}
      {summary.isError && (
        <section className="enterprise-panel" role="alert">
          <p>
            {denied
              ? financials
                ? 'This project’s financials are unavailable.'
                : 'This project budget is unavailable.'
              : errorHint(summary.error)}
          </p>
          {!denied && isApiError(summary.error) && (
            <p>Support reference {summary.error.correlationId}</p>
          )}
          {!denied && (
            <button type="button" onClick={() => void summary.refetch()}>
              Retry budget
            </button>
          )}
        </section>
      )}
      {data && financials && (
        <nav className="enterprise-finance-primary-actions" aria-label="Financials actions">
          <a href="#budget-baseline">Budget</a>
          <a href="#purchase-commitments">Commitments</a>
          <a href="#actual-costs">Actual costs</a>
          <a href="#cost-forecasts">Forecasts</a>
          <Link href={'/enterprise/finance/compliance?projectId=' + projectId}>Compliance</Link>
        </nav>
      )}
      {data && (
        <div className="enterprise-stack">
          <section className="enterprise-panel" aria-label="Budget filters">
            <div className="enterprise-form">
              <label>
                As of
                <input
                  type="date"
                  value={asOf || data.asOf}
                  disabled={editing !== null}
                  onChange={(event) => {
                    setEditing(null);
                    setAsOf(event.target.value);
                  }}
                />
              </label>
              <label>
                Filter cost code
                <select
                  value={costCodeId}
                  disabled={editing !== null}
                  onChange={(event) => setCostCodeId(event.target.value)}
                >
                  <option value="">All cost codes</option>
                  {data.availableCostCodes.map((code) => (
                    <option key={code.id} value={code.id}>
                      {code.code} · {code.label}
                    </option>
                  ))}
                </select>
              </label>
              {asOf && (
                <button type="button" disabled={editing !== null} onClick={() => setAsOf('')}>
                  Show current budget
                </button>
              )}
            </div>
            <p>
              Refreshed <time dateTime={data.readAt}>{new Date(data.readAt).toLocaleString()}</time>
            </p>
          </section>
          <section className="enterprise-panel" id="budget-baseline" aria-label="Budget baseline">
            <h2>Budget baseline</h2>
            {notice && <p role="status">{notice}</p>}
            {!baseline ? (
              <p>
                {data.canCreate
                  ? 'This project has no budget baseline.'
                  : 'There is no baseline for this date.'}
              </p>
            ) : (
              <>
                <p>
                  {baseline.status === 'approved' ? 'Approved' : 'Draft'} · Revision{' '}
                  {baseline.revision}
                </p>
                <p>Effective {baseline.effectiveOn}</p>
                <strong>
                  {formatMinorUnits(
                    BigInt(baseline.amountMinor),
                    baseline.currency,
                    session.me.user.locale,
                  )}
                </strong>
                {baseline.approvalReason && <p>{baseline.approvalReason}</p>}
                {baseline.lines.length > 0 && (
                  <p>
                    <a href="#budget-lines">View budget source lines</a>
                  </p>
                )}
              </>
            )}
            {!editing && (
              <div className="enterprise-media-toolbar" aria-label="Budget actions">
                {data.canCreate && (
                  <button type="button" onClick={() => open('create')}>
                    Create baseline
                  </button>
                )}
                {data.canManageGrants && (
                  <button type="button" onClick={() => open('costCode')}>
                    Add project cost code
                  </button>
                )}
                {data.canEditDraft && data.availableCostCodes.length > 0 && (
                  <button type="button" onClick={() => open('line')}>
                    Add budget line
                  </button>
                )}
                {data.canApprove && (
                  <button type="button" onClick={() => open('approve')}>
                    Review baseline approval
                  </button>
                )}
              </div>
            )}
            {data.canEditDraft && !data.availableCostCodes.length && (
              <p>Add a project cost code to enter budget lines.</p>
            )}
            {editing && (
              <EnterpriseBudgetForm
                key={editing}
                mode={editing}
                path={path}
                summary={data}
                onCancel={() => setEditing(null)}
                onComplete={() => {
                  setNotice(notices[editing]);
                  setEditing(null);
                  refresh();
                }}
                onStale={refresh}
              />
            )}
          </section>
          {baseline && data.allocation && (
            <EnterpriseBudgetRevisions
              key={baseline.id}
              path={path}
              baseline={baseline}
              allocation={data.allocation}
              costCodes={data.availableCostCodes}
              costCodeId={costCodeId}
              historical={!!asOf}
              onRefresh={refresh}
            />
          )}
          <section
            className="enterprise-panel"
            id="purchase-commitments"
            aria-label="Approved purchase commitments"
          >
            <h2>Purchase commitments</h2>
            <dl>
              <dt>Approved purchase total</dt>
              <dd>
                {formatMinorUnits(
                  BigInt(data.purchaseCommitments.totalMinor),
                  data.purchaseCommitments.currency,
                  session.me.user.locale,
                )}
              </dd>
            </dl>
            <ul className="enterprise-change-history">
              {data.purchaseCommitments.rows
                .filter((row) => !costCodeId || row.costCodeId === costCodeId)
                .map((row) => (
                  <li key={row.costCodeId}>
                    <strong>
                      {row.costCode} ·{' '}
                      {data.availableCostCodes.find((code) => code.id === row.costCodeId)?.label}
                    </strong>
                    <span>
                      {formatMinorUnits(
                        BigInt(row.amountMinor),
                        data.purchaseCommitments.currency,
                        session.me.user.locale,
                      )}
                    </span>
                  </li>
                ))}
            </ul>
            {!asOf &&
              session.can('supplier_order:read') &&
              data.purchaseCommitments.rows.length > 0 && (
                <>
                  <button
                    type="button"
                    aria-expanded={showPurchaseSources}
                    onClick={() => setShowPurchaseSources((previous) => !previous)}
                  >
                    {showPurchaseSources
                      ? 'Hide purchase order sources'
                      : 'View source purchase orders'}
                  </button>
                  {showPurchaseSources && <EnterprisePurchasingSummary projectId={projectId} />}
                </>
              )}
          </section>
          {!asOf && <EnterprisePendingBidCosts projectId={projectId} />}
          <EnterpriseActualBillCosts
            projectId={projectId}
            summary={data}
            costCodeId={costCodeId}
            historical={!!asOf}
            onUpdated={refresh}
          />
          {data.allocation && !asOf && (
            <Link href={'/enterprise/finance/scenarios?projectId=' + encodeURIComponent(projectId)}>
              Open Scenarios workspace
            </Link>
          )}
          {!asOf && session.can('bill:approve') && (
            <Link href={'/enterprise/finance/wip?projectId=' + encodeURIComponent(projectId)}>
              Open WIP reports
            </Link>
          )}
          <EnterpriseCostForecasts
            projectId={projectId}
            summary={data}
            historical={!!asOf}
            onUpdated={refresh}
          />
          {data.canManageGrants && <ProjectBudgetGrants path={path} projectId={projectId} />}
          {baseline && (
            <section
              className="enterprise-panel"
              id="budget-lines"
              aria-label="Budget source lines"
            >
              <h2>Budget source lines</h2>
              {baseline.lines.length ? (
                <ul className="enterprise-change-history">
                  {baseline.lines.map((line) => (
                    <li key={line.id}>
                      <strong>{line.description}</strong>
                      <span>
                        {line.costCode.code} · {line.costCode.label}
                      </span>
                      <span>
                        {formatMinorUnits(
                          BigInt(line.amountMinor),
                          line.currency,
                          session.me.user.locale,
                        )}
                      </span>
                      <details>
                        <summary>Source details</summary>
                        <dl>
                          <dt>Project phase</dt>
                          <dd>{line.phase}</dd>
                          <dt>Funding source</dt>
                          <dd>{line.fundingSource}</dd>
                          <dt>Unit</dt>
                          <dd>{line.unit.replaceAll('_', ' ')}</dd>
                          <dt>Recorded</dt>
                          <dd>
                            <time dateTime={line.createdAt}>
                              {new Date(line.createdAt).toLocaleString()}
                            </time>
                          </dd>
                          <dt>Line reference</dt>
                          <dd>{line.id}</dd>
                        </dl>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {costCodeId
                    ? 'No budget lines match this cost code.'
                    : 'No budget lines have been recorded.'}
                </p>
              )}
            </section>
          )}
        </div>
      )}
      {data && financials && <FinanceProjectActivity projectId={projectId} />}
    </main>
  );
}
