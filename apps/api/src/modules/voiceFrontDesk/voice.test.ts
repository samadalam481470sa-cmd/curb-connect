// Voice front desk: pure-logic tests with a mocked provider (env objects only).
// No database, no network, no real telephony provider.
import { describe, expect, it } from 'vitest';
import { createMemoryInspectionStore } from '../inspections/store';
import {
  handleVoiceCallIntent,
  normalizeVoiceAddress,
  parseVoiceWebhookPayload,
  voiceStatusFromEnv,
  VOICE_INTENTS,
  type VoiceWebhookPayload,
} from './voice';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const ORG_ID = '11111111-1111-4111-8111-111111111111';

const CONFIGURED_ENV = {
  VOICE_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'mock-token',
  TWILIO_VOICE_NUMBER: '+15551234567',
  VOICE_WEBHOOK_ENABLED: 'true',
} as NodeJS.ProcessEnv;

const UNCONFIGURED_ENV = {} as NodeJS.ProcessEnv;

function payload(overrides: Partial<VoiceWebhookPayload> = {}): VoiceWebhookPayload {
  return {
    provider: 'twilio',
    callId: 'call-1',
    from: '+15550001111',
    to: '+15551234567',
    orgId: ORG_ID,
    intent: 'check_status',
    bookingId: null,
    address: null,
    startsAt: null,
    durationMinutes: null,
    transcript: null,
    ...overrides,
  };
}

describe('voiceStatusFromEnv', () => {
  it('is not configured with nothing set, and names the missing provider var', () => {
    const status = voiceStatusFromEnv(UNCONFIGURED_ENV);
    expect(status.configured).toBe(false);
    expect(status.state).toBe('not_configured');
    expect(status.provider).toBeNull();
    expect(status.missing).toEqual(['VOICE_PROVIDER']);
    expect(status.message).toContain('not connected');
    expect(status.message).not.toContain('ACx');
  });

  it('lists every missing Twilio var plus the webhook opt-in', () => {
    const status = voiceStatusFromEnv({ VOICE_PROVIDER: 'twilio' } as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_VOICE_NUMBER',
      'VOICE_WEBHOOK_ENABLED',
    ]);
  });

  it('stays off when the credentials are set but the webhook is not explicitly enabled', () => {
    const { VOICE_WEBHOOK_ENABLED, ...withoutFlag } = CONFIGURED_ENV;
    void VOICE_WEBHOOK_ENABLED;
    const status = voiceStatusFromEnv(withoutFlag as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(['VOICE_WEBHOOK_ENABLED']);
  });

  it('is configured only with provider + credentials + explicit webhook opt-in', () => {
    const status = voiceStatusFromEnv(CONFIGURED_ENV);
    expect(status.configured).toBe(true);
    expect(status.state).toBe('configured');
    expect(status.provider).toBe('twilio');
    expect(status.missing).toEqual([]);
    expect(status.message).toContain('connected (twilio)');
  });

  it('reports an unknown provider as unsupported, never as configured', () => {
    const status = voiceStatusFromEnv({ VOICE_PROVIDER: 'smoke-signals' } as NodeJS.ProcessEnv);
    expect(status.configured).toBe(false);
    expect(status.state).toBe('unsupported_provider');
    expect(status.message).toContain('not supported');
  });
});

describe('parseVoiceWebhookPayload', () => {
  it('accepts the generic shape', () => {
    const parsed = parseVoiceWebhookPayload({
      provider: 'twilio',
      callId: 'CA123',
      from: '+15550001111',
      to: '+15551234567',
      orgId: ORG_ID,
      intent: 'book_inspection',
      address: '12 Oak St, McKinney, TX',
      startsAt: '2026-11-25T14:00:00.000Z',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.intent).toBe('book_inspection');
      expect(parsed.payload.orgId).toBe(ORG_ID);
    }
  });

  it('rejects non-objects, missing provider/callId, and unknown intents', () => {
    expect(parseVoiceWebhookPayload('hello').ok).toBe(false);
    expect(parseVoiceWebhookPayload({}).ok).toBe(false);
    expect(parseVoiceWebhookPayload({ provider: 'twilio' }).ok).toBe(false);
    const badIntent = parseVoiceWebhookPayload({
      provider: 'twilio',
      callId: 'CA123',
      intent: 'order_pizza',
    });
    expect(badIntent.ok).toBe(false);
    if (!badIntent.ok) expect(badIntent.error).toContain(VOICE_INTENTS.join(', '));
  });

  it('fills optional fields with null instead of guessing', () => {
    const parsed = parseVoiceWebhookPayload({
      provider: 'twilio',
      callId: 'CA123',
      intent: 'check_status',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.from).toBeNull();
      expect(parsed.payload.orgId).toBeNull();
      expect(parsed.payload.address).toBeNull();
    }
  });
});

