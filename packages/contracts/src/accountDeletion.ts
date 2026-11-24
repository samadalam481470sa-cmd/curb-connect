// Delete your own account (POST /v1/auth/account/delete). The confirmation word is typed in
// the Settings dialog, so an accidental click cannot delete anything. Pure module: no I/O.
import { z } from 'zod';

export const DeleteAccountRequestSchema = z.object({
  /** The user must type DELETE in the confirmation dialog. */
  confirm: z.literal('DELETE', { message: 'Type DELETE to confirm.' }),
});
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;

export const DeletedOrgSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});
export type DeletedOrg = z.infer<typeof DeletedOrgSchema>;

/**
 * What the deletion did. Workspaces the user solely owned are closed, not hard-deleted:
 * their append-only records (audit events, settings history, ledger entries, locked versions)
 * are immutable by database design and are retained as the company's book of record, but the
 * closed workspace has no members, so nobody can open it. `retainedTables` names the tables
 * that still hold rows for a closed workspace. Deleting the account never cancels a Stripe
 * subscription: `hadActiveSubscription` tells the caller to show the cancel-by-email warning.
 */
export const DeleteAccountResponseSchema = z.object({
  deleted: z.literal(true),
  organizationsClosed: z.array(DeletedOrgSchema),
  membershipsRemoved: z.array(DeletedOrgSchema),
  retainedTables: z.array(z.string()),
  enterpriseRecordsRetained: z.boolean(),
  hadActiveSubscription: z.boolean(),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponseSchema>;
