// Roof inspection booking: pure logic (no database, no network).
//
// Statuses: booked → confirmed → completed / cancelled. This is the booking and
// status-check logic the future voice layer will call — there is NO telephony here
// and no phone call is ever placed (see the `bookingChannel` / note on every
// response in index.ts). An inspection is a time-boxed visit: a start time plus a
// duration (default 60 minutes, 30–240).
import { findCrewConflicts, type CrewBooking } from '../projectManagement/workflow';

export const INSPECTION_STATUSES = ['booked', 'confirmed', 'completed', 'cancelled'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const INSPECTION_NEXT: Record<InspectionStatus, InspectionStatus[]> = {
  booked: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function canTransitionInspection(from: InspectionStatus, to: InspectionStatus): boolean {
  return from === to || INSPECTION_NEXT[from].includes(to);
}

export function nextInspectionStatuses(status: InspectionStatus): InspectionStatus[] {
  return [...INSPECTION_NEXT[status]];
}

export function isInspectionStatus(v: unknown): v is InspectionStatus {
  return typeof v === 'string' && (INSPECTION_STATUSES as readonly string[]).includes(v);
}

export const DEFAULT_INSPECTION_MINUTES = 60;
export const MIN_INSPECTION_MINUTES = 30;
export const MAX_INSPECTION_MINUTES = 240;

export interface InspectionBookingInput {
  address: string;
  city?: string | null;
  jobId?: string | null;
  roofOrderId?: string | null;
  crewId?: string | null;
  inspectorName?: string | null;
  startsAt: string;
  durationMinutes?: number;
  notes?: string | null;
}

export interface InspectionBooking extends Required<Omit<InspectionBookingInput, 'durationMinutes'>> {
  id: string;
  durationMinutes: number;
  endsAt: string;
  status: InspectionStatus;
  /** schedules row id when the booking was also written to the crew calendar. */
  scheduleId: string | null;
  scheduledInCrewCalendar: boolean;
  createdAt: string;
  updatedAt: string;
}

export function inspectionEnd(startsAt: string, durationMinutes: number): string {
  return new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString();
}

/** First validation problem, or null when the booking input is usable. */
export function validateBookingInput(
  input: InspectionBookingInput,
  now: Date,
): string | null {
  const address = input.address?.trim() ?? '';
  if (address.length < 2 || address.length > 300) {
    return 'An inspection address is required (2–300 characters).';
  }
  if (input.city !== undefined && input.city !== null) {
    const city = input.city.trim();
    if (city.length === 0 || city.length > 100) return 'City must be 1–100 characters.';
  }
  const start = Date.parse(input.startsAt);
  if (Number.isNaN(start)) return 'Start time must be a valid date and time.';
  if (start <= now.getTime()) return 'The inspection must be booked for a future time.';
  const duration = input.durationMinutes ?? DEFAULT_INSPECTION_MINUTES;
  if (!Number.isInteger(duration) || duration < MIN_INSPECTION_MINUTES || duration > MAX_INSPECTION_MINUTES) {
    return `Inspection duration must be ${MIN_INSPECTION_MINUTES}–${MAX_INSPECTION_MINUTES} minutes.`;
  }
  if (input.inspectorName !== undefined && input.inspectorName !== null) {
    const name = input.inspectorName.trim();
    if (name.length === 0 || name.length > 200) return 'Inspector name must be 1–200 characters.';
  }
  if (input.notes !== undefined && input.notes !== null && input.notes.length > 2000) {
    return 'Notes must be 2000 characters or fewer.';
  }
  return null;
}

/** Busy intervals (crew bookings or other inspections) that overlap a candidate slot. */
export function inspectionConflicts(
  candidate: { crewId: string | null; startsAt: string; endsAt: string },
  busy: readonly CrewBooking[],
): CrewBooking[] {
  if (!candidate.crewId) return [];
  return findCrewConflicts(
    { crewId: candidate.crewId, startsAt: candidate.startsAt, endsAt: candidate.endsAt },
    busy,
  );
}

const SLOT_STEP_MS = 30 * 60_000;
const ALT_SEARCH_DAYS = 7;
const WORKDAY_START_HOUR_UTC = 8;
const WORKDAY_END_HOUR_UTC = 17;

/** Up to 3 free start times after the requested one (30-minute steps, 08:00–17:00 UTC,
 *  up to 7 days out). Suggestions only — the slot is re-checked when booking. */
export function findAlternativeSlots(
  requestedStartsAt: string,
  durationMinutes: number,
  busy: readonly { startsAt: string; endsAt: string }[],
  now: Date,
  count = 3,
): string[] {
  const requested = Date.parse(requestedStartsAt);
  if (Number.isNaN(requested)) return [];
  const busyMs = busy
    .map((b) => ({ start: Date.parse(b.startsAt), end: Date.parse(b.endsAt) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
  const overlaps = (start: number, end: number): boolean =>
    busyMs.some((b) => b.start < end && start < b.end);
  const alternatives: string[] = [];
  const deadline = now.getTime() + ALT_SEARCH_DAYS * 86_400_000;
  // Start 30 minutes after the request, rounded up to the next 30-minute boundary
  // (epoch-aligned, so boundaries are :00 / :30 UTC).
  let cursor = requested + SLOT_STEP_MS;
  const remainder = cursor % SLOT_STEP_MS;
  if (remainder !== 0) cursor += SLOT_STEP_MS - remainder;
  while (cursor <= deadline && alternatives.length < count) {
    const start = cursor;
    const end = start + durationMinutes * 60_000;
    const startDate = new Date(start);
    const endDate = new Date(end);
    const hour = startDate.getUTCHours();
    const endHour = endDate.getUTCHours();
    const withinDay =
      hour >= WORKDAY_START_HOUR_UTC &&
      (endHour < WORKDAY_END_HOUR_UTC ||
        (endHour === WORKDAY_END_HOUR_UTC && endDate.getUTCMinutes() === 0));
    if (withinDay && start > now.getTime() && !overlaps(start, end)) {
      alternatives.push(new Date(start).toISOString());
    }
    cursor = cursor + SLOT_STEP_MS;
    // Skip to next morning when the workday is over.
    if (new Date(cursor).getUTCHours() >= WORKDAY_END_HOUR_UTC) {
      const next = new Date(cursor);
      next.setUTCDate(next.getUTCDate() + 1);
      next.setUTCHours(WORKDAY_START_HOUR_UTC, 0, 0, 0);
      cursor = next.getTime();
    }
  }
  return alternatives;
}
