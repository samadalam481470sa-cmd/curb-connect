// Inspection bookings store. Two implementations behind one interface (same
// pattern as the funnel stage store):
//   - createDbInspectionStore(): drizzle over roof_inspections (migration
//     0101). Tenant-scoped by orgId on every query. This is the production
//     store — bookings survive restarts.
//   - createMemoryInspectionStore(): in-memory, for unit tests and as the
//     graceful fallback before migration 0106 is applied (bookings then last
//     only for the process lifetime, exactly as before 0101).
//
// When a booking is linked to a job it is ALSO written to the `schedules`
// table (see index.ts), so it shows in the crew calendar; this store is the
// inspection's own status (booked → confirmed → completed / cancelled) and
// its address/notes.
import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
// NOTE: the barrel import below must stay first (circular schema graph — see
// permitLeads/funnel/store.ts for why).
import '../../db/schema';
import { roofInspections } from '../../db/schema/roofAgents';
import type { Tx } from '../../db/runtime';
import {
  canTransitionInspection,
  inspectionEnd,
  type InspectionBooking,
  type InspectionBookingInput,
  type InspectionStatus,
} from './inspections';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface InspectionStore {
  create(orgId: string, input: InspectionBookingInput, now: Date): Promise<InspectionBooking>;
  get(orgId: string, id: string): Promise<InspectionBooking | null>;
  list(
    orgId: string,
    filters: { jobId?: string; status?: InspectionStatus },
  ): Promise<InspectionBooking[]>;
  setStatus(
    orgId: string,
    id: string,
    status: InspectionStatus,
    now: Date,
  ): Promise<InspectionBooking | null>;
  setSchedule(orgId: string, id: string, scheduleId: string): Promise<InspectionBooking | null>;
}

