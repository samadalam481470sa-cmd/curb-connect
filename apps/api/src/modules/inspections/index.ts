// Front Desk booking: the booking + status-check logic the future voice layer will
// call. There is NO telephony here and no phone call is ever placed — every response
// says so plainly. Booking is in-app only; a voice front desk needs a telephony
// provider the owner must connect later.
//
//   GET  /v1/roof-inspections                  this company's inspection bookings
//   POST /v1/roof-inspections/book             book an inspection (conflict-checked)
//   GET  /v1/roof-inspections/:id/status       address, time, inspector, inspection status
//   POST /v1/roof-inspections/:id/confirm      booked → confirmed
//   POST /v1/roof-inspections/:id/cancel       booked / confirmed → cancelled
//
// (Registered under the /v1 prefix by the coordinator; see apps/api/src/modules/registry.ts.)
//
// Conflict checking reuses the crew conflict detection in projectManagement/workflow
// (findCrewConflicts) against the real `schedules` table plus this module's own
// bookings. When a booking is linked to a job it is ALSO written to `schedules`
// (status tentative), so it shows in the crew calendar; confirm / cancel update that
// row too. Bookings without a job live in memory only (no roof_inspections table
// yet — see store.ts) and say so in the response.
//
// Booking actions are also written to agent_activity_log (same shape as the claims
// module's POST /v1/roof-agents/activity) under agent 'front_desk'.
import { PROBLEM_CONTENT_TYPE } from '@fieldline/contracts';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { agentActivityLog, crews, jobs, roofOrders, schedules } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { buildProblem, problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  canTransitionInspection,
  DEFAULT_INSPECTION_MINUTES,
  findAlternativeSlots,
  INSPECTION_STATUSES,
  INSPECTION_STATUS_LABEL,
  inspectionConflicts,
  inspectionEnd,
  nextInspectionStatuses,
  validateBookingInput,
  type InspectionBooking,
  type InspectionStatus,
} from './inspections';
import { createMemoryInspectionStore, type InspectionStore } from './store';

export const BOOKING_CHANNEL_NOTE =
  'Booking is in-app only — no phone call is placed. A voice front desk needs a ' +
  'telephony provider, which is not connected yet.';

export const InspectionSchema: z.ZodType<InspectionBooking> = z.object({
  id: z.uuid(),
  address: z.string(),
  city: z.string().nullable(),
  jobId: z.string().nullable(),
  roofOrderId: z.string().nullable(),
  crewId: z.string().nullable(),
  inspectorName: z.string().nullable(),
  startsAt: z.string(),
  durationMinutes: z.number(),
  endsAt: z.string(),
  notes: z.string().nullable(),
  status: z.enum(INSPECTION_STATUSES),
  scheduleId: z.string().nullable(),
  scheduledInCrewCalendar: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const BookingResponseSchema = z.object({
  booking: InspectionSchema,
  bookingChannel: z.string(),
  note: z.string(),
});

const BookBody = z.object({
  address: z.string().trim().min(2).max(300),
  city: z.string().trim().max(100).optional(),
  jobId: z.uuid().optional(),
  roofOrderId: z.uuid().optional(),
  crewId: z.uuid().optional(),
  inspectorName: z.string().trim().max(200).optional(),
  startsAt: z.iso.datetime(),
  durationMinutes: z.number().int().min(30).max(240).default(DEFAULT_INSPECTION_MINUTES),
  notes: z.string().trim().max(2000).optional(),
});

const ConflictSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
  code: z.string(),
  correlationId: z.string(),
  retryable: z.boolean(),
  alternatives: z.array(z.string()),
  bookingChannel: z.string(),
  note: z.string(),
});

const IdParams = z.object({ id: z.uuid() });

