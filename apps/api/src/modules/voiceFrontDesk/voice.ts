// Voice front desk: provider-agnostic call-intent handling (gated-ready scaffolding).
//
// The roofing dashboard's AI Front Desk books inspections in-app only — there is
// NO telephony here, no phone call is ever placed or answered, and no provider is
// connected. This module is the honest scaffolding for the day the owner picks a
// telephony provider:
//
//   * `voiceStatusFromEnv` reports whether a provider is connected (and what is
//     missing) without ever exposing a secret. Nothing is "configured" until the
//     owner sets VOICE_PROVIDER plus that provider's credentials AND explicitly
//     enables the webhook with VOICE_WEBHOOK_ENABLED=true.
//   * `parseVoiceWebhookPayload` accepts the generic JSON shape any provider could
//     POST for an incoming call (provider, call id, caller/called numbers, and a
//     call intent). Providers differ in their native payloads (Twilio TwiML,
//     Vonage NCCO, ...); the provider wiring step translates the native payload
//     into this shape — that translation does not exist yet.
//   * `handleVoiceCallIntent` runs the intent against the real inspection booking
//     logic (address validation, slot suggestions, status transitions, and the
//     same-address overlap check) — but ONLY when a provider is configured. When it is not,
//     every call returns `handled: false` with code `dependency_unavailable` and
//     the reply says plainly that the voice front desk is not connected. A call
//     is never pretended to have been handled.
//
// What is still blocked on the owner choosing a provider (see the route file and
// the status message): the native-payload translator, request-signature
// verification for the webhook (the Stripe webhook in modules/billing is the
// pattern to copy), and mapping the called number to a company (orgId). Until
// that wiring lands, the webhook endpoint answers 503 `dependency_unavailable`
// for every call, and voice bookings live in the same in-memory store the
// in-app booking flow uses only when the two routes are given one shared store
// instance — by default this module has its own, and the wiring step must pass
// the shared one (see index.ts).
import {
  canTransitionInspection,
  findAlternativeSlots,
  INSPECTION_STATUS_LABEL,
  inspectionEnd,
  validateBookingInput,
  type InspectionBooking,
  type InspectionBookingInput,
  type InspectionStatus,
} from '../inspections/inspections';
import type { InspectionStore } from '../inspections/store';

export const VOICE_SUPPORTED_PROVIDERS = ['twilio'] as const;
export type VoiceSupportedProvider = (typeof VOICE_SUPPORTED_PROVIDERS)[number];

/** Env vars a Twilio voice front desk needs (plus VOICE_PROVIDER=twilio). */
export const TWILIO_VOICE_ENV_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_VOICE_NUMBER',
] as const;

/** Explicit opt-in: the webhook stays off until the owner enables it after wiring a provider. */
export const VOICE_WEBHOOK_ENABLED_VAR = 'VOICE_WEBHOOK_ENABLED';

export type VoiceProviderState = 'configured' | 'not_configured' | 'unsupported_provider';

export interface VoiceStatus {
  /** Provider named by VOICE_PROVIDER, or null when none is set. */
  provider: string | null;
  state: VoiceProviderState;
  configured: boolean;
  /** Env vars that are missing; empty when configured. Never includes values. */
  missing: string[];
  message: string;
}

export const VOICE_NOT_CONNECTED_MESSAGE =
  'Voice front desk is not connected — no telephony provider is set. ' +
  'In-app booking only; no phone calls are placed or answered.';

