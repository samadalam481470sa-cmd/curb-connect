'use client';

import {
  SalesPipelineColumn,
  type SalesPipelineFilters,
  SalesPipelineView,
  SalesPipelineViewPage,
  SaveSalesPipelineView,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';
import { salesPipelineAddress, salesPipelinePath } from './SalesPipelineFilterPanel';

type Filters = z.infer<typeof SalesPipelineFilters>;
type Column = z.infer<typeof SalesPipelineColumn>;
const path = '/v1' + salesPipelinePath + '/saved-views';
export const defaultSalesColumns = SalesPipelineColumn.options;
export const salesColumnLabels: Record<Column, string> = {
  source: 'Source',
  community: 'Community',
  lot: 'Lot',
  owner: 'Assigned salesperson',
  last_contact: 'Last activity',
  next_activity: 'Next activity',
  approved_value: 'Approved value',
  probability: 'Probability',
  days_in_stage: 'Days in stage',
};

export function salesPipelineDisplayAddress(filters: Filters, columns?: readonly Column[]) {
  const address = salesPipelineAddress(salesPipelinePath, filters);
  if (!columns) return address;
  return (
    address +
    (address.includes('?') ? '&' : '?') +
    'columns=' +
    encodeURIComponent(columns.length ? columns.join(',') : 'none')
  );
}

export function SalesPipelineSavedViewLoader({
  id,
  filters,
  columns,
  children,
}: {
  id: string | undefined;
  filters: Filters | null;
  columns: Column[] | undefined;
  children: (filters: Filters | null, columns: readonly Column[], viewName?: string) => ReactNode;
}) {
  const { api } = useApi();
  const session = useSession();
  const permitted = session.can('enterprise_sales:intake');
  const query = useQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'sales-pipeline-views', id),
    enabled: permitted && Boolean(id),
    queryFn: ({ signal }) => api.get(path + '/' + id, { schema: SalesPipelineView, signal }),
    refetchOnMount: 'always',
  });
  if (!id || !permitted) return children(filters, columns ?? defaultSalesColumns);
  if (query.isError) {
    const absent = isApiError(query.error) && [403, 404].includes(query.error.status);
    if (absent)
      return (
        <>
          <p role="status">The saved view is unavailable. Showing the default pipeline.</p>
          {children({}, defaultSalesColumns)}
        </>
      );
    return (
      <main className="enterprise-suite">
        <h1>Sales pipeline</h1>
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
        <Link href={salesPipelinePath}>Open default pipeline</Link>
      </main>
    );
  }
  if (!query.isFetchedAfterMount || !query.data)
    return (
      <main className="enterprise-suite">
        <h1>Sales pipeline</h1>
        <Skeleton variant="card" label="Loading saved Sales view" />
      </main>
    );
  return children(query.data.filters, query.data.columns, query.data.name);
}

export function SalesPipelineSavedViews({
  filters,
  columns,
  viewName,
}: {
  filters: Filters;
  columns: readonly Column[];
  viewName?: string;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const router = useRouter();
  const key = orgKey(session.orgId, 'enterprise', 'sales-pipeline-views');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestId, setRequestId] = useState<string>();
  const [errorText, setErrorText] = useState('');
  const query = useInfiniteQuery({
    queryKey: [...key, 'list'],
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get(path, { schema: SalesPipelineViewPage, query: { cursor: pageParam }, signal }),
    getNextPageParam: (page: z.infer<typeof SalesPipelineViewPage>) => page.nextCursor,
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: (body: z.infer<typeof SaveSalesPipelineView>) =>
      api.post(path, body, { schema: SalesPipelineView }),
    onSuccess: (view) => {
      setSaving(false);
      void client.invalidateQueries({ queryKey: key });
      router.push(salesPipelinePath + '?view=' + view.id);
    },
  });
  return (
    <div className="enterprise-stack">
      <details
        className="enterprise-panel"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>Saved views{viewName ? ' · ' + viewName : ''}</summary>
        {open && query.isPending && <Skeleton variant="card" label="Loading saved views" />}
        {open && query.isError && (
          <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
        )}
        {open && query.isFetchedAfterMount && query.isSuccess && (
          <>
            <Link href={salesPipelinePath}>Default pipeline</Link>
            <ul className="enterprise-change-history" aria-label="Available saved views">
              {query.data.pages
                .flatMap(({ items }) => items)
                .map((item) => (
                  <li key={item.id}>
                    <Link href={salesPipelinePath + '?view=' + item.id} prefetch={false}>
                      {item.name}
                    </Link>
                    <span>
                      {item.visibility === 'company' ? 'Company · ' + item.owner : 'Private'}
                    </span>
                  </li>
                ))}
            </ul>
            {query.hasNextPage && (
              <button
                type="button"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                Show more views
              </button>
            )}
            {!saving && (
              <button
                type="button"
                onClick={() => {
                  save.reset();
                  setRequestId(crypto.randomUUID());
                  setErrorText('');
                  setSaving(true);
                }}
              >
                Save current view
              </button>
            )}
            {saving && (
              <form
                className="enterprise-form"
                aria-label="Save sales pipeline view"
                onChange={() => {
                  save.reset();
                  setRequestId(crypto.randomUUID());
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!requestId || save.isPending) return;
                  const form = new FormData(event.currentTarget);
                  const body = SaveSalesPipelineView.safeParse({
                    name: form.get('name'),
                    visibility: form.get('visibility') ?? 'private',
                    filters,
                    columns,
                    clientRequestId: requestId,
                  });
                  if (!body.success) {
                    setErrorText(
                      body.error.issues[0]?.message ?? 'Review the view name and visibility.',
                    );
                    return;
                  }
                  setErrorText('');
                  save.mutate(body.data);
                }}
              >
                <label>
                  View name
                  <input name="name" required maxLength={120} disabled={save.isPending} />
                </label>
                {session.can('enterprise_sales:manage') && (
                  <label>
                    Visibility
                    <select name="visibility" disabled={save.isPending}>
                      <option value="private">Private</option>
                      <option value="company">Company</option>
                    </select>
                  </label>
                )}
                <p>
                  The view saves the current filters, ordering, and visible columns. Each user keeps
                  their own access to sales records.
                </p>
                {errorText && <p role="alert">{errorText}</p>}
                {save.error && <SalesLeadFailure error={save.error} />}
                <button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save view'}
                </button>
                <button type="button" onClick={() => setSaving(false)} disabled={save.isPending}>
                  Cancel
                </button>
              </form>
            )}
          </>
        )}
      </details>
      <details className="enterprise-panel">
        <summary>Columns</summary>
        <form
          className="enterprise-form"
          aria-label="Choose sales pipeline columns"
          key={columns.join(',')}
          onSubmit={(event) => {
            event.preventDefault();
            const chosen = new FormData(event.currentTarget).getAll('columns');
            const current = SalesPipelineColumn.array().safeParse(chosen);
            if (current.success)
              router.push(salesPipelineDisplayAddress(filters, current.data), { scroll: false });
          }}
        >
          {SalesPipelineColumn.options.map((column) => (
            <label key={column}>
              <input
                type="checkbox"
                name="columns"
                value={column}
                defaultChecked={columns.includes(column)}
              />{' '}
              {salesColumnLabels[column]}
            </label>
          ))}
          <button type="submit">Apply columns</button>
        </form>
      </details>
    </div>
  );
}
