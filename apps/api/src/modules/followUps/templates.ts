// Follow-up message templates: short, honest, no fake urgency or scarcity.
// No invented deadlines, no "only one slot left", no price claims — the templates
// only restate what is true (a quote was sent, the company is available to talk)
// and invite a reply. Names, addresses and quote details are filled in by the
// person sending, never invented by the template.
import type { FollowUpStage } from './queue';

export interface FollowUpTemplate {
  id: string;
  /** Which stage this template is suggested for. */
  stage: FollowUpStage;
  label: string;
  /** Short plain-text body. Fill in the quote/job details by hand before sending. */
  body: string;
}

export const FOLLOW_UP_TEMPLATES: readonly FollowUpTemplate[] = [
  {
    id: 'quoted_follow_up',
    stage: 'quoted',
    label: 'Quoted — check in',
    body: 'Hi — just checking in on the roof quote we sent. Happy to walk through the options, adjust the scope, or answer any questions. Reply whenever you are ready; take your time.',
  },
  {
    id: 'interested_follow_up',
    stage: 'interested',
    label: 'Interested — next step',
    body: 'Hi — following up on your roof project. If it helps, we can confirm a time for an inspection or walk through the quote together. Let us know what works for you.',
  },
  {
    id: 'lost_reopen',
    stage: 'lost',
    label: 'Lost — reopen the conversation',
    body: 'Hi — we spoke a while ago about your roof and the timing was not right then. If the project is back on your list, we are happy to take another look or update the quote. No pressure either way.',
  },
  {
    id: 'no_answer_check_in',
    stage: 'quoted',
    label: 'No answer — leave a note',
    body: 'Hi — we tried to reach you about the roof quote we sent and did not get through. No need to call back unless you would like to talk it over; you can reply here whenever is convenient.',
  },
];

export function templateById(id: string): FollowUpTemplate | null {
  return FOLLOW_UP_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function templatesForStage(stage: FollowUpStage): FollowUpTemplate[] {
  return FOLLOW_UP_TEMPLATES.filter((t) => t.stage === stage);
}
