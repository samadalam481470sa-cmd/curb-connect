'use client';

// Shown above every signed-in page. Tells the person what to do about their account: confirm the email
// that starts the free trial, see how many trial days are left, or activate / subscribe after the trial.
// It renders nothing when the account is in good standing, so it never adds noise.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const Notice = z.object({
  access: z.enum(['subscribed', 'activated', 'grandfathered', 'trial', 'expired']),
  trialDaysLeft: z.number().int().nullable(),
  emailVerified: z.boolean(),
  emailTrialUsed: z.boolean(),
  trialPending: z.boolean(),
});
type NoticeValue = z.infer<typeof Notice>;

export function AccountNotice() {
  const { api } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const [resent, setResent] = useState<'idle' | 'sent' | 'already'>('idle');
  const statusKey = orgKey(session.orgId, 'billing-status');

  const status = useQuery({
    queryKey: statusKey,
    queryFn: (): Promise<NoticeValue> => api.get('/v1/billing/status', { schema: Notice }),
    retry: false,
  });
  const resend = useMutation({
    mutationFn: () => api.post('/v1/auth/email/resend', {}, { schema: z.object({ sent: z.boolean() }) }),
    onSuccess: (result) => {
      setResent(result.sent ? 'sent' : 'already');
      void queryClient.invalidateQueries({ queryKey: statusKey });
    },
  });

  const data = status.data;
  if (!data) return null;

  if (!data.emailVerified) {
    return (
      <aside className="acct-notice acct-notice--action" role="status" aria-label="Confirm your email">
        <div>
          <strong>Confirm your email to start your free trial.</strong>
          <p>We sent a link to your inbox. It works for 48 hours.</p>
          {resent === 'sent' && <p className="acct-ok">A new link is on its way.</p>}
          {resent === 'already' && <p className="acct-ok">Your email is already confirmed.</p>}
          {resend.isError && <p className="acct-error">{errorHint(resend.error)}</p>}
        </div>
        <button type="button" className="cc-btn" disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? 'Sending…' : 'Send a new link'}
        </button>
      </aside>
    );
  }

  if (data.access === 'expired') {
    return (
      <aside className="acct-notice acct-notice--warn" role="status" aria-label="Account access">
        <div>
          <strong>
            {data.emailTrialUsed ? 'This email has already used its free trial.' : 'Your free trial has ended.'}
          </strong>
          <p>Your data is kept. Enter an activation code or subscribe to continue.</p>
        </div>
        <Link className="cc-btn cc-btn--primary" href="/subscription">
          Activate or subscribe
        </Link>
      </aside>
    );
  }

  if (data.access === 'trial' && data.trialDaysLeft !== null && data.trialDaysLeft <= 2) {
    return (
      <aside className="acct-notice acct-notice--info" role="status" aria-label="Trial ending">
        <div>
          <strong>
            Your free trial ends in {data.trialDaysLeft} day{data.trialDaysLeft === 1 ? '' : 's'}.
          </strong>
          <p>Activate or subscribe before then to keep access without a gap.</p>
        </div>
        <Link className="cc-btn" href="/subscription">
          View options
        </Link>
      </aside>
    );
  }

  return null;
}
