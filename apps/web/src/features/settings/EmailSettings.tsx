'use client';

// Settings > Email: connect your own Gmail or Outlook so invoices are emailed from your address,
// with the PDF attached, as soon as they are sent. Sign-in happens on Google's or Microsoft's own
// page in this same tab (never a pop-up or new window); the tokens are kept by the separate mail
// server and never reach this browser or the Field Pro database.
import {
  MAILBOX_LIMIT,
  MAILBOX_PROVIDER_LABEL,
  MAILBOX_PROVIDERS,
  mailboxId,
  type Mailbox,
  type MailboxList,
  type MailboxProvider,
  type MeResponse,
} from '@fieldline/contracts';
import { Button, Skeleton, StatusPill, useToast } from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { useDisplay } from '../../lib/display';
import { formatDate } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';

const PROVIDER_HELP: Record<MailboxProvider, string> = {
  gmail: 'Any Google account: @gmail.com or Google Workspace.',
  outlook: 'Work or school Microsoft 365, and personal Outlook.com, Hotmail and Live accounts.',
};

/** Why a sign-in came back without a connection (the mail server adds ?mailbox=error&reason=). */
export const CONNECT_ERRORS: Record<string, string> = {
  declined: 'Sign-in was cancelled, so nothing was connected.',
  missing_permission:
    'The "send email on your behalf" permission was unticked on the consent screen. Connect again and leave it ticked.',
  expired: 'That sign-in link expired. Start again from this page.',
  state_mismatch: 'That sign-in could not be verified. Start again from this page.',
  not_configured:
    'This provider is not set up on the mail server yet. Add its app keys (see docs/email-sending.md).',
  provider_error: 'The provider did not finish the sign-in. Try again in a minute.',
  bad_link: 'That sign-in link was incomplete. Start again from this page.',
};

export type ConnectOutcome =
  | { kind: 'confirm'; provider: MailboxProvider | null; pending: string }
  | { kind: 'message'; tone: 'success' | 'danger'; message: string };

export function providerLabel(provider: string | null): string {
  return provider && provider in MAILBOX_PROVIDER_LABEL
    ? MAILBOX_PROVIDER_LABEL[provider as MailboxProvider]
    : 'Mailbox';
}

/**
 * Reads what the mail server put in the URL after Google / Microsoft sign-in. A finished sign-in
 * comes back as `mailbox=confirm&pending=...`: this page then confirms it with the signed-in
 * session, so a connect link opened by someone else never attaches their mailbox to this account.
 */
export function connectResult(search: string): ConnectOutcome | null {
  const params = new URLSearchParams(search);
  const outcome = params.get('mailbox');
  if (!outcome) return null;
  const provider = params.get('provider');
  const pending = params.get('pending');
  if (outcome === 'confirm' && pending) {
    return {
      kind: 'confirm',
      provider:
        provider && provider in MAILBOX_PROVIDER_LABEL ? (provider as MailboxProvider) : null,
      pending,
    };
  }
  return {
    kind: 'message',
    tone: 'danger',
    message: CONNECT_ERRORS[params.get('reason') ?? ''] ?? CONNECT_ERRORS.provider_error!,
  };
}

const GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const MICROSOFT_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);

export interface MailboxSuggestion {
  provider: MailboxProvider;
  email: string;
  /** Why it is suggested, e.g. "You signed in with Google as ...". */
  reason: string;
}

/**
 * The mailbox to offer in one click: the Gmail or Outlook address this person signed in with (or,
 * for a username sign-in, their account email when it is plainly a Gmail or Outlook address).
 * Null when it is already connected, its provider is not set up, or nothing fits.
 */
export function suggestMailbox(me: MeResponse, list: MailboxList): MailboxSuggestion | null {
  if (!list.available) return null;
  const method = me.signIn?.method ?? null;
  const email = (me.signIn?.email ?? me.user.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) return null;
  const domain = email.slice(email.lastIndexOf('@') + 1);
  let provider: MailboxProvider | null = null;
  let reason = '';
  if (method === 'google') {
    provider = 'gmail';
    reason = `You signed in with Google as ${email}.`;
  } else if (method === 'microsoft') {
    provider = 'outlook';
    reason = `You signed in with Microsoft as ${email}.`;
  } else if (GOOGLE_DOMAINS.has(domain)) {
    provider = 'gmail';
    reason = `Your account email is ${email}.`;
  } else if (MICROSOFT_DOMAINS.has(domain)) {
    provider = 'outlook';
    reason = `Your account email is ${email}.`;
  }
  if (!provider || !list.providers[provider]) return null;
  if (list.items.some((m) => m.id === mailboxId(provider, email))) return null;
  return { provider, email, reason };
}

