'use client';

// Landing page for the password reset link (item 11). The token is single-use; setting a new
// password signs out every device. Nothing here runs until the person submits the form, so an
// email scanner opening the link cannot spend it.
import { BRAND } from '@fieldline/contracts';
import { Button, Checkbox, Field, TextInput } from '@fieldline/ui';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useApi } from '../../lib/session';
import { formError } from './SignInView';

const ResetResult = z.object({ reset: z.literal(true) });

export function ResetPasswordView() {
  const { api } = useApi();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const reset = useMutation({
    mutationFn: () => api.post('/v1/auth/password/reset', { token, newPassword }, { schema: ResetResult }),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!token || !newPassword || mismatch || reset.isPending) return;
    reset.mutate();
  };

  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Choose a new password</h1>
        {!token && (
          <p className="web-error" role="alert">
            This page needs the link from your email. Request a new one from the sign-in page.
          </p>
        )}
        {token && reset.isSuccess && (
          <>
            <p className="web-info" role="status">
              Your password is changed and every device is signed out. Sign in with your new
              password.
            </p>
            <p className="web-small">
              <Link href="/sign-in">Go to sign in</Link>
            </p>
          </>
        )}
        {token && !reset.isSuccess && (
          <form className="web-auth__form" onSubmit={submit} noValidate>
            <Field label="New password" required>
              <TextInput
                name="newPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={200}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="Repeat new password" required>
              <TextInput
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                maxLength={200}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
            <Checkbox
              label="Show password"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            {mismatch && (
              <p className="web-error" role="alert">
                The two passwords do not match.
              </p>
            )}
            {reset.isError && (
              <div className="web-error" role="alert">
                <p>{formError(reset.error)}</p>
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              fullWidth
              loading={reset.isPending}
              disabled={!newPassword || mismatch}
            >
              Set new password
            </Button>
          </form>
        )}
        <p className="web-small">
          <Link href="/forgot-password">Request a new reset link</Link>
        </p>
      </div>
    </main>
  );
}
