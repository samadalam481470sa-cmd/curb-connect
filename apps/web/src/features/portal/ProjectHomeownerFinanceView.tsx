'use client';

import { HomeownerFinanceLinkView } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { formatMinorUnits } from '@fieldline/ui';
import { useSyncExternalStore } from 'react';
import { isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';
import { tokenFromHash } from '../jobs/customerStatus';

function subscribeToLink(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function ProjectHomeownerFinanceView({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const hash = useSyncExternalStore<string | null>(
    subscribeToLink,
    () => window.location.hash,
    () => null,
  );
  const token = hash === null ? undefined : tokenFromHash(hash);
  const view = useQuery({
    queryKey: ['portal', 'homeowner-finance', projectId, token],
    queryFn: () =>
      api.post(
        '/v1/portal/homeowner/projects/' + projectId + '/financials',
        { token },
        { schema: HomeownerFinanceLinkView },
      ),
    enabled: Boolean(token),
    retry: (tries, error) => tries < 2 && !(isApiError(error) && error.status < 500),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
  });
  const data = view.isSuccess && !view.isError ? view.data : undefined;
  const locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language;
  const money = (minor: string | number) =>
    formatMinorUnits(BigInt(minor), data?.disclosure.currency ?? 'USD', locale);

  return (
    <main id="fl-main" className="js-public" tabIndex={-1}>
      <div className="js-public__card">
        <h1>Shared project financials</h1>
        {token === undefined || (Boolean(token) && view.isPending) ? (
          <p role="status">Checking your finance link…</p>
        ) : !token || view.isError ? (
          <section role="alert">
            <p>This project finance link is unavailable.</p>
            {token && (!isApiError(view.error) || view.error.status >= 500) && (
              <button type="button" onClick={() => void view.refetch()}>
                Retry link
              </button>
            )}
          </section>
        ) : (
          data && (
            <>
              <h2>{data.projectName}</h2>
              <p>
                {data.companyName} shared these figures with {data.recipientName}.
              </p>
              <dl>
                <dt>Accepted contract total</dt>
                <dd>{money(data.disclosure.contractMinor)}</dd>
                {data.disclosure.approvedInternalCostMinor !== undefined && (
                  <>
                    <dt>Approved posted project cost</dt>
                    <dd>{money(data.disclosure.approvedInternalCostMinor)}</dd>
                  </>
                )}
                {data.disclosure.approvedMarginMinor !== undefined && (
                  <>
                    <dt>Approved forecast margin</dt>
                    <dd>{money(data.disclosure.approvedMarginMinor)}</dd>
                  </>
                )}
              </dl>
            </>
          )
        )}
      </div>
    </main>
  );
}
