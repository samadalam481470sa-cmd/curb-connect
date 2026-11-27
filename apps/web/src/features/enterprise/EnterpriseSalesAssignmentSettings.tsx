'use client';

import {
  SalesAssignmentPolicy,
  SalesTerritory,
  SalesTerritoryInput,
  SalesTerritoryOptions,
  SetSalesAssignmentPolicy,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { SalesLeadFailure } from './EnterpriseSalesLeads';
import { EnterpriseSalesFollowUpSettings } from './EnterpriseSalesFollowUpSettings';

const path = '/v1/enterprise/sales/assignment-settings';
type Territories = z.infer<typeof SalesTerritoryOptions>;
type Policy = z.infer<typeof SalesAssignmentPolicy>;

type Receipt = { signature: string; id: string } | null;

function request(previous: Receipt, input: object, revision: number): NonNullable<Receipt> {
  const signature = JSON.stringify([input, revision]);
  return previous?.signature === signature ? previous : { signature, id: crypto.randomUUID() };
}

export function EnterpriseSalesAssignmentSettings() {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const permitted = session.can('enterprise_sales:manage');
  const territory = useQuery({
    queryKey: [...key, 'territory'],
    queryFn: () => api.get(path + '/territories', { schema: SalesTerritoryOptions }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const policy = useQuery({
    queryKey: [...key, 'queue-policy'],
    queryFn: () => api.get(path + '/round-robin', { schema: SalesAssignmentPolicy }),
    enabled: permitted,
    refetchOnMount: 'always',
  });
  const denied =
    !permitted ||
    [territory.error, policy.error].some(
      (error) => isApiError(error) && [401, 403, 404].includes(error.status),
    );
  const ready = territory.isFetchedAfterMount && policy.isFetchedAfterMount;
  const refresh = () => void client.invalidateQueries({ queryKey: key });

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise/sales/leads" className="enterprise-back">
          ← Sales leads
        </Link>
        <h1>Sales assignment settings</h1>
      </header>
      {denied ? (
        <p role="alert">These sales assignment settings are unavailable.</p>
      ) : (
        <div className="enterprise-stack">
          {!ready && <Skeleton variant="card" label="Loading sales assignment settings" />}
          {territory.isError && (
            <SalesLeadFailure error={territory.error} retry={() => void territory.refetch()} />
          )}
          {policy.isError && (
            <SalesLeadFailure error={policy.error} retry={() => void policy.refetch()} />
          )}
          {ready && territory.data && <TerritoryForm options={territory.data} refresh={refresh} />}
          {ready && policy.data && <PolicyForm policy={policy.data} refresh={refresh} />}
          <EnterpriseSalesFollowUpSettings />
        </div>
      )}
    </main>
  );
}

function TerritoryForm({ options, refresh }: { options: Territories; refresh: () => void }) {
  const { api } = useApi();
  const [member, setMember] = useState('');
  const [community, setCommunity] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(0);
  const [notice, setNotice] = useState('');
  const receipt = useRef<Receipt>(null);
  const existing = options.territories.find(
    (item) => item.membership.id === member && (item.community?.id ?? '') === community,
  );
  const version = existing?.revision ?? 0;
  const stale = version > reviewed;

  function select(membershipId: string, communityId: string) {
    const matched = options.territories.find(
      (item) => item.membership.id === membershipId && (item.community?.id ?? '') === communityId,
    );
    setMember(membershipId);
    setCommunity(communityId);
    setReviewed(matched?.revision ?? 0);
    setCapacity(String(matched?.capacity ?? 1));
    setActive(matched?.active ?? true);
    setNotice('');
  }

  const save = useMutation({
    mutationFn: () => {
      const input = {
        membershipId: member,
        communityId: community || null,
        capacity: Number(capacity),
        active,
        reason,
      };
      receipt.current = request(receipt.current, input, reviewed);
      return api.put(
        path + '/territories',
        SalesTerritoryInput.parse({ ...input, clientRequestId: receipt.current.id }),
        {
          schema: SalesTerritory,
          ifMatch: reviewed,
        },
      );
    },
    onSuccess: (saved) => {
      setReviewed(saved.revision);
      setReason('');
      setNotice('Territory saved for ' + saved.membership.name + '.');
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });

  return (
    <section className="enterprise-panel" aria-label="Sales territories">
      <h2>Sales territories</h2>
      {notice && <p role="status">{notice}</p>}
      {!options.salespeople.length && (
        <p>Give an active team member the Salesperson role before adding territory coverage.</p>
      )}
      <form
        className="enterprise-form"
        aria-label="Save sales territory"
        onSubmit={(event) => {
          event.preventDefault();
          if (member && !stale && !save.isPending) save.mutate();
        }}
      >
        <label>
          Salesperson
          <select
            value={member}
            required
            disabled={save.isPending}
            onChange={(event) => select(event.currentTarget.value, community)}
          >
            <option value="">Choose a salesperson</option>
            {options.salespeople.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Community
          <select
            value={community}
            disabled={save.isPending}
            onChange={(event) => select(member, event.currentTarget.value)}
          >
            <option value="">Leads without a community</option>
            {options.communities.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Maximum assigned leads
          <input
            type="number"
            required
            min={1}
            max={1000}
            value={capacity}
            disabled={save.isPending}
            onChange={(event) => setCapacity(event.currentTarget.value)}
          />
        </label>
        <label className="enterprise-finance-disclosure-choice">
          <input
            type="checkbox"
            checked={active}
            disabled={save.isPending}
            onChange={(event) => setActive(event.currentTarget.checked)}
          />
          Active territory coverage
        </label>
        <label>
          Territory reason
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={reason}
            disabled={save.isPending}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </label>
        {stale && (
          <div className="enterprise-budget-adjustment" role="status">
            <p>
              Territory revision {version} has capacity {existing?.capacity} and is{' '}
              {existing?.active ? 'active' : 'inactive'}.
            </p>
            <button
              type="button"
              onClick={() => {
                setReviewed(version);
                save.reset();
              }}
            >
              Use current territory revision
            </button>
          </div>
        )}
        {save.isError && <SalesLeadFailure error={save.error} />}
        <div className="enterprise-forecast-form-actions">
          <button
            type="submit"
            disabled={!member || stale || save.isPending || reason.trim().length < 3}
          >
            Save territory
          </button>
        </div>
      </form>
      {options.territories.length > 0 && (
        <ul className="enterprise-change-history" aria-label="Saved sales territories">
          {options.territories.map((territory) => (
            <li key={territory.id}>
              <strong>
                {territory.membership.name} · {territory.community?.name ?? 'No community'}
              </strong>
              <span>
                {territory.active ? 'Active' : 'Inactive'} · Capacity {territory.capacity} ·
                Revision {territory.revision}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PolicyForm({ policy, refresh }: { policy: Policy; refresh: () => void }) {
  const { api } = useApi();
  const [draft, setDraft] = useState<{ enabled: boolean; revision: number }>();
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const receipt = useRef<Receipt>(null);
  const stale = Boolean(draft && draft.revision < policy.revision);
  const save = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error('Choose an assignment policy.');
      const input = { enabled: draft.enabled, reason };
      receipt.current = request(receipt.current, input, draft.revision);
      return api.put(
        path + '/round-robin',
        SetSalesAssignmentPolicy.parse({ ...input, clientRequestId: receipt.current.id }),
        {
          ifMatch: draft.revision,
          schema: SalesAssignmentPolicy,
        },
      );
    },
    onSuccess: (saved) => {
      setNotice('Round robin ' + (saved.enabled ? 'enabled.' : 'turned off.'));
      setDraft(undefined);
      setReason('');
      refresh();
    },
    onError: (error) => {
      if (isApiError(error) && [409, 412].includes(error.status)) refresh();
    },
  });

  return (
    <section className="enterprise-panel" aria-label="Round robin assignment">
      <h2>Round robin assignment</h2>
      <p>
        {policy.enabled ? 'On' : 'Off'} ·{' '}
        {policy.revision ? 'Revision ' + policy.revision : 'Pipeline default'}
      </p>
      <p>Active territory assignments {policy.activeTerritoryCount}</p>
      {notice && <p role="status">{notice}</p>}
      <form
        className="enterprise-form"
        aria-label="Save round robin policy"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft && !stale && !save.isPending) save.mutate();
        }}
      >
        <label className="enterprise-finance-disclosure-choice">
          <input
            type="checkbox"
            checked={draft?.enabled ?? policy.enabled}
            disabled={save.isPending || (!policy.enabled && policy.activeTerritoryCount === 0)}
            onChange={(event) =>
              setDraft({ enabled: event.currentTarget.checked, revision: policy.revision })
            }
          />
          Allow managers to assign through round robin
        </label>
        {draft && (
          <>
            <p>
              {draft.enabled
                ? 'Managers can use available capacity in the lead’s territory.'
                : 'Managers can still select an eligible salesperson directly.'}
            </p>
            <label>
              Policy reason
              <textarea
                value={reason}
                required
                minLength={3}
                maxLength={1000}
                disabled={save.isPending}
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </label>
          </>
        )}
        {stale && (
          <div className="enterprise-budget-adjustment" role="status">
            <p>
              Policy revision {policy.revision} is {policy.enabled ? 'on' : 'off'}.
            </p>
            <button
              type="button"
              onClick={() => {
                setDraft(draft ? { ...draft, revision: policy.revision } : undefined);
                save.reset();
              }}
            >
              Use current policy revision
            </button>
          </div>
        )}
        {save.isError && <SalesLeadFailure error={save.error} />}
        {draft && (
          <div className="enterprise-forecast-form-actions">
            <button type="submit" disabled={stale || save.isPending || reason.trim().length < 3}>
              Save round robin policy
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setDraft(undefined);
                setReason('');
                save.reset();
              }}
            >
              Cancel policy change
            </button>
          </div>
        )}
      </form>
      {policy.history.length > 0 && (
        <ol className="enterprise-change-history" aria-label="Round robin policy history">
          {policy.history.map((change) => (
            <li key={change.revision}>
              <strong>
                Revision {change.revision} · {change.enabled ? 'On' : 'Off'}
              </strong>
              <p>{change.reason}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