function buildBooking(input: InspectionBookingInput, now: Date): InspectionBooking {
  const durationMinutes = input.durationMinutes ?? 60;
  return {
    id: randomUUID(),
    address: input.address.trim(),
    city: input.city?.trim() ? input.city.trim() : null,
    jobId: input.jobId ?? null,
    roofOrderId: input.roofOrderId ?? null,
    crewId: input.crewId ?? null,
    inspectorName: input.inspectorName?.trim() ? input.inspectorName.trim() : null,
    startsAt: new Date(input.startsAt).toISOString(),
    durationMinutes,
    endsAt: inspectionEnd(input.startsAt, durationMinutes),
    notes: input.notes?.trim() ? input.notes.trim() : null,
    status: 'booked',
    scheduleId: null,
    scheduledInCrewCalendar: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function createMemoryInspectionStore(): InspectionStore {
  const bookings = new Map<string, { orgId: string; booking: InspectionBooking }>();
  const owned = (orgId: string, id: string) => {
    const entry = bookings.get(id);
    return entry && entry.orgId === orgId ? entry : null;
  };
  return {
    async create(orgId, input, now) {
      const booking = buildBooking(input, now);
      bookings.set(booking.id, { orgId, booking });
      return booking;
    },
    async get(orgId, id) {
      return owned(orgId, id)?.booking ?? null;
    },
    async list(orgId, filters) {
      return [...bookings.values()]
        .filter((e) => e.orgId === orgId)
        .map((e) => e.booking)
        .filter((b) => (filters.jobId ? b.jobId === filters.jobId : true))
        .filter((b) => (filters.status ? b.status === filters.status : true))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    async setStatus(orgId, id, status, now) {
      const entry = owned(orgId, id);
      if (!entry) return null;
      if (!canTransitionInspection(entry.booking.status, status)) return null;
      const next = { ...entry.booking, status, updatedAt: now.toISOString() };
      bookings.set(id, { orgId, booking: next });
      return next;
    },
    async setSchedule(orgId, id, scheduleId) {
      const entry = owned(orgId, id);
      if (!entry) return null;
      const next = { ...entry.booking, scheduleId, scheduledInCrewCalendar: true };
      bookings.set(id, { orgId, booking: next });
      return next;
    },
  };
}

type InspectionRow = typeof roofInspections.$inferSelect;

/** Pure row → domain mapping (exported for unit tests). */
export function rowToInspectionBooking(row: InspectionRow): InspectionBooking {
  return {
    id: row.id,
    address: row.address,
    city: row.city,
    jobId: row.jobId,
    roofOrderId: row.roofOrderId,
    crewId: row.crewId,
    inspectorName: row.inspectorName,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    endsAt: row.endsAt.toISOString(),
    notes: row.notes,
    status: row.status,
    scheduleId: row.scheduleId,
    scheduledInCrewCalendar: row.scheduledInCrewCalendar,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createDbInspectionStore(run: TxRunner): InspectionStore {
  const getRow = (tx: Tx, orgId: string, id: string) =>
    tx
      .select()
      .from(roofInspections)
      .where(and(eq(roofInspections.orgId, orgId), eq(roofInspections.id, id)))
      .limit(1)
      .then((rows) => rows[0] ?? null);

  return {
    async create(orgId, input, now) {
      const booking = buildBooking(input, now);
      return run(async (tx) => {
        const [row] = await tx
          .insert(roofInspections)
          .values({
            id: booking.id,
            orgId,
            address: booking.address,
            city: booking.city,
            jobId: booking.jobId,
            roofOrderId: booking.roofOrderId,
            crewId: booking.crewId,
            inspectorName: booking.inspectorName,
            startsAt: new Date(booking.startsAt),
            durationMinutes: booking.durationMinutes,
            endsAt: new Date(booking.endsAt),
            notes: booking.notes,
            status: booking.status,
            scheduleId: null,
            scheduledInCrewCalendar: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!row) throw new Error('inspection insert returned no row');
        return rowToInspectionBooking(row);
      });
    },
    async get(orgId, id) {
      return run(async (tx) => {
        const row = await getRow(tx, orgId, id);
        return row ? rowToInspectionBooking(row) : null;
      });
    },
    async list(orgId, filters) {
      return run(async (tx) => {
        const conditions = [eq(roofInspections.orgId, orgId)];
        if (filters.jobId) conditions.push(eq(roofInspections.jobId, filters.jobId));
        if (filters.status) conditions.push(eq(roofInspections.status, filters.status));
        const rows = await tx
          .select()
          .from(roofInspections)
          .where(and(...conditions))
          .orderBy(asc(roofInspections.startsAt));
        return rows.map(rowToInspectionBooking);
      });
    },
    async setStatus(orgId, id, status, now) {
      return run(async (tx) => {
        const current = await getRow(tx, orgId, id);
        if (!current) return null;
        if (!canTransitionInspection(current.status, status)) return null;
        const [row] = await tx
          .update(roofInspections)
          .set({ status, updatedAt: now })
          .where(and(eq(roofInspections.orgId, orgId), eq(roofInspections.id, id)))
          .returning();
        return row ? rowToInspectionBooking(row) : null;
      });
    },
    async setSchedule(orgId, id, scheduleId) {
      return run(async (tx) => {
        const [row] = await tx
          .update(roofInspections)
          .set({ scheduleId, scheduledInCrewCalendar: true, updatedAt: new Date() })
          .where(and(eq(roofInspections.orgId, orgId), eq(roofInspections.id, id)))
          .returning();
        return row ? rowToInspectionBooking(row) : null;
      });
    },
  };
}

/**
 * DB store with an in-memory fallback: if the database call fails (e.g.
 * migration 0106 not applied yet), the memory store answers so the endpoints
 * keep working with process-lifetime state — the pre-0101 behavior.
 */
export function createResilientInspectionStore(
  db: InspectionStore,
  memory: InspectionStore,
): InspectionStore {
  const wrap = <T>(fn: (s: InspectionStore) => Promise<T>): Promise<T> =>
    fn(db).catch(() => fn(memory));
  return {
    create: (orgId, input, now) => wrap((s) => s.create(orgId, input, now)),
    get: (orgId, id) => wrap((s) => s.get(orgId, id)),
    list: (orgId, filters) => wrap((s) => s.list(orgId, filters)),
    setStatus: (orgId, id, status, now) => wrap((s) => s.setStatus(orgId, id, status, now)),
    setSchedule: (orgId, id, scheduleId) => wrap((s) => s.setSchedule(orgId, id, scheduleId)),
  };
}
