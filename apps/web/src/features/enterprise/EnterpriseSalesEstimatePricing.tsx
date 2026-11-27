'use client';

import {
  ApproveSalesEstimatePricing,
  ApprovedSalesEstimatePricing,
  ReviewSalesEstimatePricing,
  SalesEstimatePricingReview,
  SalesEstimatePricingStatus,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Status = z.infer<typeof SalesEstimatePricingStatus>;
type PriceInput = z.infer<typeof ReviewSalesEstimatePricing>;
type Pricing =
  z.infer<typeof SalesEstimatePricingReview> | z.infer<typeof ApprovedSalesEstimatePricing>;
const textLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function EnterpriseSalesEstimatePricing({ opportunityId }: { opportunityId: string }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const permitted = session.can('enterprise_sales:intake');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const source = '/enterprise/sales/opportunities/' + opportunityId;
  const target = '/v1' + source + '/estimate/pricing';
  const query = useQuery({
    queryKey: [...key, 'estimate-pricing', opportunityId],
    queryFn: () => api.get(target, { schema: SalesEstimatePricingStatus }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted || (isApiError(query.error) && [401, 403, 404].includes(query.error.status));
  const pending = query.isPending || (query.isFetching && !query.isFetchedAfterMount);
  const view = !denied && !pending ? query.data : undefined;
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={source + '/estimate'} className="enterprise-back">
          ← Sales estimate
        </Link>
        <h1>Sales estimate pricing</h1>
        {view && <p>{view.estimateTitle}</p>}
      </header>
      {denied && <p role="alert">Sales pricing is unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading sales pricing" />}
      {!denied && query.isError && (
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
      )}
      {view && (
        <section className="enterprise-panel" aria-label="Estimate pricing">
          {view.approved ? (
            <>
              <h2>Approved estimate · Revision {view.approved.revision}</h2>
              <PricingPreview value={view.approved} />
              <p>{view.approved.approvalReason}</p>
              <Link href={source + '/proposal'}>Open sales proposal</Link>
            </>
          ) : view.canApprove ? (
            <PricingForm
              status={view}
              target={target}
              onSaved={() => void client.invalidateQueries({ queryKey: key })}
              refetch={() => void query.refetch()}
            />
          ) : (
            <p>
              {session.can('estimate:approve')
                ? 'Move the opportunity to Estimating before approving pricing.'
                : 'An authorized estimator must approve this pricing.'}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function PricingPreview({ value }: { value: Pricing }) {
  const { me } = useSession();
  const amount = (minor: number) => formatMinorUnits(BigInt(minor), value.currency, me.user.locale);
  return (
    <section aria-label="Reviewed estimate total" className="enterprise-budget-adjustment">
      <h3>Reviewed estimate total</h3>
      <dl>
        <dt>Base scope</dt>
        <dd>{amount(value.baseSellMinor)}</dd>
        <dt>Options</dt>
        <dd>{amount(value.optionsMinor)}</dd>
        <dt>Allowances</dt>
        <dd>{amount(value.allowancesMinor)}</dd>
        <dt>Tax</dt>
        <dd>{amount(value.taxMinor)}</dd>
        <dt>Sell total</dt>
        <dd>{amount(value.totalMinor)}</dd>
      </dl>
      {!value.readyForApproval && <p role="status">Selected options need approved pricing.</p>}
      <ul className="enterprise-change-history">
        {value.options.map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            <span>{item.amountMinor === null ? 'Unpriced' : amount(item.amountMinor)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PricingForm({
  status,
  target,
  onSaved,
  refetch,
}: {
  status: Status;
  target: string;
  onSaved: () => void;
  refetch: () => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [validated, setValidated] = useState('');
  const [allowanceRows, setRows] = useState<number[]>([]);
  const rowId = useRef(0);
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const review = useMutation({
    mutationFn: (data: PriceInput) =>
      api.post(target + '/review', data, { schema: SalesEstimatePricingReview }),
  });
  const save = useMutation({
    mutationFn: (input: z.infer<typeof ApproveSalesEstimatePricing>) =>
      api.post(target + '/approval', input, {
        ifMatch: status.revision,
        schema: ApprovedSalesEstimatePricing,
      }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.status === 412) {
        review.reset();
        refetch();
      }
    },
  });
  const busy = review.isPending || save.isPending;
  function amount(value: string) {
    const parsed = parseMoneyInput(value, status.currency, me.user.locale);
    if (!parsed.ok || parsed.minor === null)
      throw new Error('Enter a valid amount in ' + status.currency + '.');
    return Number(parsed.minor);
  }
  return (
    <form
      className="enterprise-form"
      aria-label="Review sales estimate pricing"
      onChange={(event) => {
        if (
          !(event.target instanceof HTMLTextAreaElement) ||
          event.target.name !== 'approvalReason'
        ) {
          review.reset();
          save.reset();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const form = new FormData(event.currentTarget);
        const field = (name: string) => String(form.get(name) ?? '').trim();
        try {
          const input = ReviewSalesEstimatePricing.parse({
            baseSellMinor: amount(field('base')),
            taxMinor: field('tax') ? amount(field('tax')) : 0,
            includedScope: textLines(field('includes')),
            excludedScope: textLines(field('excludes')),
            allowances: allowanceRows.map((row) => ({
              description: field('allowance-' + row),
              amountMinor: amount(field('allowance-price-' + row)),
            })),
            optionPricing: status.sourceOptions
              .filter(({ id }) => Boolean(field('option-' + id)))
              .map(({ id }) => ({ optionId: id, amountMinor: amount(field('option-' + id)) })),
          });
          setValidated('');
          if (!review.data) {
            review.mutate(input);
            return;
          }
          const command = {
            ...input,
            priceReview: review.data.priceReview,
            reason: field('approvalReason'),
          };
          const signature = JSON.stringify([command, status.revision]);
          if (receipt.current?.signature !== signature)
            receipt.current = { signature, id: crypto.randomUUID() };
          if (review.data.readyForApproval)
            save.mutate(
              ApproveSalesEstimatePricing.parse({
                ...command,
                clientRequestId: receipt.current.id,
              }),
            );
        } catch (cause) {
          setValidated(cause instanceof Error ? cause.message : 'Review the pricing fields.');
        }
      }}
    >
      <label>
        Base sell amount
        <input name="base" inputMode="decimal" required disabled={busy} />
      </label>
      <label>
        Tax amount
        <input name="tax" inputMode="decimal" disabled={busy} />
      </label>
      <label>
        Included scope, one item per line
        <textarea name="includes" required disabled={busy} />
      </label>
      <label>
        Excluded scope, one item per line
        <textarea name="excludes" disabled={busy} />
      </label>
      {status.sourceOptions.map((item) => (
        <label key={item.id}>
          {item.name} price
          <input
            name={'option-' + item.id}
            inputMode="decimal"
            disabled={busy}
            placeholder={
              item.amountMinor === null
                ? 'Unpriced'
                : formatMinorUnits(BigInt(item.amountMinor), status.currency, me.user.locale)
            }
          />
        </label>
      ))}
      {allowanceRows.map((row, index) => (
        <fieldset key={row} disabled={busy} className="enterprise-budget-adjustment">
          <legend>Allowance {index + 1}</legend>
          <label>
            Allowance description
            <input name={'allowance-' + row} maxLength={500} required />
          </label>
          <label>
            Allowance amount
            <input name={'allowance-price-' + row} inputMode="decimal" required />
          </label>
          <button
            type="button"
            onClick={() => {
              setRows((old) => old.filter((id) => id !== row));
              review.reset();
            }}
          >
            Remove allowance
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          const id = rowId.current++;
          setRows((old) => [...old, id]);
          review.reset();
        }}
      >
        Add allowance
      </button>
      {review.data && (
        <>
          <PricingPreview value={review.data} />
          <label>
            Pricing approval reason
            <textarea
              name="approvalReason"
              minLength={3}
              maxLength={1000}
              required
              disabled={busy}
            />
          </label>
        </>
      )}
      {validated && <p role="alert">{validated}</p>}
      {review.isError && <SalesLeadFailure error={review.error} />}
      {save.isError && <SalesLeadFailure error={save.error} />}
      <div className="enterprise-forecast-form-actions">
        <button
          type="submit"
          disabled={busy || Boolean(review.data && !review.data.readyForApproval)}
        >
          {review.data ? 'Approve estimate pricing' : 'Review estimate total'}
        </button>
      </div>
    </form>
  );
}
