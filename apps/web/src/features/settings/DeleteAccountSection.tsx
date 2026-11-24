'use client';

// Settings > Delete account: remove your own sign-in, close the workspaces you solely own and
// leave shared ones. The dialog says plainly what stays behind: records the database keeps as
// evidence (audit events, settings history, ledger entries, locked versions) are retained but
// the closed workspace has no members, so nobody can open it. Deleting your account does NOT
// cancel a paid subscription — that still needs an email to the address below.
import { LEGAL } from '@fieldline/contracts';
import { Button, ConfirmDialog, Field, TextInput } from '@fieldline/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useApi } from '../../lib/session';
import { formError } from '../auth/SignInView';

export function DeleteAccountSection() {
  const { endpoints } = useApi();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => endpoints.deleteAccount(),
    onSuccess: () => window.location.assign('/sign-in'),
    onError: (error) => setProblem(formError(error)),
  });

  const close = () => {
    if (remove.isPending) return;
    setOpen(false);
    setTyped('');
    setProblem(null);
  };

  return (
    <section aria-labelledby="delete-account-heading" className="web-section">
      <h2 id="delete-account-heading">Delete account</h2>
      <div className="web-card">
        <p className="web-muted">
          Deleting your account signs you out everywhere, removes your sign-in, closes the
          workspaces you solely own and removes you from shared ones. Financial and audit records
          the company must keep as evidence stay on file but are no longer accessible to anyone.
          Deleting your account does not cancel a paid subscription — email{' '}
          <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> to cancel that.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        tone="danger"
        title="Delete your account?"
        description={
          <>
            <p>
              This cannot be undone. Your sign-in, your memberships and your sessions are deleted.
              Workspaces you solely own are closed and their deletable records are removed;
              records the database keeps as evidence (audit events, settings history, ledger
              entries, locked versions) are retained but no longer accessible to anyone.
            </p>
            <p>
              If you pay for Field Pro, deleting your account does not stop billing. Cancel the
              subscription first by emailing{' '}
              <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
            </p>
          </>
        }
        confirmLabel="Delete my account"
        onConfirm={() => remove.mutate()}
        onCancel={close}
        error={problem}
        deniedReason={typed.trim() === 'DELETE' ? undefined : 'Type DELETE to confirm.'}
      >
        <Field label="Type DELETE to confirm">
          <TextInput
            value={typed}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>
      </ConfirmDialog>
    </section>
  );
}
