'use client';

import {
  SalesPipelineFilterFields,
  SalesPipelineFilterOptions,
  SalesPipelineFilters,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { formatMinorUnits, parseMoneyInput, Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { z } from 'zod';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';

type Filters = z.infer<typeof SalesPipelineFilters>;
type Option = { id: string; name: string };
export const salesPipelinePath = '/enterprise/sales/pipeline';
export function salesPipelineAddress(route: string, filters: Filters) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
  return route + (query.size ? '?' + query : '');
}

export function SalesPipelineFilterPanel({ filters }: { filters: Filters }) {
  const { api } = useApi();
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [navigating, navigate] = useTransition();
  const router = useRouter();
  const query = useQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'sales-pipeline-filter-options'),
    queryFn: ({ signal }) =>
      api.get('/v1' + salesPipelinePath + '/filter-options', {
        schema: SalesPipelineFilterOptions,
        signal,
      }),
    enabled: open,
    refetchOnMount: 'always',
  });
  const options = query.isFetchedAfterMount ? query.data : undefined;
  const locale = session.me.user.locale;
  const currency = filters.currency ?? options?.currency;
  const defaultMoney = (minor?: string) =>
    minor && currency ? formatMinorUnits(BigInt(minor), currency, locale) : '';
  const applied = Object.keys(filters).filter(
    (key) =>
      key !== 'stage' &&
      key !== 'search' &&
      key !== 'sort' &&
      filters[key as keyof Filters] !== undefined,
  );
  return (
    <details
      className="enterprise-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Filters{applied.length > 0 ? ' · Applied' : ''}</summary>
      {open && query.isPending && (
        <Skeleton variant="card" label="Loading pipeline filter choices" />
      )}
      {open && query.isError && (
        <SalesLeadFailure error={query.error} retry={() => void query.refetch()} />
      )}
      {open && options && (
        <form
          className="enterprise-form"
          aria-label="Filter sales pipeline"
          key={salesPipelineAddress('', filters)}
          onSubmit={(event) => {
            event.preventDefault();
            if (navigating) return;
            const form = new FormData(event.currentTarget);
            const selected = Object.fromEntries(
              Object.keys(SalesPipelineFilterFields.shape).map((key) => [
                key,
                String(form.get(key) ?? '').trim() || undefined,
              ]),
            );
            const rangeCurrency = selected.currency ?? options.currency;
            const min = parseMoneyInput(String(form.get('minValue') ?? ''), rangeCurrency, locale);
            const max = parseMoneyInput(String(form.get('maxValue') ?? ''), rangeCurrency, locale);
            if (!min.ok || !max.ok) {
              setError('Enter a valid approved value in ' + rangeCurrency + '.');
              return;
            }
            const parsed = SalesPipelineFilters.safeParse({
              ...selected,
              sort: filters.sort,
              stage: filters.stage,
              search: filters.search,
              minValueMinor: min.minor?.toString(),
              maxValueMinor: max.minor?.toString(),
              currency: min.minor !== null || max.minor !== null ? rangeCurrency : undefined,
            });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Review the selected filters.');
              return;
            }
            setError('');
            navigate(() =>
              router.push(salesPipelineAddress(salesPipelinePath, parsed.data), { scroll: false }),
            );
          }}
        >
          <Select
            label="Lead source"
            name="sourceId"
            value={filters.sourceId}
            options={options.sources}
          />
          <Select
            label="Community"
            name="communityId"
            value={filters.communityId}
            options={options.communities}
          />
          <Select label="Lot" name="lotId" value={filters.lotId} options={options.lots} />
          <Select
            label="Assigned salesperson"
            name="ownerMembershipId"
            value={filters.ownerMembershipId}
            options={options.owners}
          />
          <label>
            Created from
            <input name="createdFrom" type="date" defaultValue={filters.createdFrom} />
          </label>
          <label>
            Created through
            <input name="createdThrough" type="date" defaultValue={filters.createdThrough} />
          </label>
          <label>
            Next activity
            <select name="nextActivity" defaultValue={filters.nextActivity ?? ''}>
              <option value="">Any</option>
              <option value="scheduled">Scheduled</option>
              <option value="unscheduled">Unscheduled</option>
            </select>
          </label>
          <fieldset>
            <legend>Approved value</legend>
            <label>
              Currency
              <input
                name="currency"
                required
                maxLength={3}
                pattern="[A-Z]{3}"
                defaultValue={currency}
              />
            </label>
            <label>
              Minimum approved value
              <input
                name="minValue"
                inputMode="decimal"
                maxLength={32}
                defaultValue={defaultMoney(filters.minValueMinor)}
              />
            </label>
            <label>
              Maximum approved value
              <input
                name="maxValue"
                inputMode="decimal"
                maxLength={32}
                defaultValue={defaultMoney(filters.maxValueMinor)}
              />
            </label>
          </fieldset>
          <fieldset>
            <legend>Contact consent</legend>
            <label>
              Purpose
              <select name="consentPurpose" defaultValue={filters.consentPurpose ?? ''}>
                <option value="">Any</option>
                <option value="inquiry">Inquiry</option>
                <option value="marketing">Marketing</option>
              </select>
            </label>
            <label>
              Channel
              <select name="consentChannel" defaultValue={filters.consentChannel ?? ''}>
                <option value="">Any</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
              </select>
            </label>
            <label>
              Consent status
              <select name="consentStatus" defaultValue={filters.consentStatus ?? ''}>
                <option value="">Any</option>
                <option value="granted">Granted</option>
                <option value="declined">Declined</option>
                <option value="not_recorded">Not recorded</option>
              </select>
            </label>
          </fieldset>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={navigating}>
            Apply filters
          </button>
          <Link
            href={salesPipelineAddress(salesPipelinePath, {
              stage: filters.stage,
              search: filters.search,
            })}
          >
            Clear filters
          </Link>
        </form>
      )}
    </details>
  );
}

function Select({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: Option[];
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={value ?? ''}>
        <option value="">Any</option>
        {value && !options.some(({ id }) => id === value) && (
          <option value={value}>Unavailable selection</option>
        )}
        {options.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
