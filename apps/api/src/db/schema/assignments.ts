// Tables owned by the `assignments` module: work assigned from one Field Pro company to a
// connected contracting company (job, purchase order, task, bid invitation). Each company owns
// its mirrored row, written by the `network.assignment` platform operation after the
// connection is verified — the same pattern as network bills. Cross-company ids are plain
// uuid columns. The email state is honest: 'not_connected' means no mailer/SMTP is set up and
// nothing was emailed; 'sent' is only set after a real provider send succeeds.
import { text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const workAssignments = tenantTable(
  'work_assignments',
  {
    assignmentKey: uuid('assignment_key').notNull(),
    side: text('side').$type<'assigner' | 'assignee'>().notNull(),
    partnerOrgId: uuid('partner_org_id').notNull(),
    partnerDisplayName: text('partner_display_name').notNull(),
    kind: text('kind').$type<'job' | 'purchase_order' | 'task' | 'bid_invitation'>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    status: text('status')
      .$type<'sent' | 'accepted' | 'declined' | 'in_progress' | 'completed' | 'cancelled'>()
      .notNull()
      .default('sent'),
    dueOn: text('due_on'),
    emailState: text('email_state')
      .$type<'not_connected' | 'queued' | 'sent' | 'failed'>()
      .notNull()
      .default('not_connected'),
    emailSentAt: tsColumn('email_sent_at'),
    emailNote: text('email_note'),
    respondedAt: tsColumn('responded_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'assignmentKey'), h.idx('orgId', 'status'), h.idx('partnerOrgId', 'status')],
);
