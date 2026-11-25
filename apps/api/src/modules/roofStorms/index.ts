// Hailstorm Map + Storm Response (roofing).
//
//   GET  /roof-storms/events?days=30        hail events from the NOAA Storm Prediction Center
//   GET  /roof-storms/impact?eventId=...    company addresses in the hail path + revenue estimate
//   POST /roof-storms/refresh              re-fetch the NOAA feed now
//   GET  /roof-storms/sms/status           whether an SMS provider is connected (and what is missing)
//   POST /roof-storms/sms/draft            draft texts for OPTED-IN contacts in the hail path only
//   POST /roof-storms/sms/send             send those drafts — only when a provider is configured
//
// (Registered under the /v1 prefix by the coordinator; see apps/api/src/modules/registry.ts.)
//
// Honesty rules, enforced here:
// - Storm data comes only from the live NOAA feed; a down feed is an `unavailable`
//   response, never invented rows.
// - Revenue is matched roofs × the company's own average priced roof-estimate
//   total, labelled "estimate" everywhere; with no priced estimates it is null
//   with "insufficient data".
// - Impact matches the company's stored properties (roof jobs and CRM leads
//   linked to a property) that carry a confirmed/geocoded pin inside the hail
//   radius. Permit leads are NOT matched here: the funnel re-fetches permits
//   live and the city feeds publish no stored coordinates, so there is nothing
//   honest to match against — properties without a pin are counted, not placed.
// - SMS goes only to contacts with a phone number AND a granted `sms` consent
//   row in the consent ledger (latest row wins; withdrawal supersedes). Everyone
//   else is counted as excluded and never texted. Drafts are returned, nothing
//   is sent, until /sms/send — which refuses with a 409 when no provider is
//   configured instead of faking a success.
// - SMS is standalone: it is NOT wired into the notifications service, whose
//   SMS path is suppressed for every category by design.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  consents,
  contacts,
  estimateRevisions,
  estimates,
  leads,
  organizations,
  properties,
  roofOrders,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { getSmsProvider, smsStatusFromEnv } from '../../services/sms';
import type { Tx } from '../../db/runtime';
import {
  averageJobValueMinor,
  buildStormDraft,
  getCachedHailEvents,
  haversineMiles,
  refreshHailEvents,
  SPC_SOURCE,
  HailEventSchema,
  HailFeedResultSchema,
  type HailEvent,
} from './storms';

const DEFAULT_RADIUS_MILES = 25;
const MAX_RADIUS_MILES = 100;

const EventsQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(30) });
const ImpactQuery = z.object({
  eventId: z.string().min(1).max(200),
  radiusMiles: z.coerce.number().min(1).max(MAX_RADIUS_MILES).default(DEFAULT_RADIUS_MILES),
});
const StormBody = z.object({
  eventId: z.string().min(1).max(200),
  radiusMiles: z.coerce.number().min(1).max(MAX_RADIUS_MILES).default(DEFAULT_RADIUS_MILES),
});

const ContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  smsOptedIn: z.boolean(),
});

