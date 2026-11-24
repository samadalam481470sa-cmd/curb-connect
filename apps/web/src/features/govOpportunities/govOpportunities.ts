// Gov Opportunities view helpers (pure): listing status labels and checked-at formatting.
// Dead links are only ever shown as dead because an actual HTTP check said so; the label
// "Could not check" is what the UI shows when the check itself failed.
export const LISTING_LABELS: Record<string, string> = {
  listed: 'Listed',
  not_listed: 'Not listed',
  requires_setup: 'Needs setup',
  manual_check: 'Check manually',
  unknown: 'Could not check',
};

export function listingLabel(status: string): string {
  return LISTING_LABELS[status] ?? status;
}

export function formatCheckedAt(value: string | null): string {
  if (!value) return 'Not checked yet';
  return `Checked ${new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
