// Pure display helpers for manual customers and contacts (SupplyPro GM core).
export interface CustomerLike {
  displayName: string;
  companyName: string | null;
  kind: string;
}

export interface ContactLike {
  displayName: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

/** "Acme Builders LLC (Sam Acme)" for businesses, plain name for people. */
export function customerDisplayLabel(customer: CustomerLike): string {
  if (
    customer.kind === 'business' &&
    customer.companyName &&
    customer.companyName !== customer.displayName
  ) {
    return `${customer.companyName} (${customer.displayName})`;
  }
  return customer.displayName;
}

/** "Jane Homeowner — Owner · jane@example.com" — role and contact details when present. */
export function contactDisplayLabel(contact: ContactLike): string {
  const bits = [contact.displayName];
  if (contact.role) bits.push(contact.role);
  const reach = [contact.email, contact.phone].filter(Boolean).join(' · ');
  return reach ? `${bits.join(' — ')} · ${reach}` : bits.join(' — ');
}
