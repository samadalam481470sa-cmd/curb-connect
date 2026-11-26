'use client';

import {
  EnterprisePurchaseCostCode,
  EnterprisePurchaseOrder,
  EnterprisePurchaseOrderDetails,
  EnterprisePurchaseOrderLookup,
  EnterprisePurchasingPage,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EnterprisePurchaseCommitments } from './EnterprisePurchaseCommitments';
import { EnterprisePurchaseVariances } from './EnterprisePurchaseVariances';

type CostCode = z.infer<typeof EnterprisePurchaseCostCode>;
type OrderDetails = z.infer<typeof EnterprisePurchaseOrderDetails>;

function message(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Check the order fields.';
  return error instanceof Error ? error.message : errorHint(error);
}

const dollars = new Intl.NumberFormat('en-US');

function money(amountMinor: number | string) {
  const cents = BigInt(amountMinor);
  const whole = dollars.format(cents / 100n);
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return '$' + whole + '.' + fraction;
}

function usePurchasing(projectId: string) {
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'purchasing', projectId];
  const path = '/v1/enterprise/projects/' + encodeURIComponent(projectId);
  return {
    key,
    path,
    canManage: session.can('org:settings_update'),
    invalidate: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({
          queryKey: orgKey(session.orgId, 'enterprise', 'project-budget', projectId),
        }),
      ]),
  };
}

function usePurchaseOrders(projectId: string, enabled = true, costCode = '') {
  const { api } = useApi();
  const { path, key } = usePurchasing(projectId);
  return useInfiniteQuery({
    queryKey: [...key, 'orders', costCode],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path + '/purchase-orders', {
        query: { cursor: pageParam, costCode: costCode || undefined },
        schema: EnterprisePurchasingPage,
      }),
    getNextPageParam: (page) => page.nextCursor,
    enabled,
  });
}

