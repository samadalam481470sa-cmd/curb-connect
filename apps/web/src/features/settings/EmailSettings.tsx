'use client';

// Settings > Email: connect your own Gmail or Outlook so invoices are emailed from your address,
// with the PDF attached, as soon as they are sent. Sign-in happens on Google's or Microsoft's own
// page in this same tab (never a pop-up or new window); the tokens are kept by the separate mail
// server and never reach this browser or the Field Pro database.
import {
  MAILBOX_PROVIDER_LABEL,
  MAILBOX_PROVIDERS,
  type Mailbox,
  type MailboxList,
  type MailboxProvider,
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

export function EmailSettings() {
  return (
    <RouteGate routeId="settings.email">
      <PageHeader
        title="Email sending"
        description="Connect your own Gmail or Outlook. When you send an invoice, Field Pro emails it from that address with the PDF attached."
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
        message: `${providerLabel(outcome.provider)} connected. Invoices you send will be emailed from it.`,
      });
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
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
    mutationFn: (provider: MailboxProvider) => endpoints.connectMailbox(provider),
    // Same tab, full-page: Google / Microsoft sign-in, then back to this page.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });
  const makeDefault = useMutation({
    mutationFn: (provider: MailboxProvider) => endpoints.setDefaultMailbox(provider),
    onSuccess: (list) => {
      update(list);
      toast.show({ tone: 'success', message: 'Default mailbox updated.' });
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });
  const disconnect = useMutation({
    mutationFn: (provider: MailboxProvider) => endpoints.disconnectMailbox(provider),
    onSuccess: (list, provider) => {
      update(list);
      toast.show({ tone: 'success', message: `${MAILBOX_PROVIDER_LABEL[provider]} disconnected.` });
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
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

  return (
    <>
      {!list.available && (
        <p className="web-card" role="status">
          Email sending is not switched on for this server yet. An administrator sets MAILER_URL and
          MAILER_SHARED_SECRET on the API and starts the mail server (docs/email-sending.md).
        </p>
      )}
      <section className="web-section" aria-label="Mailboxes">
        <div className="cc-work-board__cards">
          {MAILBOX_PROVIDERS.map((provider) => (
            <MailboxCard
              key={provider}
              provider={provider}
              mailbox={list.items.find((m) => m.provider === provider) ?? null}
              configured={list.available && list.providers[provider]}
              busy={busy}
              onConnect={() => connect.mutate(provider)}
              onDefault={() => makeDefault.mutate(provider)}
              onDisconnect={() => disconnect.mutate(provider)}
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
            Disconnecting deletes the stored sign-in. For Gmail it is also revoked at Google; for
            Microsoft you can remove the app at account.live.com/consent/Manage or
            myapps.microsoft.com.
          </li>
          <li>Your connection is personal: teammates connect their own mailbox.</li>
        </ul>
      </section>
    </>
  );
}

function MailboxCard({
  provider,
  mailbox,
  configured,
  busy,
  onConnect,
  onDefault,
  onDisconnect,
}: {
  provider: MailboxProvider;
  mailbox: Mailbox | null;
  configured: boolean;
  busy: boolean;
  onConnect: () => void;
  onDefault: () => void;
  onDisconnect: () => void;
}) {
  const display = useDisplay();
  const label = MAILBOX_PROVIDER_LABEL[provider];
  return (
    <article className="web-card" aria-label={label}>
      <h2>{label}</h2>
      <p className="web-muted web-small">{PROVIDER_HELP[provider]}</p>
      {mailbox ? (
        <>
          <p>
            <strong style={{ overflowWrap: 'anywhere' }}>{mailbox.email}</strong>{' '}
            {mailbox.isDefault && (
              <StatusPill status="default" label="Default" tone="info" size="sm" />
            )}
          </p>
          <p className="web-muted web-small">
            Connected {formatDate(mailbox.connectedAt, display.locale, display.timeZone)}
            {mailbox.isDefault ? ' · invoices are sent from this mailbox' : ''}
          </p>
          <div className="cc-work-board__links">
            {!mailbox.isDefault && (
              <Button size="sm" onClick={onDefault} disabled={busy}>
                Send invoices from this one
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              onClick={onConnect}
              disabled={busy || !configured}
            >
              Reconnect
            </Button>
            <Button size="sm" variant="secondary" onClick={onDisconnect} disabled={busy}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="web-muted">
            {configured ? 'Not connected.' : 'Not set up on the mail server yet.'}
          </p>
          <Button onClick={onConnect} disabled={busy || !configured}>
            Connect {label}
          </Button>
        </>
      )}
    </article>
  );
}
