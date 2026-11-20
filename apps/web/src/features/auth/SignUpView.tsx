'use client';

// Create a Field Pro account with a username and password. The details are saved by the API
// (users + password_credentials; only a scrypt hash of the password). Microsoft and Google
// sign-up stay available under the form.
import { BRAND, passwordProblem, USERNAME_PATTERN } from '@fieldline/contracts';
import { Button, Checkbox, Field, TextInput } from '@fieldline/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { StartServerButton } from '../../components/common';
import { safeReturnTo } from '../../lib/routing';
import { useApi } from '../../lib/session';
import { useAutoWakeApi } from '../../lib/wake';
import {
  formError,
  LegalNote,
  ProviderButtons,
  ServerStartingNotice,
  useSignedInRedirect,
} from './SignInView';

export interface SignUpForm {
  displayName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
}

/** Field-by-field problems shown before anything is sent. */
export function signUpProblems(form: SignUpForm): Partial<Record<keyof SignUpForm, string>> {
  const problems: Partial<Record<keyof SignUpForm, string>> = {};
  if (!form.displayName.trim()) problems.displayName = 'Enter your full name.';
  if (!USERNAME_PATTERN.test(form.username.trim())) {
    problems.username = 'Use 3 to 32 letters, numbers, dots, dashes or underscores.';
  }
  if (!/^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/.test(form.email.trim())) {
    problems.email = 'Enter a valid email address.';
  }
  if (form.phone.trim() && !/^[0-9+()\-. xext]*$/i.test(form.phone.trim())) {
    problems.phone = 'Use only numbers and + ( ) - . in the phone number.';
  }
  const weak = passwordProblem(form.password, form.username.trim());
  if (weak) problems.password = weak;
  else if (form.password !== form.confirm) problems.confirm = 'The two passwords do not match.';
  return problems;
}

const EMPTY: SignUpForm = {
  displayName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirm: '',
};

export function SignUpView() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const { endpoints } = useApi();
  const providers = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => endpoints.authProviders(),
    retry: 1,
  });
  const me = useSignedInRedirect(returnTo);
  const [form, setForm] = useState<SignUpForm>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [checked, setChecked] = useState(false);
  const problems = signUpProblems(form);
  const shown = checked ? problems : {};
  // A sleeping API answers through the host's proxy; wake it while nothing is typed yet.
  const nothingTyped = Object.values(form).every((value) => value === '');
  const wakingApi = useAutoWakeApi(nothingTyped ? (providers.error ?? me.error) : null);
  const set = (key: keyof SignUpForm) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const create = useMutation({
    mutationFn: () =>
      endpoints.passwordSignUp({
        displayName: form.displayName.trim(),
        username: form.username.trim(),
        email: form.email.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        password: form.password,
        remember,
        returnTo,
      }),
    onSuccess: ({ redirectTo }) => window.location.assign(safeReturnTo(redirectTo)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(problems).length === 0) create.mutate();
  };
  const signInHref =
    returnTo === '/' ? '/sign-in' : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Create account</h1>
        {wakingApi && <ServerStartingNotice />}
        <form className="web-auth__form" onSubmit={submit} noValidate>
          <Field label="Full name" required error={shown.displayName}>
            <TextInput
              name="name"
              autoComplete="name"
              maxLength={120}
              value={form.displayName}
              onChange={set('displayName')}
            />
          </Field>
          <Field
            label="Username"
            required
            hint="3 to 32 letters, numbers, dots, dashes or underscores. You can sign in with it or your email."
            error={shown.username}
          >
            <TextInput
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              value={form.username}
              onChange={set('username')}
            />
          </Field>
          <Field label="Email" required error={shown.email}>
            <TextInput
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              value={form.email}
              onChange={set('email')}
            />
          </Field>
          <Field label="Phone" hint="Optional." error={shown.phone}>
            <TextInput
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={form.phone}
              onChange={set('phone')}
            />
          </Field>
          <Field
            label="Password"
            required
            hint="At least 8 characters. Saved only as a one-way hash."
            error={shown.password}
          >
            <TextInput
              name="new-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={200}
              value={form.password}
              onChange={set('password')}
            />
          </Field>
          <Field label="Confirm password" required error={shown.confirm}>
            <TextInput
              name="confirm-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={200}
              value={form.confirm}
              onChange={set('confirm')}
            />
          </Field>
          <Checkbox
            label="Show passwords"
            checked={showPassword}
            onChange={(e) => setShowPassword(e.target.checked)}
          />
          <Checkbox
            label="Keep me signed in"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {create.error && (
            <div className="web-error" role="alert">
              <p>{formError(create.error)}</p>
              <StartServerButton error={create.error} />
            </div>
          )}
          <Button type="submit" size="lg" fullWidth loading={create.isPending}>
            Create account
          </Button>
        </form>
        <p className="web-small">
          Each email address gets one free 7-day trial. An address that has already used its trial needs an activation
          code to continue.
        </p>
        <p className="web-small">
          Already have an account? <Link href={signInHref}>Sign in</Link>
        </p>
        {!wakingApi && (
          <ProviderButtons verb="Sign up" returnTo={returnTo} providers={providers} />
        )}
        <LegalNote />
      </div>
    </main>
  );
}