function CostCodeForm({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const { path, invalidate } = usePurchasing(projectId);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const mutation = useMutation({
    mutationFn: (body: CostCode) =>
      api.post(path + '/purchase-cost-codes', body, { schema: EnterprisePurchaseCostCode }),
    onSuccess: invalidate,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setSaved('');
    try {
      const body = EnterprisePurchaseCostCode.parse(Object.fromEntries(new FormData(form)));
      const result = await mutation.mutateAsync(body);
      form.reset();
      setSaved('Cost code ' + result.code + ' is available for this project.');
    } catch (cause) {
      setError(message(cause));
    }
  }

  return (
    <details>
      <summary>Add a project purchase cost code</summary>
      <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
        <label>
          Code <input name="code" required maxLength={24} placeholder="07-54" />
        </label>
        <label>
          Cost code description <input name="label" required minLength={2} maxLength={160} />
        </label>
        <button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Add cost code'}
        </button>
        {error && (
          <p className="enterprise-error" role="alert">
            {error}
          </p>
        )}
        {saved && <p role="status">{saved}</p>}
      </form>
    </details>
  );
}

function PurchaseOrderForm({
  codes,
  order,
  onSave,
  onCancel,
}: {
  codes: CostCode[];
  order: EnterprisePurchaseOrder | null;
  onSave: (body: OrderDetails) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError('');
    setSaving(true);
    try {
      const body = EnterprisePurchaseOrderDetails.parse({
        costCode: fields.get('costCode'),
        deliveryAddress: fields.get('deliveryAddress'),
        requestedDeliveryOn: fields.get('requestedDeliveryOn') || null,
      });
      await onSave(body);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
      <label>
        Purchase cost code
        <select name="costCode" required defaultValue={order?.costCode ?? ''}>
          <option value="">Choose a project cost code</option>
          {codes.map((code) => (
            <option key={code.code} value={code.code}>
              {code.code} · {code.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Delivery address
        <textarea
          name="deliveryAddress"
          defaultValue={order?.deliveryAddress}
          required
          minLength={5}
          maxLength={1000}
        />
      </label>
      <label>
        Requested delivery date (optional)
        <input
          name="requestedDeliveryOn"
          type="date"
          defaultValue={order?.requestedDeliveryOn ?? ''}
        />
      </label>
      {error && (
        <p className="enterprise-error" role="alert">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={saving || !codes.length}>
          {saving ? 'Saving…' : order ? 'Save draft changes' : 'Create draft purchase order'}
        </button>
        <button type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function PurchaseOrderDetails({ order }: { order: EnterprisePurchaseOrder }) {
  const issuedDate = order.issuedAt?.slice(0, 10);
  return (
    <>
      <p>
        <strong>
          {order.status === 'issued' ? 'Issued' : 'Draft'} · {money(order.amountMinor)}
        </strong>{' '}
        · {order.vendorName}
      </p>
      <dl>
        <dt>Purchase cost code</dt>
        <dd>{order.costCode}</dd>
        <dt>Delivery address</dt>
        <dd className="enterprise-bid-scope">{order.deliveryAddress}</dd>
        <dt>Requested delivery</dt>
        <dd>{order.requestedDeliveryOn ?? 'Unscheduled'}</dd>
        {issuedDate && (
          <>
            <dt>Issued on (UTC)</dt>
            <dd>
              <time dateTime={order.issuedAt ?? undefined}>{issuedDate}</time>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

export function AwardPurchaseOrder({
  projectId,
  packageId,
  awardRevision,
}: {
  projectId: string;
  packageId: string;
  awardRevision: number;
}) {
  const { api } = useApi();
  const { path, key, canManage, invalidate } = usePurchasing(projectId);
  const [editing, setEditing] = useState<{
    order: EnterprisePurchaseOrder | null;
    awardRevision: number;
  } | null>(null);
  const [confirmIssue, setConfirmIssue] = useState<EnterprisePurchaseOrder | null>(null);
  const lookupPath = path + '/bid-packages/' + packageId + '/purchase-order';
  const lookup = useQuery({
    queryKey: [...key, 'for-bid', packageId],
    queryFn: () => api.get(lookupPath, { schema: EnterprisePurchaseOrderLookup }),
  });
  const order = lookup.data?.order ?? null;
  const canEdit = canManage && lookup.isSuccess && order?.status !== 'issued';
  const codes = usePurchaseOrders(projectId, canEdit && editing !== null);
  const save = useMutation({
    mutationFn: ({
      body,
      baseline,
    }: {
      body: OrderDetails;
      baseline: NonNullable<typeof editing>;
    }) =>
      baseline.order
        ? api.patch(path + '/purchase-orders/' + baseline.order.id, body, {
            schema: EnterprisePurchaseOrder,
            ifMatch: baseline.order.revision,
          })
        : api.post(lookupPath, body, {
            schema: EnterprisePurchaseOrder,
            ifMatch: baseline.awardRevision,
          }),
    onSuccess: async () => {
      await invalidate();
      setEditing(null);
    },
  });
  const issue = useMutation({
    mutationFn: (draft: EnterprisePurchaseOrder) =>
      api.post(
        path + '/purchase-orders/' + draft.id + '/issue',
        {},
        {
          schema: EnterprisePurchaseOrder,
          ifMatch: draft.revision,
        },
      ),
    onSuccess: async () => {
      await invalidate();
      setConfirmIssue(null);
    },
  });

  return (
    <section aria-label="Award purchase order">
      <h4>Purchase order</h4>
      {lookup.isPending && <p role="status">Loading purchase order…</p>}
      {lookup.isError && (
        <div>
          <p className="enterprise-error" role="alert">
            {message(lookup.error)}
          </p>
          <button type="button" onClick={() => void lookup.refetch()}>
            Retry purchase order lookup
          </button>
        </div>
      )}
      {lookup.isSuccess && !order && !editing && <p>This award has no purchase order.</p>}
      {order && <PurchaseOrderDetails order={order} />}
      {order && <EnterprisePurchaseVariances projectId={projectId} orderId={order.id} />}
      {order?.status === 'issued' && (
        <EnterprisePurchaseCommitments
          projectId={projectId}
          orderId={order.id}
          onChange={() => void invalidate()}
        />
      )}
      {canEdit && !editing && !confirmIssue && (
        <div className="enterprise-actions">
          <button type="button" onClick={() => setEditing({ order, awardRevision })}>
            {order ? 'Edit draft' : 'Prepare purchase order'}
          </button>
          {order && (
            <button type="button" onClick={() => setConfirmIssue(order)}>
              Review and issue
            </button>
          )}
        </div>
      )}
      {canEdit && editing && (
        <>
          {codes.isPending && <p role="status">Loading purchase cost codes…</p>}
          {codes.isError && (
            <p className="enterprise-error" role="alert">
              {message(codes.error)}
            </p>
          )}
          {codes.isSuccess && !codes.data.pages[0]?.costCodes.length && (
            <p>Add a project purchase cost code to continue.</p>
          )}
          <CostCodeForm projectId={projectId} />
          <PurchaseOrderForm
            codes={codes.data?.pages[0]?.costCodes ?? []}
            order={editing.order}
            onSave={(body) => save.mutateAsync({ body, baseline: editing })}
            onCancel={() => {
              setEditing(null);
              void lookup.refetch();
            }}
          />
        </>
      )}
      {canEdit && confirmIssue && (
        <div>
          <p>
            Issuing records {money(confirmIssue.amountMinor)} as committed cost. Send the issued
            order to the vendor through your purchasing process.
          </p>
          {issue.isError && (
            <p className="enterprise-error" role="alert">
              {message(issue.error)}
            </p>
          )}
          <div className="enterprise-actions">
            <button
              type="button"
              disabled={issue.isPending}
              onClick={() => issue.mutate(confirmIssue)}
            >
              {issue.isPending ? 'Issuing…' : 'Issue purchase order'}
            </button>
            <button
              type="button"
              disabled={issue.isPending}
              onClick={() => {
                issue.reset();
                setConfirmIssue(null);
                void lookup.refetch();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function EnterprisePurchasingSummary({ projectId }: { projectId: string }) {
  const { canManage, invalidate } = usePurchasing(projectId);
  const [costCode, setCostCode] = useState('');
  const report = usePurchaseOrders(projectId);
  const filtered = usePurchaseOrders(projectId, costCode !== '', costCode);
  const orders = costCode ? filtered : report;
  const summary = report.data?.pages[0];
  const items = orders.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section className="enterprise-panel">
      <h2>Purchase orders &amp; committed costs</h2>
      <p>
        Amounts become committed when a purchase order is issued. Approved amendments update the
        committed amount.
      </p>
      {orders.isPending && <p role="status">Loading purchase orders…</p>}
      {orders.isError && (
        <div>
          <p className="enterprise-error" role="alert">
            {message(orders.error)}
          </p>
          <button type="button" onClick={() => void orders.refetch()}>
            Retry
          </button>
        </div>
      )}
      {summary && (
        <>
          <div className="enterprise-kpis">
            <div>
              <span>Project committed cost</span>
              <strong>{money(summary.committedTotalMinor)}</strong>
            </div>
            {summary.commitments.map((row) => (
              <div key={row.costCode}>
                <span>
                  {row.costCode} ·{' '}
                  {summary.costCodes.find((code) => code.code === row.costCode)?.label}
                </span>
                <strong>{money(row.amountMinor)}</strong>
              </div>
            ))}
          </div>
          {canManage && <CostCodeForm projectId={projectId} />}
          {summary.costCodes.length > 0 && (
            <label>
              Filter purchase orders by cost code
              <select value={costCode} onChange={(event) => setCostCode(event.target.value)}>
                <option value="">All cost codes</option>
                {summary.costCodes.map((code) => (
                  <option key={code.code} value={code.code}>
                    {code.code} · {code.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {items.length ? (
            <ul className="enterprise-change-history">
              {items.map((order) => (
                <li key={order.id}>
                  <details>
                    <summary>
                      {order.title} · {order.vendorName} · {money(order.amountMinor)} ·{' '}
                      {order.status === 'issued' ? 'Issued' : 'Draft'}
                    </summary>
                    <PurchaseOrderDetails order={order} />
                    <EnterprisePurchaseVariances projectId={projectId} orderId={order.id} />
                    {order.status === 'issued' && (
                      <EnterprisePurchaseCommitments
                        projectId={projectId}
                        orderId={order.id}
                        onChange={() => void invalidate()}
                      />
                    )}
                    <p className="enterprise-bid-scope">{order.scope}</p>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            orders.isSuccess && (
              <p className="enterprise-empty">
                {costCode
                  ? 'No purchase orders use this cost code.'
                  : 'This project has no purchase orders.'}
              </p>
            )
          )}
          {orders.hasNextPage && (
            <button
              type="button"
              disabled={orders.isFetchingNextPage}
              onClick={() => void orders.fetchNextPage()}
            >
              Load more purchase orders
            </button>
          )}
        </>
      )}
    </section>
  );
}
