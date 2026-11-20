'use client';

// Subscription screen. Shows the company's free-trial or subscription state and, before checkout, the
// renewal terms the law requires (price, billing period, auto-renewal, cancellation). Payment happens
// on the provider's hosted Checkout page; nothing is charged from this screen without the consent box.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const Status = z.object({
  access: z.enum(['subscribed', 'grandfathered', 'trial', 'expired']),
  trialDaysLeft: z.number().int().nullable(),
  trialEndsAt: z.string().nullable(),
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
const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export function SubscriptionView() {
  const { api } = useApi();
  const session = useSession();
  const params = useSearchParams();
  const [accepted, setAccepted] = useState(false);
  const status = useQuery({
    queryKey: orgKey(session.orgId, 'billing-status'),
    queryFn: (): Promise<StatusValue> => api.get('/v1/billing/status', { schema: Status }),
  });
  const checkout = useMutation({
    mutationFn: (): Promise<z.output<typeof Checkout>> =>
      api.post('/v1/billing/checkout', { acceptedTerms: true }, { schema: Checkout }),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });

  const data = status.data;
  const needsPayment = data && (data.access === 'expired' || data.access === 'trial');
  const returned = params.get('checkout');

  return (
    <main className="subscription" style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 720 }}>
      <header>
        <h1 style={{ margin: 0 }}>Subscription</h1>
      </header>

      {returned === 'success' && (
        <p role="status">Thanks. Your payment is being confirmed. Access updates once the payment provider confirms it.</p>
      )}
      {returned === 'cancelled' && <p role="status">Checkout was cancelled. Nothing was charged.</p>}

      {status.isPending && <p>Loading…</p>}
      {status.isError && <p role="alert">{errorHint(status.error)}</p>}

      {data && (
        <section aria-labelledby="access-state" style={{ display: 'grid', gap: 8 }}>
          <h2 id="access-state" style={{ margin: 0, fontSize: 18 }}>
            {data.access === 'trial' && `Free trial: ${data.trialDaysLeft} day${data.trialDaysLeft === 1 ? '' : 's'} left`}
            {data.access === 'expired' && 'Your free trial has ended'}
            {data.access === 'subscribed' && 'Subscription active'}
            {data.access === 'grandfathered' && 'Existing account: no charge required'}
          </h2>
          {data.access === 'trial' && data.trialEndsAt && (
            <p style={{ margin: 0 }}>The trial ends on {dateText(data.trialEndsAt)}.</p>
          )}
          {data.access === 'expired' && (
            <p style={{ margin: 0 }}>Your data is kept. Subscribe to continue using Field Pro.</p>
          )}
          {data.access === 'subscribed' && data.subscription && (
            <p style={{ margin: 0 }}>
              Current period ends on {dateText(data.subscription.currentPeriodEnd)}. Status: {data.subscription.status}.
            </p>
          )}
        </section>
      )}

      {data && needsPayment && (
        <section aria-labelledby="terms" style={{ display: 'grid', gap: 10, borderTop: '1px solid var(--border, #ddd)', paddingTop: 12 }}>
          <h2 id="terms" style={{ margin: 0, fontSize: 18 }}>Subscribe</h2>
          {data.plan ? (
            <p style={{ margin: 0 }}>
              <strong>{data.plan.name}: {money(data.plan.priceMinor, data.plan.currency)} per {data.plan.interval}.</strong>{' '}
              Your subscription renews automatically every {data.plan.interval} until you cancel. Taxes may apply.
            </p>
          ) : (
            <p style={{ margin: 0 }}>No plan is configured on this server yet, so checkout is unavailable.</p>
          )}
          <p style={{ margin: 0, fontSize: 14 }}>
            How to cancel: online cancellation is not available yet. To cancel, contact the Field Pro team before your next
            renewal date.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>I agree that my subscription renews automatically at the price above until I cancel.</span>
          </label>
          <button
            type="button"
            className="cc-btn"
            disabled={!accepted || !data.checkoutAvailable || !data.plan || checkout.isPending}
            onClick={() => checkout.mutate()}
          >
            {checkout.isPending ? 'Opening checkout…' : 'Continue to secure checkout'}
          </button>
          {!data.checkoutAvailable && <p role="status" style={{ margin: 0 }}>Online payment is not set up on this server yet.</p>}
          {checkout.isError && <p role="alert">{errorHint(checkout.error)}</p>}
        </section>
      )}
    </main>
  );
}
