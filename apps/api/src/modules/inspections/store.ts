// Inspection bookings: in-memory store for the process lifetime.
//
// There is no roof_inspections table yet (no migration in this build), so bookings
// live here in memory — the same pattern the funnel used before migration 0035.
// When a booking is linked to a job it is ALSO written to the `schedules` table
// (see index.ts), so it shows in the crew calendar and survives restarts; the
// in-memory record is the inspection's own status (booked → confirmed →
// completed / cancelled) and its address/notes. A future migration can persist
// these rows without changing the booking logic.
import { randomUUID } from 'node:crypto';
import {
  canTransitionInspection,
  inspectionEnd,
  type InspectionBooking,
  type InspectionBookingInput,
  type InspectionStatus,
} from './inspections';

export interface InspectionStore {
  create(input: InspectionBookingInput, now: Date): Promise<InspectionBooking>;
  get(id: string): Promise<InspectionBooking | null>;
  list(filters: { jobId?: string; status?: InspectionStatus }): Promise<InspectionBooking[]>;
  setStatus(
    id: string,
    status: InspectionStatus,
    now: Date,
  ): Promise<InspectionBooking | null>;
  setSchedule(id: string, scheduleId: string): Promise<InspectionBooking | null>;
}

export function createMemoryInspectionStore(): InspectionStore {
  const bookings = new Map<string, InspectionBooking>();
  return {
    async create(input, now) {
      const durationMinutes = input.durationMinutes ?? 60;
      const booking: InspectionBooking = {
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
      bookings.set(booking.id, booking);
      return booking;
    },
    async get(id) {
      return bookings.get(id) ?? null;
    },
    async list(filters) {
      return [...bookings.values()]
        .filter((b) => (filters.jobId ? b.jobId === filters.jobId : true))
        .filter((b) => (filters.status ? b.status === filters.status : true))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    },
    async setStatus(id, status, now) {
      const current = bookings.get(id);
      if (!current) return null;
      if (!canTransitionInspection(current.status, status)) return null;
      const next = { ...current, status, updatedAt: now.toISOString() };
      bookings.set(id, next);
      return next;
    },
    async setSchedule(id, scheduleId) {
      const current = bookings.get(id);
      if (!current) return null;
      const next = { ...current, scheduleId, scheduledInCrewCalendar: true };
      bookings.set(id, next);
      return next;
    },
  };
}