export function EmailSettings() {
  return (
    <RouteGate routeId="settings.email">
      <PageHeader
        title="Email sending"
        description="Connect one or more of your own Gmail or Outlook addresses. When you send an invoice, Field Pro emails it from the address you choose, with the PDF attached."
      />
      <MailboxPanel />
    </RouteGate>
  );
}

function MailboxPanel() {
  const { endpoints } = useApi();
  const session = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = orgKey(session.orgId, 'mailboxes');
  const mailboxes = useQuery({ queryKey: key, queryFn: () => endpoints.mailboxes() });

  const update = (list: MailboxList) => queryClient.setQueryData(key, list);
  const finish = useMutation({
    mutationFn: (outcome: { pending: string; provider: MailboxProvider | null }) =>
      endpoints.confirmMailbox(outcome.pending),
    onSuccess: (list, outcome) => {
      update(list);
      toast.show({
        tone: 'success',
        message: `${providerLabel(outcome.provider)} connected. Choose it when you send an invoice, or make it the default.`,
      });
    },
    onError: (error) => toast.show({ tone: 'danger', message: problemText(error) }),
  });

  useEffect(() => {
    const result = connectResult(window.location.search);
    if (!result) return;
    // Clear the URL first so a refresh (or a second effect run) does not repeat it.
    window.history.replaceState(null, '', window.location.pathname);
    if (result.kind === 'confirm') {
      finish.mutate({ pending: result.pending, provider: result.provider });
    } else {
      toast.show({ tone: result.tone, message: result.message });
    }
    // Runs once, for the redirect that brought the person back here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useMutation({
    mutationFn: (input: { provider: MailboxProvider; loginHint?: string | null }) =>
      endpoints.connectMailbox(input.provider, input.loginHint ?? null),
    // Same tab, full-page: Google / Microsoft sign-in, then back to this page.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.show({ tone: 'danger', message: problemText(error) }),
  });
  const makeDefault = useMutation({
    mutationFn: (mailbox: Mailbox) => endpoints.setDefaultMailbox(mailbox.id),
    onSuccess: (list, mailbox) => {
      update(list);
      toast.show({ tone: 'success', message: `Invoices now go out from ${mailbox.email}.` });
    },
    onError: (error) => toast.show({ tone: 'danger', message: problemText(error) }),
  });
  const disconnect = useMutation({
    mutationFn: (mailbox: Mailbox) => endpoints.disconnectMailbox(mailbox.id),
    onSuccess: (list, mailbox) => {
      update(list);
      toast.show({ tone: 'success', message: `${mailbox.email} disconnected.` });
    },
    onError: (error) => toast.show({ tone: 'danger', message: problemText(error) }),
  });

  if (mailboxes.isPending) return <Skeleton label="Loading connected mailboxes" />;
  if (mailboxes.error) {
    return (
      <ErrorNotice
        error={mailboxes.error}
        title="Connected mailboxes could not be loaded"
        onRetry={() => void mailboxes.refetch()}
      />
    );
  }
  const list = mailboxes.data;
  const busy =
    finish.isPending || connect.isPending || makeDefault.isPending || disconnect.isPending;
  const full = list.items.length >= MAILBOX_LIMIT;
  const suggestion = suggestMailbox(session.me, list);

  return (
    <>
      {!list.available && (
        <p className="web-card" role="status">
          Email sending is not switched on for this server yet. An administrator sets MAILER_URL and
          MAILER_SHARED_SECRET on the API and starts the mail server (docs/email-sending.md).
        </p>
      )}
      {suggestion && !full && (
        <section className="web-card" aria-label="Suggested mailbox">
          <h2>Send invoices from {suggestion.email}</h2>
          <p className="web-muted">
            {suggestion.reason} Connect this {MAILBOX_PROVIDER_LABEL[suggestion.provider]} address
            and invoices go out from it. {MAILBOX_PROVIDER_LABEL[suggestion.provider]} asks you once
            to allow sending.
          </p>
          <Button
            onClick={() =>
              connect.mutate({ provider: suggestion.provider, loginHint: suggestion.email })
            }
            disabled={busy}
          >
            Use {suggestion.email}
          </Button>
        </section>
      )}
      <section className="web-section" aria-label="Mailboxes">
        <div className="cc-work-board__cards">
          {MAILBOX_PROVIDERS.map((provider) => (
            <ProviderCard
              key={provider}
              provider={provider}
              mailboxes={list.items.filter((m) => m.provider === provider)}
              configured={list.available && list.providers[provider]}
              full={full}
              busy={busy}
              onConnect={(loginHint) => connect.mutate({ provider, loginHint })}
              onDefault={(mailbox) => makeDefault.mutate(mailbox)}
              onDisconnect={(mailbox) => disconnect.mutate(mailbox)}
            />
          ))}
        </div>
      </section>
      <section className="web-card">
        <h2>What Field Pro can do with your mailbox</h2>
        <ul>
          <li>Send invoice emails from your address. Each one is saved in your Sent folder.</li>
          <li>It asks only for permission to send. It cannot read, delete or search your email.</li>
          <li>
            You can connect up to {MAILBOX_LIMIT} addresses, for example a personal Gmail and a
            company Outlook, and pick one on each invoice. The default is used when you do not pick.
          </li>
          <li>
            Each address belongs to one person. If a teammate already connected an address, it
            cannot be connected to your account too.
          </li>
          <li>
            The account you sign in to Field Pro with and the mailboxes you send from are separate.
            Signing in with Google does not send email until you connect that Gmail here.
          </li>
          <li>
            Disconnecting deletes the stored sign-in. For Gmail it is also revoked at Google; for
            Microsoft you can remove the app at account.live.com/consent/Manage or
            myapps.microsoft.com.
          </li>
        </ul>
      </section>
    </>
  );
}