const MatchedAddressSchema = z.object({
  propertyId: z.string(),
  address: z.string(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  distanceMiles: z.number(),
  source: z.enum(['roof_job', 'crm_lead', 'property']),
  contact: ContactSchema.nullable(),
});

const ImpactResponseSchema = z.object({
  event: HailEventSchema,
  radiusMiles: z.number(),
  source: z.literal(SPC_SOURCE),
  checkedAt: z.string(),
  matched: z.array(MatchedAddressSchema),
  matchedCount: z.number().int(),
  propertiesWithoutLocation: z.number().int(),
  /** Estimate = matched roofs × the company's own average priced roof estimate. Null when unknowable. */
  revenueEstimateMinor: z.number().int().nullable(),
  averageJobValueMinor: z.number().int().nullable(),
  revenueLabel: z.string(),
  revenueNote: z.string(),
});

const DraftSchema = z.object({
  contactId: z.string(),
  name: z.string(),
  phone: z.string(),
  propertyId: z.string(),
  address: z.string(),
  body: z.string(),
});

const DraftResponseSchema = z.object({
  event: HailEventSchema,
  radiusMiles: z.number(),
  source: z.literal(SPC_SOURCE),
  checkedAt: z.string(),
  smsStatus: z.object({
    provider: z.literal('twilio'),
    state: z.enum(['configured', 'not_configured']),
    configured: z.boolean(),
    missing: z.array(z.string()),
    message: z.string(),
  }),
  drafts: z.array(DraftSchema),
  excluded: z.object({
    noPhone: z.number().int(),
    noSmsConsent: z.number().int(),
    total: z.number().int(),
  }),
  note: z.string(),
});

const SendResponseSchema = z.object({
  event: HailEventSchema,
  sent: z.number().int(),
  failed: z.number().int(),
  results: z.array(
    z.object({
      to: z.string(),
      name: z.string(),
      ok: z.boolean(),
      providerMessageId: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
});

const SmsStatusResponseSchema = z.object({
  provider: z.literal('twilio'),
  state: z.enum(['configured', 'not_configured']),
  configured: z.boolean(),
  missing: z.array(z.string()),
  fromNumberPresent: z.boolean(),
  message: z.string(),
});

interface MatchedAddress {
  propertyId: string;
  address: string;
  city: string | null;
  state: string | null;
  distanceMiles: number;
  source: 'roof_job' | 'crm_lead' | 'property';
  contact: {
    id: string;
    name: string;
    phone: string | null;
    smsOptedIn: boolean;
  } | null;
}

async function loadEvent(eventId: string): Promise<HailEvent> {
  const cached = await getCachedHailEvents({ days: 30 });
  const found = cached.events.find((e) => e.id === eventId);
  if (found) return found;
  const refreshed = await refreshHailEvents({ days: 30 });
  const retry = refreshed.events.find((e) => e.id === eventId);
  if (!retry) throw problem('not_found', 'No hail event with that id in the last 30 days of NOAA reports.');
  return retry;
}

/** Average of the org's own priced roof estimates (current revisions), or null. */
async function loadAverageJobValue(tx: Tx, orgId: string): Promise<number | null> {
  const rows = await tx
    .select({ totalMinor: estimateRevisions.totalMinor })
    .from(estimates)
    .innerJoin(estimateRevisions, eq(estimateRevisions.id, estimates.currentRevisionId))
    .where(
      and(
        eq(estimates.orgId, orgId),
        eq(estimates.productLine, 'roof'),
        eq(estimateRevisions.status, 'pricing_ready'),
      ),
    );
  return averageJobValueMinor(rows.map((r) => r.totalMinor));
}

async function loadCompanyName(tx: Tx, orgId: string): Promise<string> {
  const [org] = await tx
    .select({ displayName: organizations.displayName })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.displayName ?? 'your roofing contractor';
}

/**
 * Company properties with a pin inside the hail radius, with their CRM contact
 * (via a lead on that property) and whether that contact has granted SMS consent.
 * Properties without any pin are counted, not placed.
 */
async function findMatchedAddresses(
  tx: Tx,
  orgId: string,
  event: HailEvent,
  radiusMiles: number,
): Promise<{ matched: MatchedAddress[]; propertiesWithoutLocation: number }> {
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  const point = sql`ST_SetSRID(ST_MakePoint(${event.lon}, ${event.lat}), 4326)::geography`;
  const pin = sql`coalesce(${properties.confirmedLocation}, ${properties.location})`;
  const rows = await tx
    .select({
      id: properties.id,
      address: sql<string | null>`coalesce(nullif(${properties.normalizedAddress}, ''), nullif(${properties.line1}, ''), ${properties.originalQuery})`,
      city: properties.locality,
      state: properties.region,
      lat: sql<number | null>`ST_Y((${pin})::geometry)`,
      lon: sql<number | null>`ST_X((${pin})::geometry)`,
    })
    .from(properties)
    .where(
      and(
        eq(properties.orgId, orgId),
        sql`ST_DWithin(${pin}, ${point}, ${radiusMeters})`,
      ),
    );
  const [noLocation] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(properties)
    .where(
      and(
        eq(properties.orgId, orgId),
        isNull(properties.confirmedLocation),
        isNull(properties.location),
      ),
    );

  const propertyIds = rows.map((r) => r.id);
  const roofJobIds = new Set<string>();
  const leadByProperty = new Map<string, { contactId: string | null }>();
  const contactById = new Map<string, { id: string; name: string; phone: string | null }>();
  const smsGranted = new Set<string>();
  if (propertyIds.length > 0) {
    const jobs = await tx
      .select({ propertyId: roofOrders.propertyId })
      .from(roofOrders)
      .where(and(eq(roofOrders.orgId, orgId), inArray(roofOrders.propertyId, propertyIds)));
    for (const j of jobs) roofJobIds.add(j.propertyId);

    const leadRows = await tx
      .select({ propertyId: leads.propertyId, contactId: leads.contactId })
      .from(leads)
      .where(and(eq(leads.orgId, orgId), inArray(leads.propertyId, propertyIds)));
    const contactIds: string[] = [];
    for (const l of leadRows) {
      if (!l.propertyId) continue;
      if (!leadByProperty.has(l.propertyId)) leadByProperty.set(l.propertyId, { contactId: l.contactId });
      if (l.contactId) contactIds.push(l.contactId);
    }
    if (contactIds.length > 0) {
      const contactRows = await tx
        .select({ id: contacts.id, name: contacts.displayName, phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.orgId, orgId), inArray(contacts.id, contactIds)));
      for (const c of contactRows) contactById.set(c.id, c);
      // Latest SMS consent row per contact wins; a withdrawal supersedes a grant.
      const consentRows = await tx
        .select({ contactId: consents.contactId, status: consents.status, recordedAt: consents.recordedAt })
        .from(consents)
        .where(and(eq(consents.orgId, orgId), eq(consents.kind, 'sms'), inArray(consents.contactId, contactIds)))
        .orderBy(desc(consents.recordedAt));
      const seen = new Set<string>();
      for (const c of consentRows) {
        if (!c.contactId || seen.has(c.contactId)) continue;
        seen.add(c.contactId);
        if (c.status === 'granted') smsGranted.add(c.contactId);
      }
    }
  }

  const matched: MatchedAddress[] = rows
    .filter((r) => r.lat !== null && r.lon !== null)
    .map((r) => {
      const lead = leadByProperty.get(r.id);
      const contactRow = lead?.contactId ? contactById.get(lead.contactId) : undefined;
      const contact = contactRow
        ? {
            id: contactRow.id,
            name: contactRow.name,
            phone: contactRow.phone,
            smsOptedIn: smsGranted.has(contactRow.id),
          }
        : null;
      return {
        propertyId: r.id,
        address: r.address ?? 'Address not recorded',
        city: r.city,
        state: r.state,
        distanceMiles: Math.round(haversineMiles(event.lat, event.lon, r.lat!, r.lon!) * 10) / 10,
        source: roofJobIds.has(r.id) ? ('roof_job' as const) : lead ? ('crm_lead' as const) : ('property' as const),
        contact,
      };
    })
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
  return { matched, propertiesWithoutLocation: noLocation?.count ?? 0 };
}

async function buildImpact(
  tx: Tx,
  orgId: string,
  event: HailEvent,
  radiusMiles: number,
  checkedAt: string,
): Promise<z.infer<typeof ImpactResponseSchema>> {
  const { matched, propertiesWithoutLocation } = await findMatchedAddresses(tx, orgId, event, radiusMiles);
  const avg = await loadAverageJobValue(tx, orgId);
  const revenueEstimateMinor = avg === null ? null : avg * matched.length;
  return {
    event,
    radiusMiles,
    source: SPC_SOURCE,
    checkedAt,
    matched,
    matchedCount: matched.length,
    propertiesWithoutLocation,
    revenueEstimateMinor,
    averageJobValueMinor: avg,
    revenueLabel: 'estimate',
    revenueNote:
      avg === null
        ? 'Insufficient data: the company has no priced roof estimates yet, so no revenue estimate can be calculated.'
        : `Estimate: ${matched.length} matched roof(s) × the company's average priced roof estimate. Not a quote and not guaranteed work.`,
  };
}

const roofStormsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/roof-storms/events',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Hail events from the NOAA Storm Prediction Center daily storm reports',
        querystring: EventsQuery,
        response: { 200: HailFeedResultSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return getCachedHailEvents({ days: request.query.days });
    },
  );

  app.post(
    '/roof-storms/refresh',
    {
      config: { permission: 'job:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Re-fetch the NOAA hail feed now',
        response: { 200: HailFeedResultSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return refreshHailEvents({ days: 30 });
    },
  );

  app.get(
    '/roof-storms/impact',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Company addresses in a hail event’s path, with an estimated revenue figure',
        querystring: ImpactQuery,
        response: { 200: ImpactResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const event = await loadEvent(request.query.eventId);
      const checkedAt = new Date().toISOString();
      return tenantTx(request, (tx) => buildImpact(tx, org.orgId, event, request.query.radiusMiles, checkedAt));
    },
  );

  app.get(
    '/roof-storms/sms/status',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary: 'Whether an SMS provider is connected for storm texts (and what is missing)',
        response: { 200: SmsStatusResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return smsStatusFromEnv();
    },
  );

  app.post(
    '/roof-storms/sms/draft',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Draft storm texts for opted-in contacts in the hail path — nothing is sent',
        body: StormBody,
        response: { 200: DraftResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const event = await loadEvent(request.body.eventId);
      const checkedAt = new Date().toISOString();
      return tenantTx(request, async (tx) => {
        const { matched } = await findMatchedAddresses(tx, org.orgId, event, request.body.radiusMiles);
        const companyName = await loadCompanyName(tx, org.orgId);
        const drafts: z.infer<typeof DraftSchema>[] = [];
        let noPhone = 0;
        let noSmsConsent = 0;
        for (const m of matched) {
          const c = m.contact;
          if (!c || !c.phone) {
            noPhone += 1;
            continue;
          }
          if (!c.smsOptedIn) {
            noSmsConsent += 1;
            continue;
          }
          drafts.push({
            contactId: c.id,
            name: c.name,
            phone: c.phone,
            propertyId: m.propertyId,
            address: m.address,
            body: buildStormDraft(event, { name: c.name, phone: c.phone }, companyName),
          });
        }
        const sms = smsStatusFromEnv();
        return {
          event,
          radiusMiles: request.body.radiusMiles,
          source: SPC_SOURCE,
          checkedAt,
          smsStatus: {
            provider: sms.provider,
            state: sms.state,
            configured: sms.configured,
            missing: sms.missing,
            message: sms.message,
          },
          drafts,
          excluded: { noPhone, noSmsConsent, total: noPhone + noSmsConsent },
          note: 'Drafts only — nothing has been sent. Contacts without a phone number or without granted SMS consent are excluded, never texted.',
        };
      });
    },
  );

  app.post(
    '/roof-storms/sms/send',
    {
      config: { permission: 'job:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Send storm texts to opted-in contacts in the hail path (provider required)',
        body: StormBody,
        response: { 200: SendResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const provider = getSmsProvider();
      const status = provider.status();
      if (!status.configured) {
        // 409-style honest refusal: never a fake success when nothing can send.
        throw problem(
          'precondition_failed',
          `SMS provider not connected — set ${status.missing.join(', ')} on the API service. No texts were sent.`,
          { status: 409 },
        );
      }
      const event = await loadEvent(request.body.eventId);
      // Recipients are rebuilt server-side from the event + consent ledger; the
      // client never supplies phone numbers to send to.
      return tenantTx(request, async (tx) => {
        const { matched } = await findMatchedAddresses(tx, org.orgId, event, request.body.radiusMiles);
        const companyName = await loadCompanyName(tx, org.orgId);
        const results: z.infer<typeof SendResponseSchema>['results'] = [];
        let sent = 0;
        let failed = 0;
        for (const m of matched) {
          const c = m.contact;
          if (!c || !c.phone || !c.smsOptedIn) continue;
          const body = buildStormDraft(event, { name: c.name, phone: c.phone }, companyName);
          const outcome = await provider.send(c.phone, body);
          if (outcome.ok) sent += 1;
          else failed += 1;
          results.push({
            to: c.phone,
            name: c.name,
            ok: outcome.ok,
            providerMessageId: outcome.providerMessageId,
            error: outcome.error,
          });
        }
        return { event, sent, failed, results };
      });
    },
  );
};

export default roofStormsModule;
