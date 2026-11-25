// Voice front desk: gated-ready webhook entry point for incoming calls.
//
//   GET  /v1/voice-front-desk/status    whether a telephony provider is connected (and what is missing)
//   POST /v1/voice-front-desk/webhook   generic JSON incoming-call webhook (any provider, translated
//                                        into the generic shape in voice.ts)
//
// (Registered under the /v1 prefix by the coordinator; see apps/api/src/modules/registry.ts.)
//
// This is scaffolding, not a live phone line. No telephony provider is connected,
// so today the webhook answers 503 `dependency_unavailable` ("no telephony
// provider connected") for every call and handles nothing — it never pretends a
// call was handled. The webhook only dispatches when the owner has set
// VOICE_PROVIDER plus that provider's credentials AND VOICE_WEBHOOK_ENABLED=true
// (see voiceStatusFromEnv in voice.ts).
//
// Still blocked on the owner choosing a provider, and NOT done here:
//   * translating the provider's native payload (Twilio TwiML, Vonage NCCO, ...)
//     into the generic shape — the endpoint accepts the generic shape only;
//   * verifying the provider's request signature (the Stripe webhook in
//     modules/billing is the pattern to copy) — until that lands, the endpoint
//     must not be exposed publicly, which is why it stays off by default;
//   * mapping the called number to a company (orgId) — calls without an orgId
//     are refused with `dependency_unavailable`, never guessed;
//   * sharing one booking store with the in-app Front Desk routes. By default
//     this module has its own in-memory store; pass the same InspectionStore
//     instance the inspections module uses (or a persisted store, via a future
//     migration) when the provider is wired, or voice bookings will not show in
//     the in-app list.
//
// A dispatched call always answers HTTP 200 with a VoiceCallOutcome (handled +
// a speakable reply), even when the intent could not be completed — the voice
// agent needs words to say, not an HTTP error. Only the provider gate itself
// (503) and a malformed body (400) leave as errors.
import { PROBLEM_CONTENT_TYPE, ProblemSchema } from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg } from '../../http/context';
import { buildProblem, problem } from '../../http/problem';
import { InspectionSchema } from '../inspections';
import { createMemoryInspectionStore, type InspectionStore } from '../inspections/store';
import {
  handleVoiceCallIntent,
  parseVoiceWebhookPayload,
  VOICE_INTENTS,
  voiceStatusFromEnv,
  type VoiceStatus,
} from './voice';

const VoiceStatusSchema: z.ZodType<VoiceStatus> = z.object({
  provider: z.string().nullable(),
  state: z.enum(['configured', 'not_configured', 'unsupported_provider']),
  configured: z.boolean(),
  missing: z.array(z.string()),
  message: z.string(),
});

const VoiceOutcomeSchema = z.object({
  handled: z.boolean(),
  code: z.enum(['ok', 'dependency_unavailable', 'validation_failed', 'not_found', 'conflict']),
  reply: z.string(),
  booking: InspectionSchema.optional(),
  alternatives: z.array(z.string()).optional(),
  note: z.string(),
});

export function createVoiceFrontDeskRoutes(deps: {
  now?: Date;
  inspectionStore?: InspectionStore;
  env?: NodeJS.ProcessEnv;
} = {}): FastifyPluginAsyncZod {
  const sharedStore = deps.inspectionStore ?? createMemoryInspectionStore();
  const env = deps.env ?? process.env;
  const voiceModule: FastifyPluginAsyncZod = async (app) => {
    const store = sharedStore;

    app.get(
      '/voice-front-desk/status',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Whether a telephony provider is connected for the voice front desk',
          response: { 200: VoiceStatusSchema },
        },
      },
      async (request) => {
        requireOrg(request);
        return voiceStatusFromEnv(env);
      },
    );

    // Provider webhooks cannot carry a user session, so this route has no org
    // auth (like the Stripe webhook in modules/billing). The gate is the
    // provider configuration + VOICE_WEBHOOK_ENABLED; signature verification
    // and the called-number → company mapping are part of the provider wiring
    // and must land before this is exposed publicly.
    app.post(
      '/voice-front-desk/webhook',
      {
        config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary:
            'Incoming-call webhook for the voice front desk (generic JSON; 503 until a telephony provider is connected)',
          response: { 200: VoiceOutcomeSchema, 503: ProblemSchema },
        },
      },
      async (request, reply) => {
        const status = voiceStatusFromEnv(env);
        if (!status.configured) {
          return reply.code(503).type(PROBLEM_CONTENT_TYPE).send(
            buildProblem(request, {
              code: 'dependency_unavailable',
              detail:
                'No telephony provider is connected — the voice front desk cannot take calls yet. ' +
                `Set ${status.missing.join(', ')} on the API service to enable it. In-app booking only; no call was handled.`,
              retryable: false,
            }),
          );
        }
        const parsed = parseVoiceWebhookPayload(request.body);
        if (!parsed.ok) throw problem('validation_failed', parsed.error);
        const payload = parsed.payload;
        if (payload.provider !== status.provider) {
          throw problem(
            'validation_failed',
            `This voice front desk is connected to ${status.provider}, not ${payload.provider}.`,
          );
        }
        const outcome = await handleVoiceCallIntent(
          { status, store, now: deps.now ?? new Date() },
          payload,
        );
        if (outcome.code === 'dependency_unavailable') {
          return reply.code(503).type(PROBLEM_CONTENT_TYPE).send(
            buildProblem(request, {
              code: 'dependency_unavailable',
              detail:
                'The called number has not been mapped to a company yet, so the call cannot be routed to a booking. No call was handled.',
              retryable: false,
            }),
          );
        }
        return outcome;
      },
    );
  };
  return voiceModule;
}

export { VOICE_INTENTS };

const voiceFrontDeskModule: FastifyPluginAsyncZod = createVoiceFrontDeskRoutes();

export default voiceFrontDeskModule;
