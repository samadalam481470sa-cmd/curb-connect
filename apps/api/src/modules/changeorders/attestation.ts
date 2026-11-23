// Change-order signature attestation (Phase E, item 25). No e-sign provider is connected in
// this repo, so signing is an internal typed-name attestation recorded in signature_events
// with a document hash, exactly like the existing internal signature pattern: the signer
// types their full name, we check it matches the named signer, and the event log is the
// evidence. Nothing here claims a third-party signature service was used.
import { createHash } from 'node:crypto';

export interface ChangeOrderDocument {
  number: string;
  title: string;
  reason: string;
  amountDeltaMinor: number;
  currency: string;
  scheduleImpactDays: number;
  lines: unknown;
}

/** Stable hash of the change-order terms being signed. */
export function changeOrderDocumentHash(doc: ChangeOrderDocument): string {
  const canonical = JSON.stringify({
    number: doc.number,
    title: doc.title,
    reason: doc.reason,
    amountDeltaMinor: doc.amountDeltaMinor,
    currency: doc.currency,
    scheduleImpactDays: doc.scheduleImpactDays,
    lines: doc.lines,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Typed signature must match the named signer (case/space-insensitive) and be non-trivial. */
export function typedSignatureMatches(signerName: string, typedSignature: string): boolean {
  const signer = normalizeName(signerName);
  const typed = normalizeName(typedSignature);
  return signer.length >= 2 && typed.length >= 2 && signer === typed;
}

export const CHANGE_ORDER_NEXT = {
  draft: ['pending_internal_approval', 'withdrawn'],
  pending_internal_approval: ['sent_to_customer', 'withdrawn'],
  sent_to_customer: ['accepted', 'rejected', 'withdrawn'],
  accepted: [],
  rejected: [],
  withdrawn: [],
} as const;

export type ChangeOrderFlowStatus = keyof typeof CHANGE_ORDER_NEXT;

export function canTransitionChangeOrder(current: string, next: string): boolean {
  const allowed = (CHANGE_ORDER_NEXT as Record<string, readonly string[]>)[current] ?? [];
  return allowed.includes(next);
}
