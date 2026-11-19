'use client';

import { BRAND, LEGAL } from '@fieldline/contracts';
import { Button, Checkbox, Field, Skeleton, TextInput } from '@fieldline/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { API_PATHS, orderProviders, type AuthProvider } from '../../lib/endpoints';
import { safeReturnTo } from '../../lib/routing';
import { useApi } from '../../lib/session';
import { useAutoWakeApi } from '../../lib/wake';

const REASON_TEXT: Record<string, string> = {
  signed_out: 'You signed out.',
  signed_out_offline:
    'You signed out on this device. The server could not be reached, so the session there ends when it expires.',
  expired: 'Your session ended. Sign in again to continue; drafts saved on this device are kept.',
};

/** Why the API sent the browser back here after a Microsoft / Google sign-in (?error=). */
export const SIGN_IN_ERRORS: Record<string, string> = {
  provider_denied: 'Sign-in was cancelled on the Microsoft or Google page.',
  provider_unavailable: 'That sign-in option is not set up yet. Use your username and password.',
  sign_in_expired: 'That sign-in took too long. Start again.',
  sign_in_rejected: 'That sign-in could not be verified. Start again.',
  account_link_required:
    'An account with this email already exists. Sign in the way you did before, then link this sign-in in Settings.',
  account_deactivated: 'This account is deactivated. Ask your company administrator.',
};

/** The API's own message for a refused form (wrong password, taken username), else a safe hint. */
export function formError(error: unknown): string {
  const detail = (error as { problem?: { detail?: unknown } } | null)?.problem?.detail;
  return typeof detail === 'string' && detail ? detail : errorHint(error);
}

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
  const providerError = SIGN_IN_ERRORS[params.get('error') ?? ''];
  const { endpoints } = useApi();
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => endpoints.authProviders(),
    retry: 1,
  });
  // Development only: when the stand-in IdP is the only provider, go straight into the app (the
  // e2e journeys rely on this). Skipped after a sign-out, after an error, or with ?choose=1, so the
  // password form stays reachable. Production never has the stand-in, so the form always shows.
  const soleDevProvider =
    providers.data?.providers.length === 1 && providers.data.providers[0]?.development
      ? providers.data.providers[0]
      : null;
  const autoStart =
    soleDevProvider !== null && !reason && !providerError && params.get('choose') !== '1';
  useEffect(() => {
    if (soleDevProvider && autoStart) {
      window.location.assign(providerHref(soleDevProvider, returnTo));
    }
    // returnTo is derived from the URL; the redirect is intended once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, soleDevProvider?.id]);
  const me = useSignedInRedirect(returnTo);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  // A sleeping API answers through the host's proxy; wake it while nothing is typed yet.
  const wakingApi = useAutoWakeApi(!login && !password ? (providers.error ?? me.error) : null);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const signIn = useMutation({
    mutationFn: () => endpoints.passwordSignIn({ login, password, remember, returnTo }),
    // A full page load, so the app starts fresh with the new session cookie.
    onSuccess: ({ redirectTo }) => window.location.assign(safeReturnTo(redirectTo)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!login.trim() || !password) return;
    signIn.mutate();
  };
  const signUpHref =
    returnTo === '/' ? '/sign-up' : `/sign-up?returnTo=${encodeURIComponent(returnTo)}`;

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
        {providerError && (
          <p className="web-error" role="alert">
            {providerError}
          </p>
        )}
        {wakingApi && <ServerStartingNotice />}
        <form className="web-auth__form" onSubmit={submit} noValidate>
          <Field label="Username or email" required>
            <TextInput
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </Field>
          <Field label="Password" required>
            <TextInput
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Checkbox
            label="Show password"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />
          <Checkbox
            label="Keep me signed in"
            hint="Untick on a shared computer: you are signed out when the browser closes."
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {signIn.error && (
            <p className="web-error" role="alert">
              {formError(signIn.error)}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            fullWidth
            loading={signIn.isPending}
            disabled={!login.trim() || !password}
          >
            Sign in
          </Button>
        </form>
        <p className="web-muted web-small">
          Forgot your password? Use Continue with Microsoft or Google below if you linked one, or
          ask your company administrator to invite you again.
        </p>
        <p className="web-small">
          New to {BRAND.name}? <Link href={signUpHref}>Create an account</Link>
        </p>
        {!wakingApi && (
          <ProviderButtons verb="Continue" returnTo={returnTo} providers={providers} />
        )}
        <p className="web-muted web-small">
          Invited by a company? Open the invitation link from your email; you will be asked to sign
          in first and then to accept it.
        </p>
        <LegalNote />
      </div>
    </main>
  );
}

/**
 * Someone who is already signed in and opens /sign-in or /sign-up goes straight back into the app.
 * A 401 here is expected and quiet: it simply means the form is needed.
 */
export function useSignedInRedirect(returnTo: string) {
  const { endpoints } = useApi();
  const me = useQuery({ queryKey: ['sign-in-probe'], queryFn: () => endpoints.me(), retry: false });
  useEffect(() => {
    if (me.data) window.location.assign(returnTo);
  }, [me.data, returnTo]);
  return me;
}

/** Shown while the browser is on its way to wake a sleeping API (lib/wake.ts). */
export function ServerStartingNotice() {
  return (
    <p className="web-info" role="status">
      Starting the server. This takes about a minute. This page comes back by itself.
    </p>
  );
}

/** "or" divider plus Microsoft / Google (and, in development, the stand-in) sign-in buttons. */
export function ProviderButtons({
  verb,
  returnTo,
  providers,
}: {
  verb: string;
  returnTo: string;
  providers: ReturnType<typeof useQuery<{ providers: AuthProvider[] }>>;
}) {
  if (providers.isPending) return <Skeleton label="Loading sign-in options" />;
  if (providers.error) {
    return (
      <ErrorNotice
        error={providers.error}
        title="Microsoft and Google sign-in options could not be loaded"
        onRetry={() => void providers.refetch()}
      />
    );
  }
  const list = orderProviders(providers.data.providers);
  if (list.length === 0) return null;
  return (
    <>
      <p className="web-auth__divider">
        <span>or</span>
      </p>
      <ul className="web-provider-list">
        {list.map((provider) => (
          <li key={provider.id}>
            <a
              className="fl-btn fl-btn--secondary fl-btn--lg fl-btn--full"
              href={providerHref(provider, returnTo)}
            >
              <span className="fl-btn__label">
                {verb} with {provider.label}
              </span>
            </a>
            {provider.development && (
              <p className="web-muted web-small">
                Development only: signs in with seeded test identities, never real accounts.
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="web-muted web-small">
        Signing in with Google or Microsoft does not send email by itself. To email invoices from
        that address, connect it once in Settings → Email.
      </p>
    </>
  );
}

export function LegalNote() {
  return (
    <p className="web-muted web-small">
      {BRAND.name} is for businesses and users {LEGAL.minimumAge} or older. By continuing you agree
      to the{' '}
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
  );
}
