// Agent activity log: validation and hours-saved aggregation.
// Pure logic (no database, no network) so it can be unit-tested without Postgres.
//
// Hours saved are COMPUTED here from minutes_saved, never stored as a headline number.
// Only rows where minutes_saved was actually recorded count toward hours; an agent with
// no measured rows reports measured: false and hoursSaved: null, shown in the UI as
// "not measured yet" — never 0 presented as measured.
import { z } from 'zod';

export const AGENT_NAMES = [
  'storms',
  'estimator',
  'claims',
  'scheduler',
  'follow-ups',
  'front_desk',
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export const AgentNameSchema = z.enum(AGENT_NAMES);

export const AGENT_LABELS: Record<AgentName, string> = {
  storms: 'Storms',
  estimator: 'Estimator',
  claims: 'Claims',
  scheduler: 'Scheduler',
  'follow-ups': 'Follow-ups',
  front_desk: 'Front desk',
};

export function agentLabel(agent: AgentName): string {
  return AGENT_LABELS[agent];
}

export const RELATED_TYPES = ['roof_order', 'roof_claim', 'lead'] as const;

export const LogAgentActivitySchema = z.object({
  agent: AgentNameSchema,
  action: z.string().trim().min(1).max(200),
  /** Minutes actually measured for this action. Omit (null) when not measured. */
  minutesSaved: z
    .number()
    .int()
    .min(0)
    .max(60 * 24)
    .nullable()
    .optional(),
  relatedType: z.enum(RELATED_TYPES).optional(),
  relatedId: z.uuid().optional(),
});

export const AgentActivitySchema = z.object({
  id: z.uuid(),
  agent: AgentNameSchema,
  action: z.string(),
  minutesSaved: z.number().int().nullable(),
  relatedType: z.enum(RELATED_TYPES).nullable(),
  relatedId: z.string().nullable(),
  createdAt: z.string(),
});

export type AgentActivity = z.infer<typeof AgentActivitySchema>;

export const AgentHoursSchema = z.object({
  agent: AgentNameSchema,
  label: z.string(),
  /** Every logged action, whether or not its time was measured. */
  actions: z.number().int(),
  /** Actions whose time was actually measured. */
  measuredActions: z.number().int(),
  /** Total measured minutes, or null when nothing was measured for this agent. */
  minutesSaved: z.number().int().nullable(),
  /** Hours saved, computed from measured minutes only; null when not measured yet. */
  hoursSaved: z.number().nullable(),
  /** False when no action for this agent recorded a duration. */
  measured: z.boolean(),
});

export type AgentHours = z.infer<typeof AgentHoursSchema>;

export const AgentActivityTotalsSchema = z.object({
  agents: z.array(AgentHoursSchema),
  /** Hours saved across agents, from measured minutes only; null when nothing measured. */
  totalHoursSaved: z.number().nullable(),
  measured: z.boolean(),
  note: z.string(),
});

export type AgentActivityTotals = z.infer<typeof AgentActivityTotalsSchema>;

export interface ActivityRow {
  agent: string;
  minutesSaved: number | null;
}

const MINUTES_PER_HOUR = 60;

/** Round to one decimal place; hours are an estimate, labeled as such wherever shown. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / MINUTES_PER_HOUR) * 10) / 10;
}

/**
 * Per-agent totals for every known agent (agents with no rows still appear, unmeasured).
 * Unknown agent names in stored rows are ignored — they can only come from older data,
 * and inventing a label for them would misreport the totals.
 */
export function computeAgentHours(rows: ActivityRow[]): AgentActivityTotals {
  const agents: AgentHours[] = AGENT_NAMES.map((agent) => {
    const mine = rows.filter((r) => r.agent === agent);
    const measuredRows = mine.filter((r) => r.minutesSaved !== null);
    const minutes = measuredRows.reduce((sum, r) => sum + (r.minutesSaved ?? 0), 0);
    const measured = measuredRows.length > 0;
    return {
      agent,
      label: agentLabel(agent),
      actions: mine.length,
      measuredActions: measuredRows.length,
      minutesSaved: measured ? minutes : null,
      hoursSaved: measured ? minutesToHours(minutes) : null,
      measured,
    };
  });
  const totalMinutes = agents.reduce((sum, a) => sum + (a.minutesSaved ?? 0), 0);
  const anyMeasured = agents.some((a) => a.measured);
  return {
    agents,
    totalHoursSaved: anyMeasured ? minutesToHours(totalMinutes) : null,
    measured: anyMeasured,
    note: anyMeasured
      ? 'Estimate: hours saved are computed only from actions where a duration was actually recorded.'
      : 'Not measured yet: no agent action has recorded a duration.',
  };
}
