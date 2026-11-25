// Roof inspection booking (web): response schemas and status labels.
// Pure logic only (no React, no network) so it can be unit-tested.
// Schemas mirror the API module (apps/api/src/modules/inspections/) for client validation.
import { z } from 'zod';

export const INSPECTION_STATUSES = ['booked', 'confirmed', 'completed', 'cancelled'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function inspectionStatusLabel(status: InspectionStatus): string {
  return INSPECTION_STATUS_LABELS[status];
}

export const INSPECTION_DURATIONS = [30, 60, 90, 120] as const;

export const InspectionSchema = z.object({
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
export type InspectionBooking = z.infer<typeof InspectionSchema>;

export const InspectionBookingResponseSchema = z.object({
  booking: InspectionSchema,
  bookingChannel: z.string(),
  note: z.string(),
});
export type InspectionBookingResponse = z.infer<typeof InspectionBookingResponseSchema>;

export const InspectionListSchema = z.object({
  items: z.array(InspectionSchema),
  bookingChannel: z.string(),
  note: z.string(),
});

export const InspectionStatusResponseSchema = z.object({
  booking: InspectionSchema,
  statusLabel: z.string(),
  nextStatuses: z.array(z.enum(INSPECTION_STATUSES)),
  bookingChannel: z.string(),
  note: z.string(),
});

/** Combine a date input (YYYY-MM-DD) and a time input (HH:MM, local time) into an
 *  ISO timestamp. The date/time are read as the user's local time. */
export function combineDateTime(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const parsed = Date.parse(`${date}T${time}:00`);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

/** Split an ISO timestamp into the local date / time values a form needs. */
export function splitDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '', time: '' };
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}
