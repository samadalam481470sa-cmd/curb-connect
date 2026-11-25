'use client';

import { EnterpriseEstimateComparison, type EnterpriseEstimateLine } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { z } from 'zod';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';
import { estimatePrice, estimateUnitLabel } from './estimateDisplay';

const changeLabels = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

export function EstimateRevisionComparison({
  path,
  selectionKey,
}: {
  path: string;
  selectionKey: readonly unknown[];
}) {
  const { api } = useApi();
  const [open, setOpen] = useState(false);
  const comparison = useQuery({
    queryKey: [...selectionKey, 'comparison', path],
    queryFn: () => api.get(path + '/comparison', { schema: EnterpriseEstimateComparison }),
    enabled: open,
  });
  const data = comparison.data;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Compare with source revision</summary>
      {open && comparison.isPending && <p role="status">Loading revision comparison…</p>}
      {open && comparison.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {errorHint(comparison.error)}
          </p>
          <button type="button" onClick={() => void comparison.refetch()}>
            Retry loading comparison
          </button>
        </div>
      )}
      {open && data && (
        <section aria-label="Revision comparison" className="enterprise-scroll">
          {data.rows.length === 0 ? (
            <p>These revisions have no estimate lines.</p>
          ) : (
            <table>
              <caption>Estimate line changes</caption>
              <thead>
                <tr>
                  <th scope="col">Change</th>
                  <th scope="col">Revision {data.source.revisionNumber}</th>
                  <th scope="col">Revision {data.target.revisionNumber}</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.lineageId}>
                    <td>{changeLabels[row.change]}</td>
                    <td>
                      <ComparedLine line={row.before} currency={data.source.currency} />
                    </td>
                    <td>
                      <ComparedLine line={row.after} currency={data.target.currency} />
                    </td>
                    <td>
                      {row.change !== 'unchanged'
                        ? (row.after?.lastChangeReason ?? data.target.revisionReason ?? '—')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </details>
  );
}

function ComparedLine({
  line,
  currency,
}: {
  line: z.infer<typeof EnterpriseEstimateLine> | null;
  currency: string;
}) {
  if (!line) return '—';
  return (
    <div>
      <strong>{line.description}</strong>
      <div>
        {line.quantity ?? 'Awaiting quantity'} {estimateUnitLabel(line.unit)}
      </div>
      <div>
        Unit price ·{' '}
        {line.unitPriceMinor === null ? 'Unpriced' : estimatePrice(line.unitPriceMinor, currency)}
      </div>
      <div>
        Extended cost ·{' '}
        {line.extendedPriceMinor === null ? '—' : estimatePrice(line.extendedPriceMinor, currency)}
      </div>
    </div>
  );
}