/** Provider status from the environment without ever exposing a secret. */
export function voiceStatusFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceStatus {
  const provider = env.VOICE_PROVIDER?.trim() || null;
  if (!provider) {
    return {
      provider: null,
      state: 'not_configured',
      configured: false,
      missing: ['VOICE_PROVIDER'],
      message: VOICE_NOT_CONNECTED_MESSAGE,
    };
  }
  if (!(VOICE_SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      provider,
      state: 'unsupported_provider',
      configured: false,
      missing: [],
      message:
        `Voice provider "${provider}" is not supported. ` +
        `Supported providers: ${VOICE_SUPPORTED_PROVIDERS.join(', ')}. ` +
        'No phone calls are placed or answered.',
    };
  }
  const missing: string[] = [];
  if (provider === 'twilio') {
    for (const key of TWILIO_VOICE_ENV_VARS) {
      if (!env[key]?.trim()) missing.push(key);
    }
  }
  if (env[VOICE_WEBHOOK_ENABLED_VAR]?.trim() !== 'true') {
    missing.push(VOICE_WEBHOOK_ENABLED_VAR);
  }
  if (missing.length > 0) {
    return {
      provider,
      state: 'not_configured',
      configured: false,
      missing,
      message:
        `Voice front desk is not connected — set ${missing.join(', ')} on the API service ` +
        'to enable it. In-app booking only; no phone calls are placed or answered.',
    };
  }
  return {
    provider,
    state: 'configured',
    configured: true,
    missing: [],
    message:
      `Voice front desk is connected (${provider}). Incoming calls are handled by the ` +
      'voice front desk; in-app booking still works.',
  };
}

export const VOICE_INTENTS = [
  'check_status',
  'book_inspection',
  'confirm_inspection',
  'cancel_inspection',
] as const;
export type VoiceIntent = (typeof VOICE_INTENTS)[number];

export function isVoiceIntent(v: unknown): v is VoiceIntent {
  return typeof v === 'string' && (VOICE_INTENTS as readonly string[]).includes(v);
}

/**
 * The generic JSON shape any telephony provider's incoming-call webhook is
 * translated into. `orgId` is the company the provider mapped the called
 * number (`to`) to — null until that mapping is wired, and calls without it
 * are refused, never guessed.
 */
export interface VoiceWebhookPayload {
  provider: string;
  callId: string;
  from: string | null;
  to: string | null;
  orgId: string | null;
  intent: VoiceIntent;
  bookingId: string | null;
  address: string | null;
  startsAt: string | null;
  durationMinutes: number | null;
  /** What the caller said, when the provider supplies a transcript. */
  transcript: string | null;
}

function optString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function optNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse an unknown webhook body into the generic shape, or say why it is unusable. */
export function parseVoiceWebhookPayload(
  input: unknown,
): { ok: true; payload: VoiceWebhookPayload } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: 'The call webhook body must be a JSON object.' };
  }
  const body = input as Record<string, unknown>;
  const provider = optString(body.provider);
  if (!provider) return { ok: false, error: 'The call webhook body needs a provider.' };
  const callId = optString(body.callId);
  if (!callId) return { ok: false, error: 'The call webhook body needs a callId.' };
  if (!isVoiceIntent(body.intent)) {
    return {
      ok: false,
      error: `Unknown call intent. Supported intents: ${VOICE_INTENTS.join(', ')}.`,
    };
  }
  return {
    ok: true,
    payload: {
      provider,
      callId,
      from: optString(body.from),
      to: optString(body.to),
      orgId: optString(body.orgId),
      intent: body.intent,
      bookingId: optString(body.bookingId),
      address: optString(body.address),
      startsAt: optString(body.startsAt),
      durationMinutes: optNumber(body.durationMinutes),
      transcript: optString(body.transcript),
    },
  };
}

export type VoiceOutcomeCode =
  | 'ok'
  | 'dependency_unavailable'
  | 'validation_failed'
  | 'not_found'
  | 'conflict';

export interface VoiceCallOutcome {
  /** False whenever nothing was handled — in particular while no provider is connected. */
  handled: boolean;
  code: VoiceOutcomeCode;
  /** Plain-language sentence the voice agent would speak to the caller. */
  reply: string;
  booking?: InspectionBooking;
  alternatives?: string[];
  /** Honest note about what did / did not happen. Never claims a call was placed. */
  note: string;
}

export const VOICE_NOTE =
  'No phone call was placed by Field Pro — this is the text the voice agent would ' +
  'speak once a telephony provider is connected.';

/** Normalize an address for matching a caller's spoken address to a booking. */
export function normalizeVoiceAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatWhen(startsAt: string): string {
  return new Date(startsAt).toUTCString();
}