describe('handleVoiceCallIntent — provider gate', () => {
  it('handles nothing while no provider is connected, and touches no booking', async () => {
    const store = createMemoryInspectionStore();
    const status = voiceStatusFromEnv(UNCONFIGURED_ENV);
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'book_inspection', address: '12 Oak St', startsAt: '2026-11-25T14:00:00.000Z' }),
    );
    expect(outcome.handled).toBe(false);
    expect(outcome.code).toBe('dependency_unavailable');
    expect(outcome.reply).toContain('not connected');
    expect(outcome.note).toContain('No phone call was placed');
    expect(await store.list({})).toEqual([]);
  });

  it('refuses a configured-provider call with no company mapping, without guessing', async () => {
    const store = createMemoryInspectionStore();
    const status = voiceStatusFromEnv(CONFIGURED_ENV);
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ orgId: null, intent: 'check_status', address: '12 Oak St' }),
    );
    expect(outcome.handled).toBe(false);
    expect(outcome.code).toBe('dependency_unavailable');
    expect(outcome.reply).toContain('not connected');
    expect(outcome.note).toContain('not been mapped to a company');
  });
});

describe('handleVoiceCallIntent — configured provider (mocked)', () => {
  const status = voiceStatusFromEnv(CONFIGURED_ENV);

  async function seededStore() {
    const store = createMemoryInspectionStore();
    const booking = await store.create(
      {
        address: '12 Oak St, McKinney, TX',
        city: 'McKinney',
        startsAt: '2026-11-25T14:00:00.000Z',
        durationMinutes: 60,
        inspectorName: 'Dana',
      },
      NOW,
    );
    return { store, booking };
  }

  it('checks status by booking id and by spoken address (exact and short form)', async () => {
    const { store, booking } = await seededStore();
    const byId = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'check_status', bookingId: booking.id }),
    );
    expect(byId.handled).toBe(true);
    expect(byId.code).toBe('ok');
    expect(byId.reply).toContain('12 Oak St, McKinney, TX');
    expect(byId.reply).toContain('booked');
    expect(byId.reply).toContain('Dana');

    const byShortAddress = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'check_status', address: '12 oak st' }),
    );
    expect(byShortAddress.handled).toBe(true);
    expect(byShortAddress.booking?.id).toBe(booking.id);
    expect(normalizeVoiceAddress('12 Oak St, McKinney, TX')).toBe('12 oak st mckinney tx');
  });

  it('says plainly when no inspection matches', async () => {
    const { store } = await seededStore();
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'check_status', address: '99 Nowhere Rd' }),
    );
    expect(outcome.handled).toBe(false);
    expect(outcome.code).toBe('not_found');
    expect(outcome.reply).toContain('could not find');
  });

  it('books a free slot and reports it, without touching the crew calendar', async () => {
    const store = createMemoryInspectionStore();
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({
        intent: 'book_inspection',
        address: '45 Pine Ave, Dallas, TX',
        startsAt: '2026-11-26T15:00:00.000Z',
        durationMinutes: 60,
      }),
    );
    expect(outcome.handled).toBe(true);
    expect(outcome.code).toBe('ok');
    expect(outcome.booking?.status).toBe('booked');
    expect(outcome.booking?.scheduledInCrewCalendar).toBe(false);
    expect(outcome.reply).toContain('Booked');
    expect(outcome.note).toContain('not on the crew calendar');
    expect(await store.list({})).toHaveLength(1);
  });

  it('refuses a past time and a missing address', async () => {
    const store = createMemoryInspectionStore();
    const past = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({
        intent: 'book_inspection',
        address: '45 Pine Ave',
        startsAt: '2026-11-24T11:00:00.000Z',
      }),
    );
    expect(past.handled).toBe(false);
    expect(past.code).toBe('validation_failed');
    expect(past.reply).toContain('future time');

    const noAddress = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'book_inspection', startsAt: '2026-11-26T15:00:00.000Z' }),
    );
    expect(noAddress.code).toBe('validation_failed');
    expect(await store.list({})).toEqual([]);
  });

  it('refuses a double-booking at the same address and suggests free times', async () => {
    const { store } = await seededStore();
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({
        intent: 'book_inspection',
        address: '12 Oak St, McKinney, TX',
        startsAt: '2026-11-25T14:30:00.000Z',
      }),
    );
    expect(outcome.handled).toBe(false);
    expect(outcome.code).toBe('conflict');
    expect(outcome.reply).toContain('already taken');
    expect(outcome.alternatives?.length).toBeGreaterThan(0);
    expect(await store.list({})).toHaveLength(1);
  });

  it('confirms a booked inspection and refuses to confirm a cancelled one', async () => {
    const { store, booking } = await seededStore();
    const confirmed = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'confirm_inspection', bookingId: booking.id }),
    );
    expect(confirmed.handled).toBe(true);
    expect(confirmed.booking?.status).toBe('confirmed');
    expect(confirmed.reply).toContain('Confirmed');

    const cancelled = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'cancel_inspection', bookingId: booking.id }),
    );
    expect(cancelled.handled).toBe(true);
    expect(cancelled.booking?.status).toBe('cancelled');

    const again = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'confirm_inspection', bookingId: booking.id }),
    );
    expect(again.handled).toBe(false);
    expect(again.code).toBe('conflict');
    expect(again.reply).toContain('cancelled');
  });

  it('cancels by spoken address', async () => {
    const { store, booking } = await seededStore();
    const outcome = await handleVoiceCallIntent(
      { status, store, now: NOW },
      payload({ intent: 'cancel_inspection', address: '12 Oak St' }),
    );
    expect(outcome.handled).toBe(true);
    expect(outcome.booking?.id).toBe(booking.id);
    expect(outcome.booking?.status).toBe('cancelled');
    expect(outcome.reply).toContain('Cancelled');
  });
});
