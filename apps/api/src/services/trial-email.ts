// One free trial per email address. The key is the address as a mailbox provider delivers it, so the
// same mailbox written two ways (case, "+tag", Gmail dots) cannot start a second trial.
// Abuse control, not identity: a determined person can still use a different address, which is why
// the trial is one week and the grant is recorded in trial_claims (migration 0021).

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function trialEmailKey(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  local = local.split('+')[0] ?? local;
  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com';
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}