function unavailableReply(status: VoiceStatus): string {
  return status.state === 'unsupported_provider'
    ? 'Sorry — the voice front desk is not set up for that phone provider yet, so I cannot help with inspections by phone. Please book in the Field Pro app.'
    : 'Sorry — the voice front desk is not connected yet, so I cannot help with inspections by phone. Please book in the Field Pro app.';
}

function dependencyOutcome(status: VoiceStatus, detail: string): VoiceCallOutcome {
  return {
    handled: false,
    code: 'dependency_unavailable',
    reply: unavailableReply(status),
    note: `${VOICE_NOTE} ${detail}`,
  };
}

/**
 * Run one parsed call intent against the inspection booking logic.
 * The provider gate is checked first: while no provider is configured (or the
 * called number has not been mapped to a company) nothing is looked up, booked
 * or changed, and the outcome says so.
 */
export async function handleVoiceCallIntent(
  deps: { status: VoiceStatus; store: InspectionStore; now: Date },
  payload: VoiceWebhookPayload,
): Promise<VoiceCallOutcome> {
  const { status, store, now } = deps;
  if (!status.configured) {
    return dependencyOutcome(
      status,
      'No telephony provider is connected, so no call was handled and nothing was booked or changed.',
    );
  }
  if (!payload.orgId) {
    return dependencyOutcome(
      status,
      'The called number has not been mapped to a company yet, so the call cannot be routed to a booking. No call was handled and nothing was booked or changed.',
    );
  }

  switch (payload.intent) {
    case 'check_status':
      return checkStatus(store, payload);
    case 'book_inspection':
      return bookInspection(store, now, payload);
    case 'confirm_inspection':
      return changeBookingStatus(store, payload, 'confirmed');
    case 'cancel_inspection':
      return changeBookingStatus(store, payload, 'cancelled');
  }
}

async function findBookingByAddress(
  store: InspectionStore,
  address: string,
): Promise<InspectionBooking | null> {
  const query = normalizeVoiceAddress(address);
  if (!query) return null;
  const bookings = await store.list({});
  const exact = bookings.find((b) => normalizeVoiceAddress(b.address) === query);
  if (exact) return exact;
  // A caller usually gives a short form ("12 Oak St") of the stored address
  // ("12 Oak St, McKinney, TX"); accept a prefix match, earliest first.
  const prefix = bookings
    .filter(
      (b) =>
        normalizeVoiceAddress(b.address).startsWith(query) ||
        query.startsWith(normalizeVoiceAddress(b.address)),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return prefix[0] ?? null;
}

function describeBooking(booking: InspectionBooking): string {
  const inspector = booking.inspectorName
    ? ` Inspector: ${booking.inspectorName}.`
    : ' No inspector is assigned yet.';
  return (
    `Your inspection at ${booking.address} is ${INSPECTION_STATUS_LABEL[booking.status].toLowerCase()} ` +
    `for ${formatWhen(booking.startsAt)}.${inspector}`
  );
}

async function checkStatus(
  store: InspectionStore,
  payload: VoiceWebhookPayload,
): Promise<VoiceCallOutcome> {
  let booking: InspectionBooking | null = null;
  if (payload.bookingId) booking = await store.get(payload.bookingId);
  else if (payload.address) booking = await findBookingByAddress(store, payload.address);
  if (!booking) {
    return {
      handled: false,
      code: 'not_found',
      reply:
        'I could not find an inspection for that address or booking. Please check the address and call back, or book in the Field Pro app.',
      note: VOICE_NOTE,
    };
  }
  return { handled: true, code: 'ok', reply: describeBooking(booking), booking, note: VOICE_NOTE };
}

async function bookInspection(
  store: InspectionStore,
  now: Date,
  payload: VoiceWebhookPayload,
): Promise<VoiceCallOutcome> {
  if (!payload.address || !payload.startsAt) {
    return {
      handled: false,
      code: 'validation_failed',
      reply:
        'To book an inspection by phone I need the property address and a date and time.',
      note: VOICE_NOTE,
    };
  }
  const input: InspectionBookingInput = {
    address: payload.address,
    startsAt: payload.startsAt,
    durationMinutes: payload.durationMinutes ?? 60,
  };
  const validationError = validateBookingInput(input, now);
  if (validationError) {
    return { handled: false, code: 'validation_failed', reply: validationError, note: VOICE_NOTE };
  }
  const endsAt = inspectionEnd(input.startsAt, input.durationMinutes!);
  // Conflict check against this module's own bookings for the same address.
  // The crew calendar (schedules table) is not consulted here — a voice
  // booking is not linked to a job or a crew, so it is not written to the
  // crew calendar; linking a job stays in-app until provider wiring adds
  // database access to this path.
  const own = await store.list({});
  const busy = own
    .filter((b) => b.status === 'booked' || b.status === 'confirmed')
    .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt }));
  const overlaps = own.some(
    (b) =>
      (b.status === 'booked' || b.status === 'confirmed') &&
      normalizeVoiceAddress(b.address) === normalizeVoiceAddress(input.address) &&
      Date.parse(b.startsAt) < Date.parse(endsAt) &&
      Date.parse(input.startsAt) < Date.parse(b.endsAt),
  );
  if (overlaps) {
    const alternatives = findAlternativeSlots(
      input.startsAt,
      input.durationMinutes!,
      busy,
      now,
    );
    const suggested =
      alternatives.length > 0
        ? ` Other times that are free: ${alternatives.map((a) => formatWhen(a)).join('; ')}.`
        : ' No free time was found in the next 7 days.';
    return {
      handled: false,
      code: 'conflict',
      reply: `That time is already taken for that address.${suggested}`,
      alternatives,
      note: `${VOICE_NOTE} Nothing was booked.`,
    };
  }
  const booking = await store.create(input, now);
  return {
    handled: true,
    code: 'ok',
    reply:
      `Booked — an inspection at ${booking.address} for ${formatWhen(booking.startsAt)}. ` +
      'You can confirm or cancel it in the Field Pro app.',
    booking,
    note: `${VOICE_NOTE} This booking is not on the crew calendar — link a job to it in the app to put it there.`,
  };
}

