'use client';

import {
  CreateEnterpriseSalesLead,
  CreateEnterpriseSalesLeadSource,
  EnterpriseSalesLead,
  EnterpriseSalesLeadInput,
  EnterpriseSalesLeadOptions,
  EnterpriseSalesLeadPage,
  EnterpriseSalesLeadPreview,
  EnterpriseSalesLeadSource,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const path = '/v1/enterprise/sales/leads';
type Options = z.infer<typeof EnterpriseSalesLeadOptions>;
type Lead = z.infer<typeof EnterpriseSalesLead>;
const channels = ['email', 'phone'] as const;
const purposes = ['inquiry', 'marketing'] as const;

function Failure({ error, retry }: { error: unknown; retry?: () => void }) {
  if (isApiError(error) && [401, 403, 404].includes(error.status) && !error.problem.detail)
    return <p role="alert">Sales leads are unavailable.</p>;
  return (
    <div role="alert" className="enterprise-budget-adjustment">
      <p>{isApiError(error) ? (error.problem.detail ?? errorHint(error)) : errorHint(error)}</p>
      {isApiError(error) && <p>Support reference {error.correlationId}</p>}
      {retry && (
        <button type="button" onClick={retry}>
          Retry sales leads
        </button>
      )}
    </div>
  );
}

export function EnterpriseSalesLeads() {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'sales-leads');
  const options = useQuery({
    queryKey: [...key, 'options'],
    queryFn: () => api.get(path + '/options', { schema: EnterpriseSalesLeadOptions }),
    refetchOnMount: 'always',
  });
  const list = useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { schema: EnterpriseSalesLeadPage, query: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
  });
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<Lead>();
  const allowed = options.isSuccess && !(options.isFetching && !options.isFetchedAfterMount);
  const denied = [options.error, list.error].some(
    (error) => isApiError(error) && [401, 403, 404].includes(error.status),
  );
  const items =
    denied || (list.isFetching && !list.isFetchedAfterMount)
      ? []
      : (list.data?.pages.flatMap(({ items: page }) => page) ?? []);
  const company = session.me.memberships.find(
    ({ orgId }) => orgId === session.orgId,
  )?.orgDisplayName;

  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link href="/enterprise" className="enterprise-back">
          ← Enterprise Suite
        </Link>
        <h1>Sales leads</h1>
        {!denied && allowed && company && <p>{company}</p>}
      </header>
      {denied ? (
        <p role="alert">Sales leads are unavailable.</p>
      ) : (
        <div className="enterprise-stack">
          {!allowed && !options.isError && (
            <Skeleton variant="card" label="Loading lead intake options" />
          )}
          {options.isError && (
            <Failure error={options.error} retry={() => void options.refetch()} />
          )}
          {allowed && options.data && (
            <section className="enterprise-panel" aria-label="Lead intake">
              <h2>Lead intake</h2>
              {saved && (
                <p role="status">
                  Lead saved for {saved.name}. Revision {saved.revision}.
                </p>
              )}
              {options.data.sources.length === 0 && (
                <p>Add a company lead source before recording an intake.</p>
              )}
              {session.can('enterprise_sales:manage') && (
                <ManageLeadSource
                  onSaved={() => void client.invalidateQueries({ queryKey: [...key, 'options'] })}
                />
              )}
              {options.data.sources.length > 0 &&
                (editing ? (
                  <LeadIntakeForm
                    options={options.data}
                    onCancel={() => setEditing(false)}
                    onSaved={(value) => {
                      setEditing(false);
                      setSaved(value);
                      void client.invalidateQueries({ queryKey: [...key, 'list'] });
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(undefined);
                      setEditing(true);
                    }}
                  >
                    Create lead
                  </button>
                ))}
            </section>
          )}
          <section className="enterprise-panel" aria-label="Recorded leads">
            <h2>Recorded leads</h2>
            {list.isPending && <Skeleton variant="card" label="Loading sales leads" />}
            {list.isError && (
              <Failure
                error={list.error}
                retry={() => {
                  void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch());
                }}
              />
            )}
            {list.isFetchedAfterMount && list.isSuccess && items.length === 0 && (
              <p>No leads are visible to your role yet.</p>
            )}
            <ol className="enterprise-change-history">
              {items.map((lead) => (
                <li key={lead.id}>
                  <strong>{lead.name}</strong>
                  <span>
                    {lead.source.name}
                    {lead.community && ' · ' + lead.community.name} · Revision {lead.revision}
                  </span>
                  {lead.possibleDuplicate && <span>Possible duplicate</span>}
                  <span>
                    Inquiry contact {lead.permittedInquiryChannels.join(', ') || 'restricted'}
                  </span>
                  <span>
                    Marketing contact {lead.permittedMarketingChannels.join(', ') || 'restricted'}
                  </span>
                </li>
              ))}
            </ol>
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more leads
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ManageLeadSource({ onSaved }: { onSaved: () => void }) {
  const { api } = useApi();
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: (name: FormDataEntryValue | null) =>
      api.post(path + '/sources', CreateEnterpriseSalesLeadSource.parse({ name }), {
        schema: EnterpriseSalesLeadSource,
      }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Add lead source
      </button>
    );
  return (
    <form
      className="enterprise-form"
      aria-label="Add lead source"
      onSubmit={(event) => {
        event.preventDefault();
        if (!save.isPending) save.mutate(new FormData(event.currentTarget).get('name'));
      }}
    >
      <label>
        Lead source name
        <input name="name" required maxLength={200} disabled={save.isPending} />
      </label>
      <div className="enterprise-forecast-form-actions">
        <button type="submit" disabled={save.isPending}>
          Save source
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => {
            setOpen(false);
            save.reset();
          }}
        >
          Cancel source
        </button>
      </div>
      {save.isError && <Failure error={save.error} />}
    </form>
  );
}

