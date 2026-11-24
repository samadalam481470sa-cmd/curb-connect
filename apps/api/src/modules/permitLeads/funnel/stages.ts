// Funnel stages: New → Contacted → Quoted / Interested → Won / Lost.
//
// Stages live on the funnel lead (keyed by source + permit number, per company), not on the
// CRM lead record: the CRM lead machine (new/contacted/qualified/converted/disqualified/
// merged) does not have quoted/interested/won/lost, and widening that shared enum would
// change every CRM flow. A funnel lead that turns into real work can still be converted into
// a CRM lead by the company later; the funnel only tracks the call pipeline.
export const FUNNEL_STAGES = [
  'new',
  'contacted',
  'quoted',
  'interested',
  'won',
  'lost',
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_STAGE_LABEL: Record<FunnelStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  interested: 'Interested',
  won: 'Won',
  lost: 'Lost',
};

/** Legal moves. Won and lost are terminal; lost can be reopened to new (owner called back). */
export const FUNNEL_STAGE_TRANSITIONS: Record<FunnelStage, FunnelStage[]> = {
  new: ['contacted', 'lost'],
  contacted: ['quoted', 'interested', 'lost'],
  quoted: ['interested', 'won', 'lost'],
  interested: ['quoted', 'won', 'lost'],
  won: [],
  lost: ['new'],
};

export function canMoveStage(from: FunnelStage, to: FunnelStage): boolean {
  return from === to || FUNNEL_STAGE_TRANSITIONS[from].includes(to);
}

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_STAGES as readonly string[]).includes(v);
}

/** A call note is a short record of what the owner said — free text, capped like other notes. */
export function validCallNote(note: unknown): string | null {
  if (typeof note !== 'string') return null;
  const trimmed = note.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) return null;
  return trimmed;
}

export type CallOutcome = 'answered' | 'voicemail' | 'no_answer' | 'wrong_number' | 'not_interested';

export const CALL_OUTCOMES: CallOutcome[] = [
  'answered',
  'voicemail',
  'no_answer',
  'wrong_number',
  'not_interested',
];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  answered: 'Answered',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

export function isCallOutcome(v: unknown): v is CallOutcome {
  return typeof v === 'string' && (CALL_OUTCOMES as readonly string[]).includes(v);
}
