'use client';

// Subscription and activation screen. Shows the company's access state, redeems an activation code,
// and, before checkout, the renewal terms the law requires (price, billing period, auto-renewal,
// cancellation). Nothing is charged from this screen without the consent box.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const Status = z.object({
  access: z.enum(['subscribed', 'activated', 'grandfathered', 'trial', 'expired']),
  trialDaysLeft: z.number().int().nullable(),
  trialEndsAt: z.string().nullable(),
  activatedUntil: z.string().nullable(),
  emailTrialUsed: z.boolean(),
  subscription: z.object({ status: z.string(), currentPeriodEnd: z.string() }).nullable(),
  plan: z
    .object({ name: z.string(), priceMinor: z.number().int(), currency: z.string(), interval: z.string() })
    .nullable(),
  checkoutAvailable: z.boolean(),
});
type StatusValue = z.infer<typeof Status>;
const Checkout = z.object({ url: z.string() });

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** Shows the code as XXXX-XXXX-XXXX-XXXX while typing; only letters and digits are kept. */
export function formatActivationCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  return clean.match(/.{1,4}/g)?.join('-') ?? '';
}

function accessBadge(data: StatusValue): { label: string; tone: 'ok' | 'info' | 'warn' } {
  switch (data.access) {
    case 'trial':
      return {
        label: `Free trial · ${data.trialDaysLeft} day${data.trialDaysLeft === 1 ? '' : 's'} left`,
        tone: 'info',
      };
    case 'activated':
      return { label: `Activated · until ${data.activatedUntil ? dateText(data.activatedUntil) : ''}`, tone: 'ok' };
    case 'subscribed':
      return { label: 'Subscription active', tone: 'ok' };
    case 'grandfathered':
      return { label: 'Existing account', tone: 'ok' };
    case 'expired':
      return { label: 'Trial ended', tone: 'warn' };
  }
}

