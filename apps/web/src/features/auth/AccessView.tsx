'use client';

import { BRAND } from '@fieldline/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { ButtonLink } from '../../components/common';
import { clearShellCaches } from '../../lib/pwa';
import { safeReturnTo } from '../../lib/routing';

const COPY: Record<string, { title: string; body: string }> = {
  expired: {
    title: 'Your session ended',
    body: 'For your security you were signed out after a period of inactivity or because the session reached its time limit. Drafts saved on this device are kept and will be available after you sign in again.',
  },
  revoked: {
    title: 'Your access to this company was removed',
    body: 'An owner or admin changed your role or removed your membership. If you belong to another company you can switch to it; otherwise ask an owner or admin of this company to restore your access.',
  },
  forbidden: {
    title: 'You do not have access to this page',
    body: 'Your role does not allow this area. Ask an owner or admin if you need it.',
  },
};

/**
 * PLT-011 S recovery page for an expired session or a revoked role. It deliberately renders no
 * tenant data: it clears the in-memory query cache and the service worker caches on arrival and
 * never reads /v1/me or any other record, so nothing sensitive can be shown from cache.
 */
export function AccessView() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const reason = params.get('reason') ?? 'expired';
  const returnTo = safeReturnTo(params.get('returnTo'));
  const copy = COPY[reason] ?? COPY.expired!;

  useEffect(() => {
    queryClient.clear();
    void clearShellCaches();
  }, [queryClient]);

  const signInHref = `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="web-actions">
          {reason === 'revoked' ? (
            <>
              <ButtonLink href="/select-workspace">Choose another workspace</ButtonLink>
              <ButtonLink href={signInHref} variant="secondary">
                Sign in with a different account
              </ButtonLink>
            </>
          ) : reason === 'forbidden' ? (
            <ButtonLink href="/">Go to Home</ButtonLink>
          ) : (
            <ButtonLink href={signInHref}>Sign in again</ButtonLink>
          )}
        </div>
      </div>
    </main>
  );
}
