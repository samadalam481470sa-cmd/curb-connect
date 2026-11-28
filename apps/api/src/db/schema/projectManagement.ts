// Tables owned by the `projectManagement` module (Phase E, items 20-24, 26-27): job-linked
// Procore-style project controls for regular Field Pro jobs. The enterprise_suite schema stays
// the separate opt-in commercial tool on its own projects; these tables hang off `jobs` so every
// job can carry RFIs, submittals, a task schedule, daily logs, drawings, punch lists,
// checklists and fleet records. Crew scheduling reuses crews/crew_members/schedules in jobs.ts.
// Statuses are text with server-side transition maps (enterprise precedent), checked in SQL too.
import { sql } from 'drizzle-orm';
import { boolean, date, integer, jsonb, numeric, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { crews, jobs } from './jobs';
import { memberships } from './team';

const refs = (name: string) =>
  jsonb(name)
    .notNull()
    .default(sql`'[]'::jsonb`);

export const pmRfis = tenantTable(
  'pm_rfis',
  {
    jobId: uuid('job_id').notNull(),
    number: integer('number').notNull(),
    subject: text('subject').notNull(),
    question: text('question').notNull(),
    status: text('status').notNull().default('draft'),
    /** Who must answer next (free text: architect, owner, GC...). Never auto-filled. */
    assignedTo: text('assigned_to'),
    dueOn: date('due_on'),
    officialResponse: text('official_response'),
    respondedAt: tsColumn('responded_at'),
    costImpact: boolean('cost_impact').notNull().default(false),
    scheduleImpactDays: integer('schedule_impact_days').notNull().default(0),
    /** [{label, reference}] document references entered by the user (existing upload flow keys). */
    attachmentRefs: refs('attachment_refs'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.uniq('orgId', 'jobId', 'number'), h.fk('jobId', () => jobs), h.idx('orgId', 'jobId', 'status')],
);

export const pmSubmittals = tenantTable(
  'pm_submittals',
  {
    jobId: uuid('job_id').notNull(),
    number: text('number').notNull(),
    title: text('title').notNull(),
    specSection: text('spec_section').notNull().default(''),
    status: text('status').notNull().default('required'),
    reviewer: text('reviewer'),
    dueOn: date('due_on'),
    documentReference: text('document_reference'),
    currentRevision: integer('current_revision').notNull().default(1),
    attachmentRefs: refs('attachment_refs'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'jobId', 'status')],
);

export const scheduleTasks = tenantTable(
  'schedule_tasks',
  {
    jobId: uuid('job_id').notNull(),
    title: text('title').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    progressPercent: integer('progress_percent').notNull().default(0),
    status: text('status').notNull().default('not_started'),
    /** Finish-to-start predecessor task on the same job (nullable). */
    predecessorTaskId: uuid('predecessor_task_id'),
    crewId: uuid('crew_id'),
    /** Cost code this task's spend rolls up under (builder-entered; null = unassigned). */
    costCode: text('cost_code'),
    /** Connected contracting company this trade scope is assigned to (cross-company id,
     * plain uuid — verified as an active connection when the assignment is made). The
     * display name is a snapshot from assignment time. */
    assigneeOrgId: uuid('assignee_org_id'),
    assigneeDisplayName: text('assignee_display_name'),
    sortOrder: integer('sort_order').notNull().default(0),
    notes: text('notes'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('crewId', () => crews),
    h.idx('orgId', 'jobId', 'startsOn'),
    h.idx('orgId', 'assigneeOrgId'),
  ],
);

export const dailyLogs = tenantTable(
  'daily_logs',
  {
    jobId: uuid('job_id').notNull(),
    logDate: date('log_date').notNull(),
    crewId: uuid('crew_id'),
    /** Headcount actually on site, entered by the user. Null = not recorded. */
    crewCount: integer('crew_count'),
    workDone: text('work_done').notNull(),
    /** Manual weather note only. No weather feed is connected; nothing is auto-filled. */
    weatherNotes: text('weather_notes'),
    delays: text('delays'),
    notes: text('notes'),
    /** [{label, reference}] photo references from the existing media/upload flow. */
    photoRefs: refs('photo_refs'),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.fk('jobId', () => jobs), h.fk('crewId', () => crews), h.idx('orgId', 'jobId', 'logDate')],
);

export const drawings = tenantTable(
  'drawings',
  {
    jobId: uuid('job_id').notNull(),
    title: text('title').notNull(),
    discipline: text('discipline'),
    sheetNumber: text('sheet_number'),
    currentVersionId: uuid('current_version_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.fk('jobId', () => jobs), h.idx('orgId', 'jobId')],
);

export const drawingVersions = tenantTable(
  'drawing_versions',
  {
    drawingId: uuid('drawing_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    /** Object-storage key or document reference from the existing upload flow. */
    fileReference: text('file_reference').notNull(),
    fileName: text('file_name'),
    notes: text('notes'),
    uploadedByUserId: uuid('uploaded_by_user_id'),
  },
  (t, h) => [
    h.uniq('orgId', 'drawingId', 'versionNumber'),
    h.fk('drawingId', () => drawings, 'cascade'),
    h.idx('orgId', 'drawingId'),
  ],
);

export const drawingMarkups = tenantTable(
  'drawing_markups',
  {
    versionId: uuid('version_id').notNull(),
    /** Pin position as percent of the rendered sheet (0-100), placed by the user. */
    xPercent: numeric('x_percent', { precision: 6, scale: 3, mode: 'number' }).notNull(),
    yPercent: numeric('y_percent', { precision: 6, scale: 3, mode: 'number' }).notNull(),
    note: text('note').notNull(),
    authorName: text('author_name'),
    createdByUserId: uuid('created_by_user_id'),
  },
  (t, h) => [h.fk('versionId', () => drawingVersions, 'cascade'), h.idx('orgId', 'versionId')],
);

export const punchItems = tenantTable(
  'punch_items',
  {
    jobId: uuid('job_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    status: text('status').notNull().default('open'),
    assigneeMembershipId: uuid('assignee_membership_id'),
    assigneeName: text('assignee_name'),
    dueOn: date('due_on'),
    photoRefs: refs('photo_refs'),
    verifiedByUserId: uuid('verified_by_user_id'),
    verifiedAt: tsColumn('verified_at'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('assigneeMembershipId', () => memberships),
    h.idx('orgId', 'jobId', 'status'),
  ],
);

export const checklistTemplates = tenantTable(
  'checklist_templates',
  {
    name: text('name').notNull(),
    kind: text('kind').notNull().default('quality'),
    /** [{label, required}] starter items the company edits. No compliance claim is made. */
    items: refs('items'),
    active: boolean('active').notNull().default(true),
    revision: revisionColumn(),
  },
  (t, h) => [h.idx('orgId', 'kind')],
);

export const checklistRuns = tenantTable(
  'checklist_runs',
  {
    jobId: uuid('job_id').notNull(),
    templateId: uuid('template_id'),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('quality'),
    status: text('status').notNull().default('in_progress'),
    /** [{label, required, done, note}] snapshot of the template at run start. */
    answers: refs('answers'),
    runDate: date('run_date'),
    /** Typed-name sign-off (internal attestation only, like signature_events). */
    signedByName: text('signed_by_name'),
    signedAt: tsColumn('signed_at'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.fk('jobId', () => jobs),
    h.fk('templateId', () => checklistTemplates),
    h.idx('orgId', 'jobId', 'status'),
  ],
);

export const fleetAssets = tenantTable(
  'fleet_assets',
  {
    name: text('name').notNull(),
    kind: text('kind').notNull().default('vehicle'),
    /** Plate, VIN or serial as entered by the user. */
    identifier: text('identifier'),
    status: text('status').notNull().default('in_service'),
    assignedJobId: uuid('assigned_job_id'),
    maintenanceDueOn: date('maintenance_due_on'),
    maintenanceNotes: text('maintenance_notes'),
    notes: text('notes'),
    revision: revisionColumn(),
  },
  (t, h) => [h.fk('assignedJobId', () => jobs), h.idx('orgId', 'status')],
);

/** Manual location check-ins only. No telematics/GPS feed exists in this repo; nothing here
 *  is a live position. The latest row is simply the last place a person said the asset was. */
export const fleetCheckIns = tenantTable(
  'fleet_check_ins',
  {
    assetId: uuid('asset_id').notNull(),
    locationText: text('location_text').notNull(),
    jobId: uuid('job_id'),
    odometer: integer('odometer'),
    notes: text('notes'),
    checkedInByUserId: uuid('checked_in_by_user_id'),
    checkedInAt: tsColumn('checked_in_at').notNull().defaultNow(),
  },
  (t, h) => [
    h.fk('assetId', () => fleetAssets, 'cascade'),
    h.fk('jobId', () => jobs),
    h.idx('orgId', 'assetId', 'checkedInAt'),
  ],
);
