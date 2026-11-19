// Map-data policy: owner removal requests for building footprints and the decisions taken on them.
// Global (not per-tenant) because removal applies to the map for everyone. Only approved rows are
// enforced; a pending request never hides anything, and a rejected one is kept for the audit trail.
import { doublePrecision, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const footprintRemovals = pgTable('footprint_removals', {
  id: uuid('id').primaryKey().defaultRandom(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  /** Any footprint whose centroid falls within this many metres of the point is hidden. */
  radiusM: integer('radius_m').notNull().default(30),
  reason: text('reason').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by'),
});
