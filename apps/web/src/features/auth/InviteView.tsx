'use client';

import { BRAND, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@fieldline/contracts';
import { Button, Skeleton } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ButtonLink, ErrorNotice } from '../../components/common';
import { isApiError, newIdempotencyKey } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useApi, useMe, useSwitchWorkspace } from '../../lib/session';

/**
 * PLT-013 B / PLT-015 B invitation acceptance. The invitee signs in first (identity is the
 * provider subject, never the email), sees which company and role they were invited to, and
 * accepts explicitly. Accepting uses one Idempotency-Key per page view, so a double tap or a
 * retried request cannot create two memberships.
 */
export function InviteView({ token }: { token: string }) {
  const { endpoints } = useApi();
  const me = useMe();
  const switchWorkspace = useSwitchWorkspace();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => endpoints.invitationPreview(token),
    enabled: Boolean(me.data),
    retry: false,
  });

  const header = (
    <>
      <p className="web-brand web-brand--large">{BRAND.name}</p>
      <h1>Company invitation</h1>
    </>
  );

  if (me.isPending || (me.data && preview.isPending)) {
    return (
      <Frame>
        {header}
        <Skeleton label="Checking your invitation" />
      </Frame>
    );
  }
  if (me.error) {
    // Unauthenticated users are redirected to sign-in (with this page as returnTo) by the client.
    return (
      <Frame>
        {header}
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      </Frame>
    );
  }
  if (preview.error) {
    const gone =
      isApiError(preview.error) && (preview.error.is('not_found') || preview.error.status === 410);
    return (
      <Frame>
        {header}
        {gone ? (
          <>
            <p role="alert">
              This invitation link is no longer valid. It may have expired, been revoked, or already
              been used.
            </p>
            <p>
              Ask the person who invited you to send a new invitation. Invitations are tied to the
              company, so a new link is safe to request.
            </p>
            <ButtonLink href="/" variant="secondary">
              Go to {BRAND.name}
            </ButtonLink>
          </>
        ) : (
          <ErrorNotice error={preview.error} onRetry={() => void preview.refetch()} />
        )}
      </Frame>
    );
  }

  const invitation = preview.data!;
  const usable = invitation.status === 'pending';
  return (
    <Frame>
      {header}
      <p>
        You were invited to join <strong>{invitation.orgDisplayName}</strong>
        {invitation.invitedByName ? ` by ${invitation.invitedByName}` : ''} as{' '}
        <strong>{ROLE_LABELS[invitation.role]}</strong>.
      </p>
      <p className="web-muted">{ROLE_DESCRIPTIONS[invitation.role]}</p>
      <p className="web-muted web-small">
        Signed in as {me.data.user.displayName}
        {me.data.user.email ? ` (${me.data.user.email})` : ''}. Expires{' '}
        {formatDateTime(invitation.expiresAt, me.data.user.locale || 'en-US')}.
      </p>
      {!usable ? (
        <p role="alert">
          This invitation is {invitation.status}. Ask the company for a new invitation.
        </p>
      ) : (
        <div className="web-actions">
          <Button
            loading={accepting}
            onClick={async () => {
              setAccepting(true);
              setError(null);
              try {
                const membership = await endpoints.acceptInvitation(token, idempotencyKey);
                await switchWorkspace(membership.orgId, '/');
              } catch (e) {
                setError(e);
                setAccepting(false);
              }
            }}
          >
            Accept and join {invitation.orgDisplayName}
          </Button>
          <ButtonLink href="/" variant="ghost">
            Not now
          </ButtonLink>
        </div>
      )}
      {error !== null && <ErrorNotice error={error} title="The invitation could not be accepted" />}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">{children}</div>
    </main>
  );
}