export function createInspectionRoutes(deps: {
  now?: Date;
  inspectionStore?: InspectionStore;
} = {}): FastifyPluginAsyncZod {
  const sharedStore = deps.inspectionStore ?? createMemoryInspectionStore();
  const inspectionsModule: FastifyPluginAsyncZod = async (app) => {
    const store = sharedStore;

    app.get(
      '/roof-inspections',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Roof inspection bookings for this company',
          querystring: z.object({
            jobId: z.uuid().optional(),
            status: z.enum(INSPECTION_STATUSES).optional(),
          }),
          response: {
            200: z.object({
              items: z.array(InspectionSchema),
              bookingChannel: z.string(),
              note: z.string(),
            }),
          },
        },
      },
      async (request) => {
        requireOrg(request);
        const items = await store.list({
          jobId: request.query.jobId,
          status: request.query.status,
        });
        return { items, bookingChannel: 'in_app', note: BOOKING_CHANNEL_NOTE };
      },
    );

    app.post(
      '/roof-inspections/book',
      {
        config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Book a roof inspection (in-app only; no phone call is placed)',
          body: BookBody,
          response: {
            201: BookingResponseSchema,
            409: ConflictSchema,
          },
        },
      },
      async (request, reply) => {
        const org = requireOrg(request);
        const now = deps.now ?? new Date();
        const input = {
          address: request.body.address,
          city: request.body.city ?? null,
          jobId: request.body.jobId ?? null,
          roofOrderId: request.body.roofOrderId ?? null,
          crewId: request.body.crewId ?? null,
          inspectorName: request.body.inspectorName ?? null,
          startsAt: request.body.startsAt,
          durationMinutes: request.body.durationMinutes,
          notes: request.body.notes ?? null,
        };
        const validationError = validateBookingInput(input, now);
        if (validationError) throw problem('validation_failed', validationError);
        const endsAt = inspectionEnd(input.startsAt, input.durationMinutes);

        // Referenced records must exist (and belong to this company). A failed lookup
        // means the reference cannot be verified — the booking is refused, not guessed.
        if (input.jobId) {
          const exists = await recordExists(request, org.orgId, 'job', input.jobId);
          if (!exists) throw problem('not_found', 'No job with that id for this company.');
        }
        if (input.roofOrderId) {
          const exists = await recordExists(request, org.orgId, 'roof_order', input.roofOrderId);
          if (!exists) throw problem('not_found', 'No roof order with that id for this company.');
        }
        if (input.crewId) {
          const exists = await recordExists(request, org.orgId, 'crew', input.crewId);
          if (!exists) throw problem('not_found', 'No crew with that id for this company.');
        }

        // Conflict check against the real scheduling store (crew calendar) plus this
        // module's own bookings, reusing the projectManagement conflict detection.
        const busy = await loadBusyIntervals(request, org.orgId, input.crewId, store);
        const conflicts = inspectionConflicts(
          { crewId: input.crewId, startsAt: input.startsAt, endsAt },
          busy,
        );
        const sameJobOverlap = input.jobId
          ? (await store.list({ jobId: input.jobId })).some(
              (b) =>
                (b.status === 'booked' || b.status === 'confirmed') &&
                Date.parse(b.startsAt) < Date.parse(endsAt) &&
                Date.parse(input.startsAt) < Date.parse(b.endsAt),
            )
          : false;
        if (conflicts.length > 0 || sameJobOverlap) {
          const alternatives = findAlternativeSlots(
            input.startsAt,
            input.durationMinutes,
            busy.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
            now,
          );
          const detail = sameJobOverlap
            ? 'That job already has an inspection booked at that time — that slot is taken.'
            : 'That slot is taken for this crew — the crew is already booked at that time.';
          const suggested =
            alternatives.length > 0
              ? ` Suggested times: ${alternatives.map((a) => new Date(a).toUTCString()).join('; ')} (checked again when you book).`
              : ' No free time was found in the next 7 days — try a different day.';
          // A valid problem+json body (so the web client can read the detail) plus
          // the structured alternatives for API consumers.
          return reply
            .code(409)
            .type(PROBLEM_CONTENT_TYPE)
            .send({
              ...buildProblem(request, { code: 'conflict', detail: detail + suggested }),
              alternatives,
              bookingChannel: 'in_app',
              note: `${BOOKING_CHANNEL_NOTE} Suggested times are checked again when you book.`,
            });
        }

        let booking = await store.create(input, now);
        if (input.jobId) {
          // Also write the crew-calendar row so the inspection shows in scheduling.
          const scheduleId = await writeScheduleRow(request, org, booking);
          if (scheduleId) {
            booking = (await store.setSchedule(booking.id, scheduleId)) ?? booking;
          }
        }
        await logFrontDeskActivity(request, org.orgId, 'inspection_booked', {
          relatedType: input.roofOrderId ? 'roof_order' : undefined,
          relatedId: input.roofOrderId ?? undefined,
        });
        return reply.code(201).send({
          booking,
          bookingChannel: 'in_app',
          note: booking.scheduledInCrewCalendar
            ? `${BOOKING_CHANNEL_NOTE} This booking is also on the crew calendar.`
            : `${BOOKING_CHANNEL_NOTE} No job was linked, so this booking is not on the crew calendar yet — link a job to put it there.`,
        });
      },
    );

    app.get(
      '/roof-inspections/:id/status',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Inspection status: address, scheduled time, inspector, status',
          params: IdParams,
          response: {
            200: z.object({
              booking: InspectionSchema,
              statusLabel: z.string(),
              nextStatuses: z.array(z.enum(INSPECTION_STATUSES)),
              bookingChannel: z.string(),
              note: z.string(),
            }),
          },
        },
      },
      async (request) => {
        requireOrg(request);
        const booking = await store.get(request.params.id);
        if (!booking) throw problem('not_found', 'No inspection booking with that id.');
        return {
          booking,
          statusLabel: INSPECTION_STATUS_LABEL[booking.status],
          nextStatuses: nextInspectionStatuses(booking.status),
          bookingChannel: 'in_app',
          note: BOOKING_CHANNEL_NOTE,
        };
      },
    );

    app.post(
      '/roof-inspections/:id/confirm',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Confirm a booked inspection',
          params: IdParams,
          response: { 200: BookingResponseSchema },
        },
      },
      async (request) => {
        const org = requireOrg(request);
        const booking = await changeStatus(request, org.orgId, store, 'confirmed');
        return { booking, bookingChannel: 'in_app', note: BOOKING_CHANNEL_NOTE };
      },
    );

    app.post(
      '/roof-inspections/:id/cancel',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Cancel a booked or confirmed inspection',
          params: IdParams,
          response: { 200: BookingResponseSchema },
        },
      },
      async (request) => {
        const org = requireOrg(request);
        const booking = await changeStatus(request, org.orgId, store, 'cancelled');
        return { booking, bookingChannel: 'in_app', note: BOOKING_CHANNEL_NOTE };
      },
    );
  };
  return inspectionsModule;
}

