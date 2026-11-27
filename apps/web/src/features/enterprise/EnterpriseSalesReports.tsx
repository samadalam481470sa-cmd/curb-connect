'use client';

import {
  HOME_SALES_PIPELINE_ID,
  PreviewSalesReport,
  type SalesPipelineFilters,
  SalesReport,
  SalesReportColumn,
  SalesReportPage,
  SalesReportPreview,
  SALES_PIPELINE_STAGES,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Filters = z.infer<typeof SalesPipelineFilters>;
type Column = z.infer<typeof SalesReportColumn>;
const target = '/v1/enterprise/sales/reports';
const labels: Record<Column, string> = {
  lead_name: 'Lead name',
  stage: 'Stage',
  source: 'Source',
  community: 'Community',
  owner: 'Assigned salesperson',
  entered_stage_at: 'Entered stage',
  last_activity_at: 'Last activity',
  next_activity_at: 'Next activity',
  approved_sell_minor: 'Approved price (minor units)',
  currency: 'Currency',
  converted: 'Converted to project',
  email: 'Email',
  phone: 'Phone',
};
const defaults = ['lead_name', 'stage', 'source', 'community', 'owner', 'converted'];
const deniedStatus = (error: unknown) =>
  isApiError(error) && [401, 403, 404].includes(error.status);

export function EnterpriseSalesReports({ filters }: { filters: Filters | null }) {
  const { api } = useApi();
  const session = useSession();
  const permitted =
    session.can('enterprise_sales:manage') && session.can('enterprise_sales:intake');
  const history = useInfiniteQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'sales-reports'),
    queryFn: ({ pageParam }) =>
      api.get(target, { schema: SalesReportPage, query: { cursor: pageParam } }),
    enabled: permitted && Boolean(filters),
    initialPageParam: null as string | null,
    getNextPageParam: ({ nextCursor }) => nextCursor,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.pages.some(({ items }) => items.some(({ status }) => status === 'queued'))
        ? 1500
        : false,
  });
  const denied = !permitted || deniedStatus(history.error);
  const ready = !denied && history.isFetchedAfterMount;
  const items = ready ? (history.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters ?? {})) if (value) params.set(name, value);
  const back = '/enterprise/sales/pipeline' + (params.size ? '?' + params : '');

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={back} className="enterprise-back">
          ← Sales pipeline
        </Link>
        <h1>Sales reports</h1>
      </header>
      {denied && <p role="alert">Sales reports are unavailable.</p>}
      {!denied && !filters && <p role="alert">The selected pipeline filters are invalid.</p>}
      {!denied && filters && history.isPending && (
        <Skeleton variant="card" label="Loading sales reports" />
      )}
      {!denied && history.isError && (
        <SalesLeadFailure error={history.error} retry={() => void history.refetch()} />
      )}
      {filters && ready && history.data && (
        <div className="enterprise-stack">
          <ReportForm
            key={session.orgId + ':' + params.toString()}
            filters={filters}
            contactGrant={session.can('enterprise_sales:export_contacts')}
            onQueued={() => void history.refetch()}
            cancelHref={back}
          />
          <section className="enterprise-panel" aria-label="Prior sales exports">
            <h2>Export history</h2>
            {!items.length && <p>No sales exports yet.</p>}
            <ul className="enterprise-change-history">
              {items.map((item) => {
                const canDownload =
                  session.can('enterprise_sales:export_contacts') ||
                  !item.columns.some((column) => column === 'email' || column === 'phone');
                return (
                  <li key={item.id}>
                    <strong>
                      {item.format.toUpperCase()} · {item.rowCount}{' '}
                      {item.rowCount === 1 ? 'row' : 'rows'}
                    </strong>
                    <span>
                      {new Date(item.createdAt).toLocaleString()} · {item.status}
                    </span>
                    {item.omittedColumns.length > 0 && (
                      <span>
                        Omitted {item.omittedColumns.map((column) => labels[column]).join(', ')}
                      </span>
                    )}
                    {item.status === 'ready' && canDownload && (
                      <a href={target + '/' + item.id + '/file'} download>
                        Download {item.format.toUpperCase()}
                      </a>
                    )}
                    {item.status === 'failed' && <span>Review and queue a new export.</span>}
                  </li>
                );
              })}
            </ul>
            {history.hasNextPage && (
              <button
                type="button"
                onClick={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
              >
                Show older exports
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ReportForm({
  filters,
  contactGrant,
  onQueued,
  cancelHref,
}: {
  filters: Filters;
  contactGrant: boolean;
  onQueued: () => void;
  cancelHref: string;
}) {
  const { api } = useApi();
  const [selected, setSelected] = useState<z.infer<typeof PreviewSalesReport>>();
  const [clientRequestId, setClientRequestId] = useState<string>();
  const [message, setMessage] = useState('');
  const review = useMutation({
    mutationFn: (input: z.infer<typeof PreviewSalesReport>) =>
      api.post(target + '/preview', input, { schema: SalesReportPreview }),
    onSuccess: (_, input) => {
      setSelected(input);
      setClientRequestId(crypto.randomUUID());
    },
  });
  const queue = useMutation({
    mutationFn: (
      input: z.infer<typeof PreviewSalesReport> & {
        viewFingerprint: string;
        clientRequestId: string;
      },
    ) => api.post(target, input, { schema: SalesReport }),
    onSuccess: onQueued,
  });
  const busy = review.isPending || queue.isPending;
  const stage =
    filters.stage && SALES_PIPELINE_STAGES.find(({ key }) => key === filters.stage)?.label;
  function clearReview() {
    review.reset();
    queue.reset();
    setSelected(undefined);
    setClientRequestId(undefined);
    setMessage('');
  }
  return (
    <section className="enterprise-panel" aria-label="Review sales export">
      <h2>Export pipeline and conversions</h2>
      <p>
        {stage ?? 'All stages'}
        {filters.search && ' · Search: ' + filters.search}
      </p>
      <form
        className="enterprise-form"
        onChange={clearReview}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const values = new FormData(event.currentTarget);
          const input = PreviewSalesReport.safeParse({
            pipelineId: HOME_SALES_PIPELINE_ID,
            filters,
            columns: values.getAll('columns'),
            format: values.get('format'),
            contactPurpose: values.get('purpose') || undefined,
          });
          if (!input.success) {
            setMessage(input.error.issues[0]?.message ?? 'Review the report options.');
            return;
          }
          setMessage('');
          queue.reset();
          setSelected(undefined);
          review.mutate(input.data);
        }}
      >
        <fieldset disabled={busy}>
          <legend>Columns</legend>
          {SalesReportColumn.options.map((column) => (
            <label key={column}>
              <input
                type="checkbox"
                name="columns"
                value={column}
                defaultChecked={defaults.includes(column)}
                disabled={!contactGrant && (column === 'email' || column === 'phone')}
              />{' '}
              {labels[column]}
            </label>
          ))}
        </fieldset>
        <label>
          File format
          <select name="format" disabled={busy}>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        {contactGrant && (
          <label>
            Contact consent to use
            <select name="purpose" disabled={busy}>
              <option value="">Omit contact details</option>
              <option value="inquiry">Inquiry</option>
              <option value="marketing">Marketing</option>
            </select>
          </label>
        )}
        <button type="submit" disabled={busy}>
          {review.isPending ? 'Reviewing…' : 'Review export'}
        </button>
        <Link href={cancelHref}>Cancel</Link>
      </form>
      {message && <p role="alert">{message}</p>}
      {review.error && <SalesLeadFailure error={review.error} />}
      {selected && review.data && clientRequestId && (
        <div className="enterprise-stack">
          <p role="status">
            {review.data.rowCount} {review.data.rowCount === 1 ? 'row matches' : 'rows match'} the
            selected pipeline.
          </p>
          <p>
            Included{' '}
            {review.data.includedColumns.map((column) => labels[column]).join(', ') || 'none'}
          </p>
          {review.data.omittedColumns.length > 0 && (
            <p>Omitted {review.data.omittedColumns.map((column) => labels[column]).join(', ')}</p>
          )}
          <button
            type="button"
            disabled={busy || queue.isSuccess || !review.data.includedColumns.length}
            onClick={() =>
              queue.mutate({
                ...selected,
                clientRequestId,
                viewFingerprint: review.data.viewFingerprint,
              })
            }
          >
            {queue.isPending ? 'Queuing…' : 'Queue export'}
          </button>
        </div>
      )}
      {queue.error && <SalesLeadFailure error={queue.error} />}
      {queue.isSuccess && (
        <p role="status">Export queued. Check export history for the download.</p>
      )}
    </section>
  );
}
