import { describe, expect, it } from 'vitest';
import { decideAccess, hasProductAccess } from './billing-access';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const future = (days: number) => new Date(NOW.getTime() + days * DAY);
const past = (days: number) => new Date(NOW.getTime() - days * DAY);

describe('decideAccess', () => {
  it('gives a new company a trial that counts down whole days', () => {
    expect(decideAccess({ now: NOW, billingExempt: false, trialEndsAt: future(7), subscription: null })).toEqual({
      state: 'trial',
      trialDaysLeft: 7,
    });
    // 6.5 days left rounds up to 7 so the countdown never shows 0 while access remains.
    expect(decideAccess({ now: NOW, billingExempt: false, trialEndsAt: future(0.5), subscription: null }).trialDaysLeft).toBe(1);
  });

  it('expires the trial after seven days with no subscription', () => {
    expect(decideAccess({ now: NOW, billingExempt: false, trialEndsAt: past(0.001), subscription: null })).toEqual({
      state: 'expired',
      trialDaysLeft: null,
    });
    expect(hasProductAccess({ state: 'expired', trialDaysLeft: null })).toBe(false);
  });

  it('gives access to a paid subscription even after the trial ended', () => {
    const decision = decideAccess({
      now: NOW,
      billingExempt: false,
      trialEndsAt: past(30),
      subscription: { status: 'active', currentPeriodEnd: future(20) },
    });
    expect(decision.state).toBe('subscribed');
    expect(hasProductAccess(decision)).toBe(true);
  });

  it('stops access when the paid period has ended or the subscription is canceled or paused', () => {
    const lapsed = decideAccess({
      now: NOW,
      billingExempt: false,
      trialEndsAt: null,
      subscription: { status: 'active', currentPeriodEnd: past(1) },
    });
    expect(lapsed.state).toBe('expired');
    for (const status of ['canceled', 'paused'] as const) {
      expect(
        decideAccess({ now: NOW, billingExempt: false, trialEndsAt: null, subscription: { status, currentPeriodEnd: future(10) } }).state,
      ).toBe('expired');
    }
  });

  it('keeps past-due companies working until the period they paid for ends', () => {
    expect(
      decideAccess({ now: NOW, billingExempt: false, trialEndsAt: null, subscription: { status: 'past_due', currentPeriodEnd: future(3) } }).state,
    ).toBe('subscribed');
  });

  it('grandfathers existing companies regardless of their trial clock', () => {
    expect(decideAccess({ now: NOW, billingExempt: true, trialEndsAt: null, subscription: null }).state).toBe('grandfathered');
    expect(decideAccess({ now: NOW, billingExempt: true, trialEndsAt: past(100), subscription: null }).state).toBe('grandfathered');
  });
});

describe('decideAccess with an activation code', () => {
  it('gives access while the activated period lasts, after the trial has ended', () => {
    const decision = decideAccess({ now: NOW, billingExempt: false, trialEndsAt: past(10), subscription: null, activatedUntil: future(30) });
    expect(decision).toEqual({ state: 'activated', trialDaysLeft: null });
    expect(hasProductAccess(decision)).toBe(true);
  });

  it('expires when the activated period has ended', () => {
    expect(decideAccess({ now: NOW, billingExempt: false, trialEndsAt: past(10), subscription: null, activatedUntil: past(1) }).state).toBe('expired');
  });
});
