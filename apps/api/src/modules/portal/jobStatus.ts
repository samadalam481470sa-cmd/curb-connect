// Job-status links shared with a contractor's customer (homeowner portal, scope 'job'). The token
// is 32 random bytes shown once; only its SHA-256 is the lookup key. The URL carries the token in
// the fragment (#t=...), so it never reaches server logs, proxies or Referer headers.
import { createHash, randomBytes } from 'node:crypto';

export const JOB_STAGES = [
  'intake',
  'estimating',
  'scheduled',
  'in_progress',
  'completed',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

/** Wording the customer sees for each internal stage. */
export const CUSTOMER_STAGE_LABELS: Record<JobStage, string> = {
  intake: 'Request received',
  estimating: 'Estimating',
  scheduled: 'Scheduled',
  in_progress: 'Work in progress',
  completed: 'Completed',
};

export const JOB_STATUS_LINK_DEFAULT_DAYS = 90;
export const JOB_STATUS_LINK_MAX_DAYS = 365;

export function newJobStatusToken(): string {
  return randomBytes(32).toString('base64url');
}

export function jobStatusTokenHash(token: string): string {
  return createHash('sha256').update(`job-status:${token}`).digest('hex');
}

export function jobStatusUrl(appOrigin: string, token: string): string {
  return `${appOrigin.replace(/\/$/, '')}/track#t=${token}`;
}

export function customerStageLabel(stage: string): string {
  return (CUSTOMER_STAGE_LABELS as Record<string, string>)[stage] ?? 'In progress';
}

export function isJobStage(value: string): value is JobStage {
  return (JOB_STAGES as readonly string[]).includes(value);
}