async function changeBookingStatus(
  store: InspectionStore,
  payload: VoiceWebhookPayload,
  to: Extract<InspectionStatus, 'confirmed' | 'cancelled'>,
): Promise<VoiceCallOutcome> {
  if (!payload.bookingId && !payload.address) {
    return {
      handled: false,
      code: 'validation_failed',
      reply: `To ${to === 'confirmed' ? 'confirm' : 'cancel'} an inspection by phone I need the booking or the property address.`,
      note: VOICE_NOTE,
    };
  }
  const current = payload.bookingId
    ? await store.get(payload.bookingId)
    : payload.address
      ? await findBookingByAddress(store, payload.address)
      : null;
  if (!current) {
    return {
      handled: false,
      code: 'not_found',
      reply: 'I could not find an inspection for that address or booking.',
      note: VOICE_NOTE,
    };
  }
  if (!canTransitionInspection(current.status, to)) {
    return {
      handled: false,
      code: 'conflict',
      reply:
        `That inspection is ${INSPECTION_STATUS_LABEL[current.status].toLowerCase()}, ` +
        `so it cannot be ${to === 'confirmed' ? 'confirmed' : 'cancelled'} now. ${describeBooking(current)}`,
      booking: current,
      note: VOICE_NOTE,
    };
  }
  const updated = await store.setStatus(current.id, to, new Date());
  if (!updated) {
    return {
      handled: false,
      code: 'conflict',
      reply: 'The inspection status could not be changed. Please try again or use the Field Pro app.',
      booking: current,
      note: VOICE_NOTE,
    };
  }
  return {
    handled: true,
    code: 'ok',
    reply:
      to === 'confirmed'
        ? `Confirmed — ${describeBooking(updated)}`
        : `Cancelled — the inspection at ${updated.address} for ${formatWhen(updated.startsAt)} is cancelled.`,
    booking: updated,
    note: VOICE_NOTE,
  };
}
