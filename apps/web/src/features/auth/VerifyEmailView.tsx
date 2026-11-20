'use client';

// Landing page for the link in the verification email. Confirms the address once, which starts the
// free trial that was held for it (if this mailbox has not used one). The token is single-use.
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';

const Verified = z.object({ verified: z.literal(true), trialStarted: z.boolean() });

export function VerifyEmailView() {
  const { api } = useApi();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const started = useRef(false);

  const verify = useMutation({
    mutationFn: () => api.post('/v1/auth/email/verify', { token }, { schema: Verified }),
  });

  useEffect(() => {
    // Strict mode runs effects twice; the link is single-use, so send it once.
    if (started.current || !token) return;
    started.current = true;
    verify.mutate();
    // verify is stable for this page; only the token matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="sub-page" id="fl-main">
      <header className="sub-head">
        <div>
          <p className="sub-eyebrow">Account</p>
          <h1>Confirm your email</h1>
        </div>
      </header>

      {!token && (
        <section className="sub-card">
          <p role="alert" className="sub-error">
            This page needs the link from your email. Open the link we sent you.
          </p>
        </section>
      )}

      {token && verify.isPending && (
        <section className="sub-card">
          <p className="sub-muted" role="status">
            Confirming…
          </p>
        </section>
      )}

      {verify.isSuccess && (
        <section className="sub-card" aria-live="polite">
          <h2>Email confirmed</h2>
          <p>
            {verify.data.trialStarted
              ? 'Your 7-day free trial has started.'
              : 'Your email is confirmed. This email address has already used its free trial, so activate with a code or subscribe to continue.'}
          </p>
          <div className="sub-actions">
            <Link className="cc-btn cc-btn--primary" href="/">
              Go to the app
            </Link>
          </div>
        </section>
      )}

      {verify.isError && (
        <section className="sub-card">
          <h2>This link did not work</h2>
          <p role="alert" className="sub-error">
            {errorHint(verify.error)}
          </p>
          <div className="sub-actions">
            <Link className="cc-btn" href="/sign-in">
              Sign in to request a new link
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
