// Client-side Gantt presentation helpers (Phase E, item 21). The API computes bar offsets;
// these helpers only format and guard what the server sent.

export interface GanttBarLike {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string;
  progressPercent: number;
  leftPercent: number;
  widthPercent: number;
  dependencyConflict: boolean;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function barStyle(bar: GanttBarLike): { left: string; width: string } {
  const left = clampPercent(bar.leftPercent);
  const width = Math.max(1, Math.min(100 - left, clampPercent(bar.widthPercent)));
  return { left: `${left}%`, width: `${width}%` };
}

export function progressLabel(bar: GanttBarLike): string {
  const p = Math.round(clampPercent(bar.progressPercent));
  return `${bar.title}: ${bar.startsOn} to ${bar.endsOn}, ${p}% complete` +
    (bar.dependencyConflict ? ' (starts before its predecessor finishes)' : '');
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', open: 'Open', answered: 'Answered', closed: 'Closed',
  required: 'Required', submitted: 'Submitted', under_review: 'Under review',
  approved: 'Approved', approved_as_noted: 'Approved as noted',
  revise_and_resubmit: 'Revise and resubmit', rejected: 'Rejected',
  not_started: 'Not started', in_progress: 'In progress', complete: 'Complete', on_hold: 'On hold',
  ready_for_review: 'Ready for review', verified: 'Verified',
  pending_internal_approval: 'Pending internal approval', sent_to_customer: 'Sent to customer',
  accepted: 'Accepted', withdrawn: 'Withdrawn',
  tentative: 'Tentative', confirmed: 'Confirmed', cancelled: 'Cancelled', completed: 'Completed',
  in_service: 'In service', maintenance: 'Maintenance', out_of_service: 'Out of service', retired: 'Retired',
  signed: 'Signed',
};

export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