/** The API's own message when it gave one (for example "already connected by another member"). */
function problemText(error: unknown): string {
  const detail = (error as { problem?: { detail?: unknown } } | null)?.problem?.detail;
  return typeof detail === 'string' && detail ? detail : errorHint(error);
}

function ProviderCard({
  provider,
  mailboxes,
  configured,
  full,
  busy,
  onConnect,
  onDefault,
  onDisconnect,
}: {
  provider: MailboxProvider;
  mailboxes: Mailbox[];
  configured: boolean;
  full: boolean;
  busy: boolean;
  onConnect: (loginHint: string | null) => void;
  onDefault: (mailbox: Mailbox) => void;
  onDisconnect: (mailbox: Mailbox) => void;
}) {
  const display = useDisplay();
  const label = MAILBOX_PROVIDER_LABEL[provider];
  return (
    <article className="web-card" aria-label={label}>
      <h2>{label}</h2>
      <p className="web-muted web-small">{PROVIDER_HELP[provider]}</p>
      {mailboxes.length === 0 && (
        <p className="web-muted">
          {configured ? 'Not connected.' : 'Not set up on the mail server yet.'}
        </p>
      )}
      {mailboxes.length > 0 && (
        <ul className="web-mailbox-list" aria-label={`Connected ${label} addresses`}>
          {mailboxes.map((mailbox) => (
            <li key={mailbox.id}>
              <p>
                <strong style={{ overflowWrap: 'anywhere' }}>{mailbox.email}</strong>{' '}
                {mailbox.isDefault && (
                  <StatusPill status="default" label="Default" tone="info" size="sm" />
                )}
              </p>
              <p className="web-muted web-small">
                Connected {formatDate(mailbox.connectedAt, display.locale, display.timeZone)}
                {mailbox.isDefault
                  ? ' · invoices go out from this address unless you pick another'
                  : ''}
              </p>
              <div className="cc-work-board__links">
                {!mailbox.isDefault && (
                  <Button size="sm" onClick={() => onDefault(mailbox)} disabled={busy}>
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onConnect(mailbox.email)}
                  disabled={busy || !configured}
                >
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onDisconnect(mailbox)}
                  disabled={busy}
                >
                  Disconnect
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant={mailboxes.length ? 'secondary' : 'primary'}
        onClick={() => onConnect(null)}
        disabled={busy || !configured || full}
      >
        {mailboxes.length ? `Add another ${label} address` : `Connect ${label}`}
      </Button>
      {full && (
        <p className="web-muted web-small">
          You have {MAILBOX_LIMIT} mailboxes connected. Disconnect one to add another.
        </p>
      )}
    </article>
  );
}