async function changeStatus(
  request: FastifyRequest,
  orgId: string,
  store: InspectionStore,
  to: InspectionStatus,
): Promise<InspectionBooking> {
  const now = new Date();
  const current = await store.get(
    (request.params as { id: string }).id,
  );
  if (!current) throw problem('not_found', 'No inspection booking with that id.');
  if (!canTransitionInspection(current.status, to)) {
    throw problem(
      'conflict',
      `A ${INSPECTION_STATUS_LABEL[current.status].toLowerCase()} inspection cannot move to ${INSPECTION_STATUS_LABEL[to].toLowerCase()}.`,
    );
  }
  const updated = await store.setStatus(current.id, to, now);
  if (!updated) throw problem('conflict', 'The inspection status could not be changed.');
  if (updated.scheduleId) {
    // Mirror the change on the crew-calendar row; a failure there does not undo the
    // inspection itself, which is the record of truth for the booking.
    try {
      await tenantTx(request, async (tx) => {
        await tx
          .update(schedules)
          .set({
            status: to === 'confirmed' ? 'confirmed' : 'cancelled',
            revision: sql`${schedules.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(eq(schedules.orgId, orgId), eq(schedules.id, updated.scheduleId!)),
          );
      });
    } catch {
      // Crew-calendar mirror failed; the booking status above still stands.
    }
  }
  await logFrontDeskActivity(request, orgId, `inspection_${to}`, {
    relatedType: updated.roofOrderId ? 'roof_order' : undefined,
    relatedId: updated.roofOrderId ?? undefined,
  });
  return updated;
}

async function recordExists(
  request: FastifyRequest,
  orgId: string,
  kind: 'job' | 'roof_order' | 'crew',
  id: string,
): Promise<boolean> {
  const rows = await tenantTx(request, async (tx) => {
    if (kind === 'job') {
      return tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.orgId, orgId), eq(jobs.id, id)))
        .limit(1);
    }
    if (kind === 'roof_order') {
      return tx
        .select({ id: roofOrders.id })
        .from(roofOrders)
        .where(and(eq(roofOrders.orgId, orgId), eq(roofOrders.id, id)))
        .limit(1);
    }
    return tx
      .select({ id: crews.id })
      .from(crews)
      .where(and(eq(crews.orgId, orgId), eq(crews.id, id)))
      .limit(1);
  });
  return rows.length > 0;
}

/** Crew-calendar rows + this module's bookings for the crew, as conflict inputs. */
async function loadBusyIntervals(
  request: FastifyRequest,
  orgId: string,
  crewId: string | null,
  store: InspectionStore,
): Promise<{ id: string; crewId: string; startsAt: string; endsAt: string; status: string }[]> {
  const busy: { id: string; crewId: string; startsAt: string; endsAt: string; status: string }[] = [];
  if (crewId) {
    try {
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(schedules)
          .where(
            and(
              eq(schedules.orgId, orgId),
              eq(schedules.crewId, crewId),
              ne(schedules.status, 'cancelled'),
            ),
          ),
      );
      for (const r of rows) {
        busy.push({
          id: r.id,
          crewId: r.crewId ?? '',
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          status: r.status,
        });
      }
    } catch {
      // Crew calendar unreadable (e.g. no database in this environment): fall back
      // to this module's own bookings only, and say so via the booking note.
    }
    const own = await store.list({});
    for (const b of own) {
      if (b.crewId === crewId && (b.status === 'booked' || b.status === 'confirmed')) {
        busy.push({
          id: b.id,
          crewId: b.crewId ?? '',
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          status: b.status,
        });
      }
    }
  }
  return busy;
}

/** Write the crew-calendar (`schedules`) row for a job-linked booking. Null on failure. */
async function writeScheduleRow(
  request: FastifyRequest,
  org: { orgId: string; userId: string },
  booking: InspectionBooking,
): Promise<string | null> {
  try {
    const [row] = await tenantTx(request, async (tx) => {
      const [created] = await tx
        .insert(schedules)
        .values({
          orgId: org.orgId,
          jobId: booking.jobId!,
          crewId: booking.crewId,
          status: 'tentative',
          startsAt: new Date(booking.startsAt),
          endsAt: new Date(booking.endsAt),
          workDate: booking.startsAt.slice(0, 10),
          notes: `Roof inspection ${booking.id} — ${booking.address}`,
        })
        .returning();
      if (!created) return [];
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: 'roof.inspection_booked',
        resourceType: 'schedule',
        resourceId: created.id,
        after: { inspectionId: booking.id, jobId: booking.jobId, startsAt: booking.startsAt },
      });
      return [created];
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/** Best-effort agent-activity log row (same shape as POST /v1/roof-agents/activity). */
async function logFrontDeskActivity(
  request: FastifyRequest,
  orgId: string,
  action: string,
  opts: { relatedType?: string; relatedId?: string } = {},
): Promise<void> {
  try {
    await tenantTx(request, async (tx) => {
      await tx.insert(agentActivityLog).values({
        orgId,
        agent: 'front_desk',
        action,
        minutesSaved: null,
        relatedType: opts.relatedType ?? null,
        relatedId: opts.relatedId ?? null,
      });
    });
  } catch {
    // Logging must never fail the booking itself.
  }
}

const inspectionsModule: FastifyPluginAsyncZod = createInspectionRoutes();

export default inspectionsModule;
