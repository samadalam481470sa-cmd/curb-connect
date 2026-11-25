'use client';

import { TakeoffSheetContext } from '@fieldline/contracts';
import { Skeleton } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EnterpriseSuiteView } from './EnterpriseSuiteView';
import { TakeoffResourceError } from './TakeoffResourceError';

export function TakeoffSheetRoute({ planId, sheetId }: { planId: string; sheetId: string }) {
  const { api } = useApi();
  const session = useSession();
  const context = useQuery({
    queryKey: [...orgKey(session.orgId, 'enterprise'), 'takeoff-sheet-context', planId, sheetId],
    enabled: session.can('job:read'),
    retry: false,
    queryFn: () =>
      api.get('/v1/enterprise/takeoff/plan-sets/' + planId + '/sheets/' + sheetId + '/context', {
        schema: TakeoffSheetContext,
      }),
  });

  if (!context.isError && context.data && session.can('job:read')) {
    return (
      <EnterpriseSuiteView
        area="takeoff"
        fixedProjectId={context.data.projectId}
        initialTakeoffSheet={{ planId, sheetId }}
      />
    );
  }

  return (
    <div className="enterprise-suite">
      <nav aria-label="Takeoff breadcrumb">
        <Link href="/enterprise/takeoff">Digital Takeoff</Link>
      </nav>
      <section className="enterprise-panel" aria-label="Plan sheet">
        <h1>Plan sheet</h1>
        {!session.can('job:read') ? (
          <p role="alert">This plan sheet is unavailable.</p>
        ) : context.isError ? (
          <TakeoffResourceError
            error={context.error}
            unavailable="This plan sheet is unavailable."
            retry={() => void context.refetch()}
            retryLabel="Retry loading sheet"
          />
        ) : (
          <Skeleton label="Loading plan sheet" variant="card" />
        )}
      </section>
    </div>
  );
}
