'use client';

import {
  CreateSalesEstimate,
  SalesEstimateDraft,
  SalesEstimateOptions,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Sources = z.infer<typeof SalesEstimateOptions>;
type Draft = z.infer<typeof SalesEstimateDraft>;

export function EnterpriseSalesEstimate({ opportunityId }: { opportunityId: string }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const permitted = session.can('enterprise_sales:intake');
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const sourcePath = '/enterprise/sales/opportunities/' + opportunityId;
  const target = '/v1' + sourcePath + '/estimate';
  const options = useQuery({
    queryKey: [...key, 'estimate-options', opportunityId],
    queryFn: () => api.get(target + '/options', { schema: SalesEstimateOptions }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const draftKey = [...key, 'estimate', opportunityId];
  const estimate = useQuery({
    queryKey: draftKey,
    queryFn: () => api.get(target, { schema: SalesEstimateDraft }),
    enabled: permitted && Boolean(options.data?.existingEstimateId),
    refetchOnMount: 'always',
  });
  const denied =
    !permitted ||
    [options.error, estimate.error].some(
      (error) => isApiError(error) && [401, 403, 404].includes(error.status),
    );
  const pending = options.isPending || (options.isFetching && !options.isFetchedAfterMount);
  const view = !denied && !pending ? options.data : undefined;
  const saved = estimate.data;
  const [notice, setNotice] = useState('');

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href={sourcePath} className="enterprise-back">
          ← Sales opportunity
        </Link>
        <h1>Sales estimate</h1>
        {view && <p>{view.opportunityName}</p>}
      </header>
      {denied && <p role="alert">This sales estimate is unavailable.</p>}
      {!denied && pending && <Skeleton variant="card" label="Loading estimate scope" />}
      {!denied && options.isError && (
        <SalesLeadFailure error={options.error} retry={() => void options.refetch()} />
      )}
      {!denied && estimate.isError && (
        <SalesLeadFailure error={estimate.error} retry={() => void estimate.refetch()} />
      )}
      {view && (
        <div className="enterprise-stack">
          {notice && <p role="status">{notice}</p>}
          {view.existingEstimateId && estimate.isPending && (
            <Skeleton variant="card" label="Loading estimate draft" />
          )}
          {saved && <EstimateDraft saved={saved} />}
          {!saved && view.canCreate && (
            <section className="enterprise-panel" aria-label="Estimate scope">
              <h2>Estimate scope</h2>
              {session.can('estimate:approve') && (
                <Link href="/enterprise/sales/estimate-templates">Review estimate templates</Link>
              )}
              <EstimateForm
                target={target}
                options={view}
                sourcePath={sourcePath}
                refresh={() => void options.refetch()}
                onSaved={(value) => {
                  setNotice('Sales estimate draft saved.');
                  client.setQueryData(draftKey, value);
                  void client.invalidateQueries({ queryKey: key });
                }}
              />
            </section>
          )}
          {!view.canCreate && !view.existingEstimateId && (
            <section className="enterprise-panel">
              <p>Qualify the opportunity before creating an estimate.</p>
              <Link href={sourcePath}>Review opportunity stage</Link>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function EstimateForm({
  target,
  options,
  sourcePath,
  refresh,
  onSaved,
}: {
  target: string;
  options: Sources;
  sourcePath: string;
  refresh: () => void;
  onSaved: (draft: Draft) => void;
}) {
  const { api } = useApi();
  const { me } = useSession();
  const [reviewed, setReviewed] = useState(options.revision);
  const [validation, setValidation] = useState('');
  const [selectedLot, setLot] = useState('');
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const stale = options.revision !== reviewed;
  const lot = options.lots.find(({ id }) => id === selectedLot);
  const save = useMutation({
    mutationFn: (input: z.infer<typeof CreateSalesEstimate>) =>
      api.post(target, input, { ifMatch: reviewed, schema: SalesEstimateDraft }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });

  return (
    <form
      className="enterprise-form"
      aria-label="Create sales estimate"
      onSubmit={(event) => {
        event.preventDefault();
        if (stale || save.isPending) return;
        const form = new FormData(event.currentTarget);
        const field = (name: string) => String(form.get(name) ?? '').trim();
        const currency = field('currency').toUpperCase();
        const budget = field('budget')
          ? parseMoneyInput(field('budget'), currency, me.user.locale)
          : null;
        if (budget && (!budget.ok || budget.minor === null)) {
          setValidation('Enter a valid target budget in the estimate currency.');
          return;
        }
        const input = {
          title: field('title'),
          planId: field('planId') || undefined,
          lotId: selectedLot || undefined,
          catalogRevisionId: field('catalogRevisionId') || undefined,
          templateRevisionId: field('templateRevisionId') || undefined,
          optionIds: form.getAll('optionId').map(String),
          currency,
          questionnaire: {
            requirements: field('requirements'),
            preferredMoveOn: field('moveOn') || undefined,
            targetBudgetMinor: budget?.minor == null ? undefined : Number(budget.minor),
          },
        };
        const signature = JSON.stringify([input, reviewed]);
        if (receipt.current?.signature !== signature)
          receipt.current = { signature, id: crypto.randomUUID() };
        const result = CreateSalesEstimate.safeParse({
          ...input,
          clientRequestId: receipt.current.id,
        });
        if (!result.success) {
          setValidation(result.error.issues[0]?.message ?? 'Review the estimate scope.');
          return;
        }
        setValidation('');
        save.mutate(result.data);
      }}
    >
      <label>
        Estimate title
        <input name="title" required minLength={3} maxLength={200} disabled={save.isPending} />
      </label>
      <label>
        Currency code
        <input
          name="currency"
          defaultValue={options.defaultCurrency}
          required
          minLength={3}
          maxLength={3}
          pattern="[A-Za-z]{3}"
          disabled={save.isPending}
        />
      </label>
      <label>
        House plan
        <select name="planId" disabled={save.isPending}>
          <option value="">No plan selected</option>
          {options.plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} · Revision {plan.revision}
            </option>
          ))}
        </select>
      </label>
      <label>
        Desired lot
        <select
          value={selectedLot}
          disabled={save.isPending}
          onChange={(event) => setLot(event.currentTarget.value)}
        >
          <option value="">No lot selected</option>
          {options.lots.map((item) => (
            <option key={item.id} value={item.id}>
              {item.lotNumber} · {item.status.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      {lot && lot.status !== 'available' && (
        <p role="status">
          Lot hold applies. The estimate can be saved while the lot remains{' '}
          {lot.status.replaceAll('_', ' ')}.
        </p>
      )}
      <label>
        Approved estimate template
        <select name="templateRevisionId" disabled={save.isPending}>
          <option value="">Blank estimate</option>
          {options.approvedTemplates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · Revision {item.revision}
            </option>
          ))}
        </select>
      </label>
      <label>
        Approved price catalog
        <select name="catalogRevisionId" disabled={save.isPending}>
          <option value="">No catalog selected</option>
          {options.catalogs.map((item) => (
            <option key={item.revisionId} value={item.revisionId}>
              {item.name} · Revision {item.revisionNumber} · {item.currency}
            </option>
          ))}
        </select>
      </label>
      {options.options.length > 0 && (
        <fieldset className="enterprise-budget-adjustment" disabled={save.isPending}>
          <legend>Buyer design options</legend>
          {options.options.map((item) => (
            <label className="enterprise-finance-disclosure-choice" key={item.id}>
              <input type="checkbox" name="optionId" value={item.id} />
              {item.name} ·{' '}
              {item.price.amountMinor === null
                ? 'Unpriced'
                : formatMinorUnits(
                    BigInt(item.price.amountMinor),
                    item.price.currency,
                    me.user.locale,
                  )}
            </label>
          ))}
        </fieldset>
      )}
      <label className="enterprise-budget-adjustment">
        Buyer scope requirements
        <textarea
          name="requirements"
          required
          minLength={3}
          maxLength={4000}
          disabled={save.isPending}
        />
      </label>
      <label>
        Preferred move date
        <input name="moveOn" type="date" disabled={save.isPending} />
      </label>
      <label>
        Target budget
        <input name="budget" inputMode="decimal" disabled={save.isPending} />
      </label>
      {stale && (
        <div role="status" className="enterprise-budget-adjustment">
          <p>
            Opportunity revision {options.revision} replaced revision {reviewed}.
          </p>
          <button
            type="button"
            onClick={() => {
              setReviewed(options.revision);
              save.reset();
            }}
          >
            Use current opportunity revision
          </button>
        </div>
      )}
      {validation && <p role="alert">{validation}</p>}
      {save.isError && <SalesLeadFailure error={save.error} />}
      <div className="enterprise-forecast-form-actions">
        <button type="submit" disabled={stale || save.isPending}>
          {save.isPending ? 'Saving…' : 'Create estimate draft'}
        </button>
        <Link href={sourcePath}>Cancel estimate</Link>
      </div>
    </form>
  );
}

function EstimateDraft({ saved }: { saved: Draft }) {
  const { me } = useSession();
  const { snapshot } = saved;
  const locale = me.user.locale;
  const cost = (minor: string | number, currency = saved.currency) =>
    formatMinorUnits(BigInt(minor), currency, locale);
  return (
    <section className="enterprise-panel" aria-label="Saved sales estimate draft">
      <h2>{saved.title}</h2>
      <p>Draft · Revision {saved.revision}</p>
      <Link href={'/enterprise/sales/opportunities/' + saved.opportunityId + '/estimate/pricing'}>
        Review sales pricing
      </Link>
      <dl>
        <dt>Source opportunity</dt>
        <dd>
          {snapshot.buyerName} · Revision {snapshot.leadRevision}
        </dd>
        <dt>Prices as of</dt>
        <dd>{snapshot.pricingAsOf}</dd>
        <dt>Preferred contact</dt>
        <dd>{snapshot.buyerPreferredContact}</dd>
        {snapshot.plan && (
          <>
            <dt>House plan</dt>
            <dd>
              {snapshot.plan.name} · Revision {snapshot.plan.revision}
            </dd>
          </>
        )}
        {snapshot.lot && (
          <>
            <dt>Desired lot</dt>
            <dd>
              {snapshot.lot.lotNumber} · Current status{' '}
              {saved.currentLotStatus?.replaceAll('_', ' ') ?? 'unavailable'}
            </dd>
            <dt>Lot status at creation</dt>
            <dd>{snapshot.lot.status.replaceAll('_', ' ')}</dd>
          </>
        )}
        {snapshot.catalog && (
          <>
            <dt>Approved price catalog</dt>
            <dd>
              {snapshot.catalog.name} · Revision {snapshot.catalog.revisionNumber}
            </dd>
          </>
        )}
        {snapshot.template && (
          <>
            <dt>Approved template</dt>
            <dd>
              {snapshot.template.name} · Revision {snapshot.template.revision}
            </dd>
          </>
        )}
        <dt>Buyer scope requirements</dt>
        <dd>{snapshot.questionnaire.requirements}</dd>
        {snapshot.questionnaire.preferredMoveOn && (
          <>
            <dt>Preferred move date</dt>
            <dd>{snapshot.questionnaire.preferredMoveOn}</dd>
          </>
        )}
        {snapshot.questionnaire.targetBudgetMinor !== undefined && (
          <>
            <dt>Target budget</dt>
            <dd>{cost(snapshot.questionnaire.targetBudgetMinor)}</dd>
          </>
        )}
        {snapshot.options.length > 0 && (
          <>
            <dt>Known options subtotal</dt>
            <dd>{cost(saved.knownOptionSubtotalMinor)}</dd>
          </>
        )}
      </dl>
      {saved.lotHold && (
        <p role="status">Lot hold applies. Verify the lot before committing to a sale.</p>
      )}
      {snapshot.options.length > 0 && (
        <ul className="enterprise-change-history" aria-label="Selected design options">
          {snapshot.options.map((item) => (
            <li key={item.id}>
              <strong>{item.name}</strong>
              <span>
                {saved.unpricedOptionIds.includes(item.id)
                  ? 'Unpriced for this estimate'
                  : cost(item.price.amountMinor ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {snapshot.template && (
        <section aria-label="Template assumptions">
          <h3>Approved labor assumptions</h3>
          <p>{snapshot.template.laborAssumptions}</p>
          <ul className="enterprise-change-history">
            {snapshot.template.lines.map((line, index) => (
              <li key={line.costCode + ':' + index}>
                {line.costCode} · {line.label}
              </li>
            ))}
          </ul>
        </section>
      )}
      {snapshot.defaultLaborRates.length > 0 && (
        <section aria-label="Catalog production rates">
          <h3>Catalog production rates</h3>
          <ul className="enterprise-change-history">
            {snapshot.defaultLaborRates.map((item) => (
              <li key={item.code}>
                {item.label} · {item.unitsPerHour} {item.unit} per hour · Crew {item.crewSize}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
