'use client';

import { controlComplianceLabel, type ControlComplianceStatus } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { ControlCompliance } from './controlSchemas';

/** The four states an owner scans first; the other two explain gates that are neither. */
const STATUS_COLUMNS = [
  'satisfied',
  'expiring',
  'expired',
  'missing',
  'pending_review',
  'in_progress',
] as const satisfies readonly ControlComplianceStatus[];

export function BlueprintControlSuiteOverview({
  activeModuleKey,
  onDrillDown,
}: {
  activeModuleKey: string;
  onDrillDown: (moduleKey: string, status: ControlComplianceStatus | null) => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const suite = useQuery({
    queryKey: [...prefix, 'blueprint', 'controls', 'suite'],
    queryFn: () => api.get('/v1/enterprise/blueprint/controls', { schema: ControlCompliance }),
    staleTime: 15_000,
  });
  const data = suite.data;
  const proven = data ? data.counts.satisfied + data.counts.expiring : 0;

  return (
    <div className="blueprint-suite-overview">
      <div className="blueprint-compliance-head">
        <div>
          <span className="enterprise-kicker">SUITE COMPLIANCE</span>
          <h2>All control modules</h2>
          <p>
            Every module&apos;s 18 gates in one view. Select a module to review its gates, or a
            status count to open that module filtered to the gates that need attention.
          </p>
        </div>
        {data && (
          <p className="blueprint-suite-proven" role="status">
            <strong>{proven}</strong> of {data.counts.total} gates currently proven
          </p>
        )}
      </div>

      {suite.isPending && <p className="enterprise-muted">Loading suite compliance…</p>}
      {suite.error && (
        <p className="enterprise-error" role="alert">
          Suite compliance could not load: {errorHint(suite.error)}
        </p>
      )}

      {data && (
        <>
          <div
            className="enterprise-kpis blueprint-compliance-kpis"
            aria-label="Suite control gate summary"
          >
            {STATUS_COLUMNS.map((status) => (
              <div key={status}>
                <span>{controlComplianceLabel(status)}</span>
                <strong className={`blueprint-suite-count--${status}`}>
                  {data.counts[status]}
                </strong>
              </div>
            ))}
          </div>

          <div className="blueprint-suite-table-wrap">
            <table className="blueprint-suite-table" aria-label="Control gates by module">
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  {STATUS_COLUMNS.map((status) => (
                    <th key={status} scope="col">
                      {controlComplianceLabel(status)}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.modules.map((module) => (
                  <tr key={module.key} data-active={module.key === activeModuleKey}>
                    <th scope="row">
                      <button
                        type="button"
                        className="blueprint-suite-module"
                        onClick={() => onDrillDown(module.key, null)}
                      >
                        {module.title}
                      </button>
                    </th>
                    {STATUS_COLUMNS.map((status) => {
                      const count = module.counts[status];
                      const label = controlComplianceLabel(status);
                      return (
                        <td key={status} className={`blueprint-suite-count--${status}`}>
                          {count > 0 ? (
                            <button
                              type="button"
                              onClick={() => onDrillDown(module.key, status)}
                              aria-label={`${count} ${label} gates in ${module.title}`}
                            >
                              {count}
                            </button>
                          ) : (
                            <span
                              className="blueprint-suite-zero"
                              aria-label={`No ${label} gates in ${module.title}`}
                            >
                              0
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="blueprint-suite-total-cell">{module.counts.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="enterprise-muted">
            Counts cover all {data.modules.length} modules and {data.counts.total} gates. A gate is
            satisfied only by accepted, unexpired evidence; expiring means accepted proof or the
            requirement&apos;s refresh date falls within {data.warningDays} days.
          </p>
        </>
      )}
    </div>
  );
}