export function SubscriptionView() {
  const { api } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [accepted, setAccepted] = useState(false);
  const [code, setCode] = useState('');
  const statusKey = orgKey(session.orgId, 'billing-status');

  const status = useQuery({
    queryKey: statusKey,
    queryFn: (): Promise<StatusValue> => api.get('/v1/billing/status', { schema: Status }),
  });
  const checkout = useMutation({
    mutationFn: (): Promise<z.output<typeof Checkout>> =>
      api.post('/v1/billing/checkout', { acceptedTerms: true }, { schema: Checkout }),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });
  const activate = useMutation({
    mutationFn: (): Promise<StatusValue> => api.post('/v1/billing/activate', { code }, { schema: Status }),
    onSuccess: (next) => {
      setCode('');
      queryClient.setQueryData(statusKey, next);
    },
  });

  const data = status.data;
  const needsPayment = data && (data.access === 'expired' || data.access === 'trial');
  const returned = params.get('checkout');
  const compactCode = code.replace(/-/g, '');
  const badge = data ? accessBadge(data) : null;

  return (
    <main className="sub-page">
      <header className="sub-head">
        <div>
          <p className="sub-eyebrow">Billing</p>
          <h1>Subscription</h1>
          <p className="sub-lede">Your plan, trial and activation codes for this company.</p>
        </div>
        {badge && <span className={`sub-badge sub-badge--${badge.tone}`}>{badge.label}</span>}
      </header>

      {returned === 'success' && (
        <p role="status" className="sub-notice sub-notice--ok">
          Thanks. Your payment is being confirmed. Access updates once the payment provider confirms it.
        </p>
      )}
      {returned === 'cancelled' && (
        <p role="status" className="sub-notice">
          Checkout was cancelled. Nothing was charged.
        </p>
      )}
      {data?.emailTrialUsed && data.access !== 'trial' && data.access !== 'grandfathered' && data.access !== 'activated' && (
        <p className="sub-notice">
          This email address has already used its free trial. Enter an activation code below, or subscribe, to keep
          using Field Pro. Your data is kept.
        </p>
      )}

      {status.isPending && <p className="sub-muted">Loading…</p>}
      {status.isError && (
        <p role="alert" className="sub-error">
          {errorHint(status.error)}
        </p>
      )}

      {data && data.access === 'activated' && data.activatedUntil && (
        <section className="sub-card" aria-labelledby="access-title">
          <h2 id="access-title">Your access</h2>
          <p>
            Access runs until <strong>{dateText(data.activatedUntil)}</strong>, activated with a code.
          </p>
          <div className="sub-actions">
            <Link className="cc-btn cc-btn--primary" href="/">
              Go to dashboard
            </Link>
          </div>
        </section>
      )}
      {data && data.access === 'trial' && data.trialEndsAt && (
        <section className="sub-card" aria-labelledby="access-title">
          <h2 id="access-title">Your access</h2>
          <p>
            The free trial ends on <strong>{dateText(data.trialEndsAt)}</strong>.
          </p>
        </section>
      )}
      {data && data.access === 'expired' && (
        <section className="sub-card" aria-labelledby="access-title">
          <h2 id="access-title">Your access</h2>
          <p>Your free trial has ended. Your data is kept and comes back as soon as access is restored.</p>
        </section>
      )}
      {data && data.access === 'subscribed' && data.subscription && (
        <section className="sub-card" aria-labelledby="access-title">
          <h2 id="access-title">Your access</h2>
          <p>
            Current period ends on <strong>{dateText(data.subscription.currentPeriodEnd)}</strong>. Status:{' '}
            {data.subscription.status}.
          </p>
        </section>
      )}
      {data && data.access === 'grandfathered' && (
        <section className="sub-card" aria-labelledby="access-title">
          <h2 id="access-title">Your access</h2>
          <p>This company was set up before free trials. No charge is required.</p>
        </section>
      )}

      {data && data.access !== 'grandfathered' && (
        <section className="sub-card" aria-labelledby="code-title">
          <h2 id="code-title">Activation code</h2>
          <p className="sub-muted">
            Have a code from the Field Pro team? Enter it to unlock access for the number of days issued with it. Each
            code works once.
          </p>
          <form
            className="sub-code-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (compactCode.length === 16 && !activate.isPending) activate.mutate();
            }}
          >
            <label className="sub-field">
              <span>Code</span>
              <input
                className="sub-code-input"
                value={code}
                onChange={(event) => setCode(formatActivationCode(event.target.value))}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                maxLength={19}
                aria-describedby="code-help"
              />
            </label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={compactCode.length !== 16 || activate.isPending}>
              {activate.isPending ? 'Checking…' : 'Activate'}
            </button>
          </form>
          <p id="code-help" className="sub-help">
            Letters and numbers only. Dashes are added for you.
          </p>
          {activate.isError && (
            <p role="alert" className="sub-error">
              {errorHint(activate.error)}
            </p>
          )}
          {activate.isSuccess && <p role="status" className="sub-success">Code accepted. Access is active.</p>}
        </section>
      )}

      {data && needsPayment && (
        <section className="sub-card" aria-labelledby="terms">
          <h2 id="terms">Subscribe</h2>
          {data.plan ? (
            <>
              <p className="sub-price">
                {data.plan.name}: {money(data.plan.priceMinor, data.plan.currency)} per {data.plan.interval}
              </p>
              <p className="sub-muted">
                Your subscription renews automatically every {data.plan.interval} until you cancel. Taxes may apply.
              </p>
            </>
          ) : (
            <p className="sub-muted">No plan is configured on this server yet, so checkout is unavailable.</p>
          )}
          <p className="sub-muted">
            How to cancel: online cancellation is not available yet. To cancel, contact the Field Pro team before your
            next renewal date.
          </p>
          <label className="sub-checkbox">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I agree that my subscription renews automatically at the price above until I cancel.</span>
          </label>
          <div className="sub-actions">
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={!accepted || !data.checkoutAvailable || !data.plan || checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? 'Opening checkout…' : 'Continue to secure checkout'}
            </button>
          </div>
          {!data.checkoutAvailable && (
            <p role="status" className="sub-muted">
              Online payment is not set up on this server yet.
            </p>
          )}
          {checkout.isError && (
            <p role="alert" className="sub-error">
              {errorHint(checkout.error)}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
