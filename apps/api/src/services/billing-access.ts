// Access rule for a company. Pure: the caller passes the database-clock "now" it read, so the decision
// can be tested without a database. Order matters: a paid subscription wins, then grandfathering, then
// the trial, and otherwise the company is expired and only the billing screens stay reachable.
export type AccessState = 'subscribed' | 'activated' | 'grandfathered' | 'trial' | 'expired';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';

export interface AccessInput {
  now: Date;
  billingExempt: boolean;
  trialEndsAt: Date | null;
  subscription: { status: SubscriptionStatus; currentPeriodEnd: Date } | null;
  /** End of time bought with an activation code, or null when none is active. */
  activatedUntil?: Date | null;
}

export interface AccessDecision {
  state: AccessState;
  /** Whole days left in the trial (rounded up), or null when no trial applies. */
  trialDaysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_STATUSES: readonly SubscriptionStatus[] = ['active', 'trialing', 'past_due'];

export function decideAccess(input: AccessInput): AccessDecision {
  const { now, billingExempt, trialEndsAt, subscription, activatedUntil } = input;
  if (subscription && PAID_STATUSES.includes(subscription.status) && subscription.currentPeriodEnd > now) {
    return { state: 'subscribed', trialDaysLeft: null };
  }
  if (activatedUntil && activatedUntil > now) return { state: 'activated', trialDaysLeft: null };
  if (billingExempt) return { state: 'grandfathered', trialDaysLeft: null };
  if (trialEndsAt && trialEndsAt > now) {
    return { state: 'trial', trialDaysLeft: Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS) };
  }
  return { state: 'expired', trialDaysLeft: null };
}

/** Whether a decision lets the company use the product (everything except the expired state). */
export function hasProductAccess(decision: AccessDecision): boolean {
  return decision.state !== 'expired';
}
