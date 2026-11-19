// Remembers, on this device, how the person sends invoices: whether "Send automatically when
// created" is on, and the email address last used for each customer company. Browser storage can
// be missing or full, so every read and write is best effort.

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const autoSendKey = (orgId: string) => `fieldpro:${orgId}:invoice-auto-send`;
const emailsKey = (orgId: string) => `fieldpro:${orgId}:invoice-recipient-emails`;

export function loadAutoSend(orgId: string, fallback: boolean, store = storage()): boolean {
  try {
    const value = store?.getItem(autoSendKey(orgId));
    return value === null || value === undefined ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

export function saveAutoSend(orgId: string, on: boolean, store = storage()): void {
  try {
    store?.setItem(autoSendKey(orgId), on ? '1' : '0');
  } catch {
    // Not remembered; the default applies next time.
  }
}

function readEmails(orgId: string, store: Store | null): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(emailsKey(orgId)) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

export function recipientEmailFor(orgId: string, partnerOrgId: string, store = storage()): string {
  const value = readEmails(orgId, store)[partnerOrgId];
  return typeof value === 'string' ? value : '';
}

export function rememberRecipientEmail(
  orgId: string,
  partnerOrgId: string,
  email: string,
  store = storage(),
): void {
  try {
    const all = readEmails(orgId, store);
    all[partnerOrgId] = email;
    // Keep the 200 most recent companies.
    const trimmed = Object.fromEntries(Object.entries(all).slice(-200));
    store?.setItem(emailsKey(orgId), JSON.stringify(trimmed));
  } catch {
    // Not remembered; the person types it next time.
  }
}
