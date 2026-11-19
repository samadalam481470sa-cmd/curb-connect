'use client';

import { BRAND, LEGAL } from '@fieldline/contracts';
import { Skeleton } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { ErrorNotice } from '../../components/common';
import { API_PATHS, orderProviders, type AuthProvider } from '../../lib/endpoints';
import { safeReturnTo } from '../../lib/routing';
import { useApi } from '../../lib/session';

const REASON_TEXT: Record<string, string> = {
  signed_out: 'You signed out.',
  signed_out_offline:
    'You signed out on this device. The server could not be reached, so the session there ends when it expires.',
  expired: 'Your session ended. Sign in again to continue; drafts saved on this device are kept.',
};

/** Builds the OIDC start URL; the API validates returnTo against its own allowlist too. */
export function providerHref(provider: AuthProvider, returnTo: string): string {
  const base = provider.loginUrl ?? API_PATHS.authLogin(provider.id);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * PLT-013: provider-neutral sign-in. Providers come from the API (Microsoft first, then Google; the local
 * stand-in IdP only in development and labelled as such). Each button is a full-page navigation
 * into the OIDC authorization code + PKCE flow run by the API; no token ever reaches this page.
 */
export function SignInView() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const reason = params.get('reason');
  const { endpoints } = useApi();
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => endpoints.authProviders(),
    retry: 1,
  });

  // Development only: when the stand-in IdP is the only provider on offer, go straight into the app.
  // Skipped after a sign-out (reason set) or with ?choose=1, so the buttons stay reachable.
  const soleDevProvider =
    providers.data?.providers.length === 1 && providers.data.providers[0]?.development
      ? providers.data.providers[0]
      : null;
  const autoStart = soleDevProvider !== null && !reason && params.get('choose') !== '1';
  useEffect(() => {
    if (soleDevProvider && autoStart) {
      window.location.assign(providerHref(soleDevProvider, returnTo));
    }
    // returnTo is derived from the URL; the redirect is intended once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, soleDevProvider?.id]);

  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Sign in</h1>
        <p className="web-muted">{BRAND.description}</p>
        {reason && REASON_TEXT[reason] && (
          <p className="web-info" role="status">
            {REASON_TEXT[reason]}
          </p>
        )}
        {providers.isPending ? (
          <Skeleton label="Loading sign-in options" />
        ) : providers.error ? (
          <ErrorNotice
            error={providers.error}
            title="Sign-in options could not be loaded"
            onRetry={() => void providers.refetch()}
          />
        ) : providers.data.providers.length === 0 ? (
          <p role="alert">
            No sign-in provider is configured for this environment. An administrator must configure
            Microsoft or Google sign-in before anyone can sign in.
          </p>
        ) : (
          <ul className="web-provider-list">
            {orderProviders(providers.data.providers).map((provider) => (
              <li key={provider.id}>
                <a
                  className={`fl-btn fl-btn--${provider.id === 'microsoft' ? 'primary' : 'secondary'} fl-btn--lg fl-btn--full`}
                  href={providerHref(provider, returnTo)}
                >
                  <span className="fl-btn__label">Continue with {provider.label}</span>
                </a>
                {provider.development && (
                  <p className="web-muted web-small">
                    Development only: signs in with seeded test identities, never real accounts.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="web-muted web-small">
          Invited by a company? Open the invitation link from your email; you will be asked to sign
          in first and then to accept it.
        </p>
        <p className="web-muted web-small">
          {BRAND.name} is for businesses and users {LEGAL.minimumAge} or older. By continuing you
          agree to the{' '}
          <a href={LEGAL.terms} target="_blank" rel="noopener noreferrer">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href={LEGAL.privacy} target="_blank" rel="noopener noreferrer">
            Privacy Policy
          </a>
          . Estimates are not professional advice (
          <a href={LEGAL.disclaimer} target="_blank" rel="noopener noreferrer">
            disclaimer
          </a>
          ).
        </p>
      </div>
    </main>
  );
}
