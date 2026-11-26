'use client';

import {
  JobsiteHomeownerRecipient,
  JobsiteHomeownerShare,
  JobsiteHomeownerShareReceipt,
  JobsiteHomeownerShareView,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const ContactOption = z.object({ id: z.uuid(), displayName: z.string(), status: z.string() });
const CustomerOptions = z.object({ items: z.array(ContactOption) });
const ContactOptions = z.object({ contacts: z.array(ContactOption) });
type Share = z.infer<typeof JobsiteHomeownerShare>;
type ShareReceipt = z.infer<typeof JobsiteHomeownerShareReceipt>;
type ShareView = z.infer<typeof JobsiteHomeownerShareView>;
const shareStatus = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
  recipient_access_ended: 'Recipient access ended',
};

function shareError(error: unknown) {
  if (isApiError(error) && (error.is('validation_failed') || error.is('conflict')))
    return error.problem.detail || errorHint(error);
  return errorHint(error);
}

export function JobsiteHomeownerSharesPanel({ path }: { path: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const url = path + '/homeowner-shares';
  const key = orgKey(orgId, 'enterprise', 'homeowner-shares', path);
  const [open, setOpen] = useState(false);
  const [homeownerId, setHomeownerId] = useState('');
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('');
  const [receipt, setReceipt] = useState<ShareReceipt | null>(null);
  const [notice, setNotice] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const view = useQuery({
    queryKey: key,
    queryFn: () => api.get(url, { schema: JobsiteHomeownerShareView }),
    enabled: open,
  });

  const available = view.isSuccess ? view.data.available : [];
  const selected = available.filter(({ previewId }) => mediaIds.includes(previewId));
  const validExpiry = Number.isFinite(Date.parse(expiry));
  const active = view.isSuccess ? view.data.recipients.filter(({ active }) => active) : [];
  const canPublish =
    active.some(({ contactId }) => contactId === homeownerId) && selected.length > 0 && validExpiry;

  function refresh() {
    void client.invalidateQueries({ queryKey: key, exact: true });
  }

  const publish = useMutation({
    mutationFn: async ({ revision }: ShareView) => {
      const body = {
        homeownerId,
        mediaRevisionIds: selected.map(({ previewId }) => previewId),
        expiresAt: new Date(expiry).toISOString(),
      };
      const signature = JSON.stringify({ ...body, revision });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.post(
        url,
        { ...body, clientRequestId: request.current.id },
        {
          ifMatch: revision,
          schema: JobsiteHomeownerShareReceipt,
        },
      );
    },
    onSuccess: (saved) => {
      setReceipt(saved);
      setNotice('Homeowner gallery published.');
      setMediaIds([]);
      request.current = null;
      refresh();
    },
    onError: refresh,
  });

  function publishShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (view.data && canPublish && !publish.isPending) publish.mutate(view.data);
  }

  function onRevoked(share: Share) {
    if (receipt?.id === share.id) setReceipt(null);
    setRevoking(null);
    setNotice('Homeowner gallery revoked.');
    refresh();
  }

  return (
    <details className="enterprise-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Homeowner photo shares</summary>
      {open && view.isPending && <p role="status">Loading homeowner shares…</p>}
      {open && view.isError && (
        <div role="alert">
          <p>{errorHint(view.error)}</p>
          <button type="button" onClick={() => void view.refetch()}>
            Retry homeowner shares
          </button>
        </div>
      )}
      {open && view.isSuccess && (
        <div className="enterprise-form">
          {notice && <p role="status">{notice}</p>}
          <HomeownerRecipientEditor url={url} recipients={view.data.recipients} onSaved={refresh} />
          <form
            className="enterprise-form"
            aria-label="Publish homeowner gallery"
            onSubmit={publishShare}
          >
            <h3>Publish a gallery</h3>
            {active.length === 0 && <p>Assign a homeowner contact before publishing a gallery.</p>}
            {available.length === 0 && (
              <p>Approve a customer photo preview to include it in a gallery.</p>
            )}
            <label>
              Homeowner recipient
              <select
                value={homeownerId}
                onChange={(event) => setHomeownerId(event.currentTarget.value)}
                required
                disabled={publish.isPending}
              >
                <option value="">Choose a homeowner</option>
                {active.map(({ contactId, displayName }) => (
                  <option key={contactId} value={contactId}>
                    {displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expires at
              <input
                type="datetime-local"
                value={expiry}
                required
                disabled={publish.isPending}
                onChange={(event) => setExpiry(event.currentTarget.value)}
              />
            </label>
            {available.length > 0 && (
              <fieldset>
                <legend>Approved customer photos</legend>
                {available.map(({ previewId, filename, previewHref }) => (
                  <div key={previewId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={mediaIds.includes(previewId)}
                        disabled={
                          publish.isPending ||
                          (selected.length >= 40 && !mediaIds.includes(previewId))
                        }
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setMediaIds((previous) =>
                            checked
                              ? [...previous, previewId]
                              : previous.filter((id) => id !== previewId),
                          );
                        }}
                      />
                      {filename}
                    </label>
                    <a href={previewHref} target="_blank" rel="noreferrer">
                      Open approved preview
                    </a>
                  </div>
                ))}
              </fieldset>
            )}
            {publish.isError && <p role="alert">{shareError(publish.error)}</p>}
            <button type="submit" disabled={!canPublish || publish.isPending}>
              {publish.isPending ? 'Publishing gallery…' : 'Publish gallery'}
            </button>
          </form>
          {receipt &&
            (view.data.shares.find(({ id }) => id === receipt.id)?.status ?? 'active') ===
              'active' && (
              <section className="enterprise-form" aria-label="Published gallery link">
                <label>
                  Gallery link
                  <input
                    readOnly
                    value={receipt.galleryUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(receipt.galleryUrl).then(
                      () => setNotice('Gallery link copied.'),
                      () => setNotice('Select and copy the gallery link.'),
                    );
                  }}
                >
                  Copy gallery link
                </button>
              </section>
            )}
          {view.data.shares.length > 0 && (
            <ul aria-label="Published homeowner galleries">
              {view.data.shares.map((share) => (
                <li key={share.id}>
                  <strong>
                    {view.data.recipients.find(({ contactId }) => contactId === share.homeownerId)
                      ?.displayName ?? 'Former recipient'}
                  </strong>
                  <p>
                    {share.mediaCount} {share.mediaCount === 1 ? 'photo' : 'photos'} ·{' '}
                    {share.status === 'active'
                      ? 'Expires ' + new Date(share.expiresAt).toLocaleString()
                      : shareStatus[share.status]}
                  </p>
                  {share.status === 'active' && share.id !== revoking && (
                    <button type="button" onClick={() => setRevoking(share.id)}>
                      Revoke this gallery
                    </button>
                  )}
                  {share.id === revoking && (
                    <RevokeHomeownerShare
                      key={share.id}
                      url={url}
                      share={share}
                      onSaved={onRevoked}
                      cancel={() => setRevoking(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}

function HomeownerRecipientEditor({
  url,
  recipients,
  onSaved,
}: {
  url: string;
  recipients: ShareView['recipients'];
  onSaved: () => void;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [contactId, setContactId] = useState('');
  const [reason, setReason] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const customers = useQuery({
    queryKey: orgKey(orgId, 'enterprise', 'homeowner-eligible-customers'),
    queryFn: () => api.get('/v1/customers', { schema: CustomerOptions }),
    enabled: open,
  });
  const contacts = useQuery({
    queryKey: orgKey(orgId, 'enterprise', 'homeowner-eligible-contacts', customerId),
    queryFn: () => api.get('/v1/customers/' + customerId, { schema: ContactOptions }),
    enabled: open && !!customerId,
  });
  const current = recipients.find((item) => item.contactId === contactId);
  const change = useMutation({
    mutationFn: () => {
      const revision = current?.revision ?? 0;
      const active = !current?.active;
      const signature = JSON.stringify({ active, contactId, revision, reason });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.put(
        url + '/recipients/' + contactId,
        { active, reason: reason.trim(), clientRequestId: request.current.id },
        {
          ifMatch: revision,
          schema: JobsiteHomeownerRecipient,
        },
      );
    },
    onSuccess: () => {
      setReason('');
      request.current = null;
      onSaved();
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) onSaved();
    },
  });

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Homeowner contact access</summary>
      {open && (
        <form
          className="enterprise-form"
          aria-label="Homeowner contact assignment"
          onSubmit={(event) => {
            event.preventDefault();
            if (contactId && reason.trim().length >= 3 && !change.isPending) change.mutate();
          }}
        >
          <label>
            CRM customer
            <select
              value={customerId}
              required
              disabled={change.isPending}
              onChange={(event) => {
                setCustomerId(event.currentTarget.value);
                setContactId('');
              }}
            >
              <option value="">Choose a customer</option>
              {customers.data?.items
                .filter(({ status }) => status === 'active')
                .map(({ id, displayName }) => (
                  <option key={id} value={id}>
                    {displayName}
                  </option>
                ))}
            </select>
          </label>
          {customerId && (
            <label>
              CRM contact
              <select
                value={contactId}
                required
                disabled={change.isPending}
                onChange={(event) => setContactId(event.currentTarget.value)}
              >
                <option value="">Choose a contact</option>
                {contacts.data?.contacts
                  .filter(({ status }) => status === 'active')
                  .map(({ id, displayName }) => (
                    <option key={id} value={id}>
                      {displayName}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {(customers.isError || contacts.isError) && (
            <p role="alert">{errorHint(customers.error ?? contacts.error)}</p>
          )}
          {change.isError && <p role="alert">{shareError(change.error)}</p>}
          <label>
            Contact access reason
            <input
              value={reason}
              minLength={3}
              maxLength={500}
              required
              disabled={change.isPending}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
          </label>
          <button
            type="submit"
            disabled={!contactId || reason.trim().length < 3 || change.isPending}
          >
            {current?.active ? 'End gallery access' : 'Grant gallery access'}
          </button>
          {contactId && (
            <p role="status">
              {current?.active ? 'Project gallery access granted' : 'Project gallery access off'}
            </p>
          )}
        </form>
      )}
    </details>
  );
}

function RevokeHomeownerShare({
  url,
  share,
  onSaved,
  cancel,
}: {
  url: string;
  share: Share;
  onSaved: (share: Share) => void;
  cancel: () => void;
}) {
  const { api } = useApi();
  const [reason, setReason] = useState('');
  const request = useRef<{ reason: string; id: string } | null>(null);
  const revoke = useMutation({
    mutationFn: () => {
      const note = reason.trim();
      if (request.current?.reason !== note)
        request.current = { reason: note, id: crypto.randomUUID() };
      return api.post(
        url + '/' + share.id + '/revoke',
        {
          reason: note,
          clientRequestId: request.current.id,
        },
        { ifMatch: share.revision, schema: JobsiteHomeownerShare },
      );
    },
    onSuccess: onSaved,
  });
  return (
    <form
      className="enterprise-form"
      aria-label="Revoke homeowner gallery"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length >= 3 && !revoke.isPending) revoke.mutate();
      }}
    >
      <label>
        Revocation reason
        <input
          value={reason}
          minLength={3}
          maxLength={500}
          required
          disabled={revoke.isPending}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </label>
      {revoke.isError && <p role="alert">{shareError(revoke.error)}</p>}
      <button type="submit" disabled={reason.trim().length < 3 || revoke.isPending}>
        Confirm revocation
      </button>
      <button type="button" disabled={revoke.isPending} onClick={cancel}>
        Cancel revocation
      </button>
    </form>
  );
}
