'use client';

// Ask for a password reset link by email (item 11). The answer is the same whether or not the
// address has an account. Until email sending is configured on the server, the page says so
// plainly instead of pretending a link is on its way.
import { BRAND } from '@fieldline/contracts';
import { Button, Field, TextInput } from '@fieldline/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useApi } from '../../lib/session';
import { formError } from './SignInView';

const ForgotResult = z.object({ sent: z.boolean(), emailConfigured: z.boolean() });

export function ForgotPasswordView() {
  const { api } = useApi();
  const [email, setEmail] = useState('');
  const forgot = useMutation({
    mutationFn: () => api.post('/v1/auth/password/forgot', { email: email.trim() }, { schema: ForgotResult }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || forgot.isPending) return;
    forgot.mutate();
  };

  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Reset your password</h1>
        <p className="web-muted">
          Enter the email on your account. If it matches a password account, we email a one-time
          link that expires in 1 hour.
        </p>
        {forgot.isSuccess && forgot.data.emailConfigured ? (
          <p className="web-info" role="status">
            If that email has a {BRAND.name} password account, a reset link is on its way. Check
            your inbox (and spam folder), then open the link within 1 hour.
          </p>
        ) : (
          <form className="web-auth__form" onSubmit={submit} noValidate>
            <Field label="Email" required>
              <TextInput
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            {forgot.isSuccess && !forgot.data.emailConfigured && (
              <p className="web-info" role="status">
                Password reset by email is not set up on this server yet, so no link was sent. Use
                Continue with Microsoft or Google on the sign-in page if you linked one, or ask
                your company administrator to invite you again.
              </p>
            )}
            {forgot.isError && (
              <div className="web-error" role="alert">
                <p>{formError(forgot.error)}</p>
              </div>
            )}
            <Button type="submit" size="lg" fullWidth loading={forgot.isPending} disabled={!email.trim()}>
              Email me a reset link
            </Button>
          </form>
        )}
        <p className="web-small">
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </div>
    </main>
  );
}
