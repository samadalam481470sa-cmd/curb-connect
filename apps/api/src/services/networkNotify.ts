// Cross-company helpers for the builder operations section (supplier orders + work
// assignments). The connection check mirrors the invoice-delivery pattern: BOTH sides must
// hold an active connection row — the mutually accepted connection is the consent. In-app
// notifications for the partner company are written directly (delivered immediately, no
// email involved); email goes through the outbox only when a mail path is configured, and
// the assignment/order records say so honestly when it is not.
import type { NotificationCategory, SubjectType } from '@fieldline/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppConfig } from '../config';
import type { Tx } from '../db/runtime';
import { companyConnections, memberships, notifications, users } from '../db/schema';
import { problem } from '../http/problem';

/** Both sides of the relationship must be active. Throws 'conflict' otherwise. */
export async function verifyActiveConnection(
  tx: Tx,
  orgId: string,
  partnerOrgId: string,
): Promise<void> {
  const [mine] = await tx
    .select({ id: companyConnections.id })
    .from(companyConnections)
    .where(
      and(
        eq(companyConnections.orgId, orgId),
        eq(companyConnections.partnerOrgId, partnerOrgId),
        eq(companyConnections.status, 'active'),
      ),
    )
    .limit(1);
  const [theirs] = await tx
    .select({ id: companyConnections.id })
    .from(companyConnections)
    .where(
      and(
        eq(companyConnections.orgId, partnerOrgId),
        eq(companyConnections.partnerOrgId, orgId),
        eq(companyConnections.status, 'active'),
      ),
    )
    .limit(1);
  if (!mine || !theirs) {
    throw problem(
      'conflict',
      'This company is not connected to yours. Connect in the company network first — orders and assignments only flow between connected Field Pro companies.',
    );
  }
}

export interface PartnerNotifyInput {
  partnerOrgId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  link?: string | null;
  subjectType?: SubjectType | null;
  subjectId?: string | null;
  /** Same key within the partner org is delivered once per member. */
  dedupeKey: string;
}

/**
 * In-app notification rows for the partner company's active owner/admin members. Written
 * directly inside the caller's platform transaction (BYPASSRLS, scoped by partner org id);
 * delivered immediately — this works whether or not email is connected.
 */
export async function notifyPartnerAdmins(tx: Tx, input: PartnerNotifyInput): Promise<number> {
  const members = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, input.partnerOrgId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    );
  const now = new Date();
  let created = 0;
  for (const member of members) {
    const [row] = await tx
      .insert(notifications)
      .values({
        orgId: input.partnerOrgId,
        recipientMembershipId: member.id,
        channel: 'in_app',
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        deliveryStatus: 'delivered',
        sentAt: now,
        dedupeKey: `${input.dedupeKey}:${member.id}`,
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (row) created += 1;
  }
  return created;
}

/** Email addresses of the partner company's active owner/admin members (for the email task). */
export async function partnerAdminEmails(tx: Tx, partnerOrgId: string): Promise<string[]> {
  const rows = await tx
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, partnerOrgId),
        eq(memberships.status, 'active'),
        inArray(memberships.role, ['owner', 'admin']),
      ),
    );
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}

/**
 * Whether email can actually go out: the connected-mailbox mailer (MAILER_URL +
 * MAILER_SHARED_SECRET, the owner's Google/Microsoft app setup) or platform SMTP
 * (SMTP_URL + MAIL_FROM). When neither is set, sends must not be claimed.
 */
export function emailConfigured(config: AppConfig): boolean {
  return Boolean(config.mail.smtpUrl && config.mail.from) || config.mailer !== null;
}

export const EMAIL_NOT_CONNECTED_NOTE =
  'Email is not connected yet (the mailer/SMTP setup is outstanding), so nothing was emailed. The in-app notification was delivered; the email will go out when email is connected and this is re-sent.';