function LeadIntakeForm({
  options,
  onCancel,
  onSaved,
}: {
  options: Options;
  onCancel: () => void;
  onSaved: (lead: Lead) => void;
}) {
  const { api } = useApi();
  const receipt = useRef<{ signature: string; id: string } | null>(null);
  const [separate, setSeparate] = useState(false);
  const preview = useMutation({
    mutationFn: (body: z.infer<typeof EnterpriseSalesLeadInput>) =>
      api.post(path + '/preview', body, { schema: EnterpriseSalesLeadPreview }),
  });
  const create = useMutation({
    mutationFn: (body: z.infer<typeof CreateEnterpriseSalesLead>) =>
      api.post(path, body, { ifMatch: 0, schema: EnterpriseSalesLead }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.status === 412) preview.reset();
    },
  });
  const [validationError, setValidationError] = useState('');
  const busy = preview.isPending || create.isPending;
  function edit() {
    preview.reset();
    create.reset();
    setSeparate(false);
    setValidationError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const field = (key: string) => String(data.get(key) ?? '').trim();
    const choices = (purpose: (typeof purposes)[number]) =>
      Object.fromEntries(channels.map((channel) => [channel, field(purpose + '-' + channel)]));
    const input = EnterpriseSalesLeadInput.safeParse({
      name: field('name'),
      sourceId: field('sourceId'),
      email: field('email') || undefined,
      phone: field('phone') || undefined,
      communityId: field('communityId') || undefined,
      contactMethod: field('contactMethod'),
      consent: { inquiry: choices('inquiry'), marketing: choices('marketing') },
    });
    if (!input.success) {
      setValidationError(input.error.issues[0]?.message ?? 'Review lead intake fields.');
      return;
    }
    if (!preview.data) {
      preview.mutate(input.data);
      return;
    }
    if (preview.data.possibleDuplicate && !separate) return;
    const inboundEventId = field('inboundEventId') || undefined;
    const signature = JSON.stringify([input.data, inboundEventId]);
    if (receipt.current?.signature !== signature)
      receipt.current = { signature, id: crypto.randomUUID() };
    const body = CreateEnterpriseSalesLead.parse({
      ...input.data,
      inboundEventId,
      clientRequestId: receipt.current.id,
      previewFingerprint: preview.data.previewFingerprint,
      confirmSeparateLead: separate,
    });
    create.mutate(body);
  }

  return (
    <form className="enterprise-form" aria-label="Create sales lead" onSubmit={submit}>
      <label>
        Lead name
        <input name="name" required maxLength={200} disabled={busy} onChange={edit} />
      </label>
      <label>
        Lead source
        <select name="sourceId" required disabled={busy} onChange={edit}>
          <option value="">Choose a source</option>
          {options.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Email
        <input type="email" name="email" maxLength={254} disabled={busy} onChange={edit} />
      </label>
      <label>
        Phone
        <input type="tel" name="phone" maxLength={32} disabled={busy} onChange={edit} />
      </label>
      <label>
        Preferred contact method
        <select name="contactMethod" disabled={busy} onChange={edit}>
          <option value="none">No preference recorded</option>
          <option value="email">Email</option>
          <option value="phone">Phone</option>
        </select>
      </label>
      <label>
        Desired community
        <select name="communityId" disabled={busy} onChange={edit}>
          <option value="">No community selected</option>
          {options.communities.map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>
      </label>
      {purposes.map((purpose) => (
        <fieldset key={purpose} className="enterprise-budget-adjustment" disabled={busy}>
          <legend>{purpose === 'inquiry' ? 'Inquiry follow-up' : 'Marketing consent'}</legend>
          {channels.map((channel) => (
            <label key={channel}>
              {purpose === 'inquiry' ? 'Inquiry' : 'Marketing'} {channel} consent
              <select name={purpose + '-' + channel} onChange={edit}>
                <option value="not_recorded">Not recorded</option>
                <option value="granted">Granted</option>
                <option value="declined">Declined</option>
              </select>
            </label>
          ))}
        </fieldset>
      ))}
      <label>
        Inbound form event reference
        <input name="inboundEventId" maxLength={160} disabled={busy} onChange={edit} />
      </label>
      {preview.data && (
        <section className="enterprise-budget-adjustment" aria-label="Lead intake review">
          <h3>Lead intake review</h3>
          <p>Inquiry contact {preview.data.permittedInquiryChannels.join(', ') || 'restricted'}</p>
          <p>
            Marketing contact {preview.data.permittedMarketingChannels.join(', ') || 'restricted'}
          </p>
          {preview.data.possibleDuplicate && (
            <>
              <h4>Possible duplicate records</h4>
              <ul>
                {preview.data.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>{candidate.name}</li>
                ))}
              </ul>
              <label className="enterprise-finance-disclosure-choice">
                <input
                  type="checkbox"
                  checked={separate}
                  disabled={busy}
                  onChange={(event) => setSeparate(event.currentTarget.checked)}
                />
                Record a separate lead after reviewing the possible duplicate
              </label>
            </>
          )}
        </section>
      )}
      {validationError && <p role="alert">{validationError}</p>}
      {preview.isError && <Failure error={preview.error} />}
      {create.isError && <Failure error={create.error} />}
      <div className="enterprise-forecast-form-actions">
        <button
          type="submit"
          disabled={busy || Boolean(preview.data?.possibleDuplicate && !separate)}
        >
          {preview.data ? 'Save lead' : 'Review lead'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel lead
        </button>
      </div>
    </form>
  );
}
