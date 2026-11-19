'use client';

// Settings > Sign-in and password: add a username and password to an account that signs in with
// Microsoft or Google, or change the password. Changing it signs out the person's other devices.
import { passwordProblem, USERNAME_PATTERN } from '@fieldline/contracts';
import { Button, Field, Skeleton, TextInput, useToast } from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';
import { formError } from '../auth/SignInView';

export const PASSWORD_STATUS_KEY = ['password-status'] as const;

export function PasswordSettings() {
  const { endpoints } = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: PASSWORD_STATUS_KEY,
    queryFn: () => endpoints.passwordStatus(),
  });
  const [username, setUsername] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      endpoints.setPassword({
        newPassword: next,
        ...(status.data?.hasPassword
          ? { currentPassword: current }
          : { username: username.trim() }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(PASSWORD_STATUS_KEY, result);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.show({
        tone: 'success',
        message: status.data?.hasPassword
          ? 'Password changed. Your other devices were signed out.'
          : `You can now also sign in as ${result.username}.`,
      });
    },
    onError: (error) => setProblem(formError(error)),
  });

  if (status.isPending) return <Skeleton label="Loading sign-in settings" />;
  if (status.error) {
    return (
      <ErrorNotice
        error={status.error}
        title="Sign-in settings could not be loaded"
        onRetry={() => void status.refetch()}
      />
    );
  }
  const has = status.data.hasPassword;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    const name = has ? status.data.username : username.trim();
    if (!has && !USERNAME_PATTERN.test(username.trim())) {
      setProblem('Use 3 to 32 letters, numbers, dots, dashes or underscores for the username.');
      return;
    }
    if (has && !current) {
      setProblem('Enter your current password.');
      return;
    }
    const weak = passwordProblem(next, name);
    if (weak) return setProblem(weak);
    if (next !== confirm) return setProblem('The two new passwords do not match.');
    save.mutate();
  };

  return (
    <section aria-labelledby="password-heading" className="web-section">
      <h2 id="password-heading">Sign-in and password</h2>
      <p className="web-muted">
        {has
          ? `You can sign in with the username ${status.data.username} (or your email) and your password.`
          : 'You sign in with Microsoft or Google. Add a username and password to also sign in without them.'}
      </p>
      <form className="web-form" onSubmit={submit} noValidate>
        {has ? (
          <input
            type="hidden"
            name="username"
            autoComplete="username"
            value={status.data.username ?? ''}
          />
        ) : (
          <Field label="Username" hint="3 to 32 letters, numbers, dots, dashes or underscores.">
            <TextInput
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
        )}
        {has && (
          <Field label="Current password">
            <TextInput
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
        )}
        <Field label={has ? 'New password' : 'Password'} hint="At least 8 characters.">
          <TextInput
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </Field>
        <Field label={has ? 'Confirm new password' : 'Confirm password'}>
          <TextInput
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        {problem && (
          <p className="web-error" role="alert">
            {problem}
          </p>
        )}
        <Button type="submit" loading={save.isPending}>
          {has ? 'Change password' : 'Add password'}
        </Button>
      </form>
    </section>
  );
}
