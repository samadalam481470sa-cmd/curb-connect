// Notification service (PLT-020 R): event-driven, deduplicated (unique org + dedupe_key per
// channel), preference-aware, with every delivery state recorded on the row. In-app rows are
// delivered immediately; email goes through the outbox job `notification.deliver`, so a mail
// failure never rolls back the business transition that caused it (PLT-020 S).
import {
  type NotificationCategory,
  type NotificationChannel,
  type SubjectType,
} from '@fieldline/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { notificationPreferences, notifications } from '../db/schema';
import type { Tx } from '../db/runtime';
import { enqueue } from '../jobs/outbox';

export interface NotifyInput {
  orgId: string;
  recipientMembershipId: string;
  category: NotificationCategory;
  title: string;
  body?: string | null;
  /** In-app path (e.g. /curb/projects/<id>); never a signed media URL. */
  link?: string | null;
  subjectType?: SubjectType | null;
  subjectId?: string | null;
  /** Same key + channel within an org is delivered once (PLT-020 R). */
  dedupeKey: string;
  channels?: NotificationChannel[];
  correlationId?: string | null;
}

/** Defaults when a member has no preference row: in-app and email on, SMS off (needs consent). */
export const DEFAULT_CHANNEL_ENABLED: Record<NotificationChannel, boolean> = {
  in_app: true,
  email: true,
  sms: false,
};

export interface NotifyResult {
  created: { channel: NotificationChannel; id: string; status: string }[];
  deduplicated: NotificationChannel[];
}

export async function notify(tx: Tx, input: NotifyInput): Promise<NotifyResult> {
  const channels = input.channels ?? ['in_app', 'email'];
  const prefs = await tx
    .select({ channel: notificationPreferences.channel, enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.membershipId, input.recipientMembershipId),
        eq(notificationPreferences.category, input.category),
        inArray(notificationPreferences.channel, channels),
      ),
    );
  const enabled = new Map(prefs.map((p) => [p.channel, p.enabled]));
  const result: NotifyResult = { created: [], deduplicated: [] };
  const now = new Date();

  for (const channel of channels) {
    const on = enabled.get(channel) ?? DEFAULT_CHANNEL_ENABLED[channel];
    // SMS has no adapter yet: it is recorded as suppressed rather than pretending to send.
    const status = !on || channel === 'sms' ? 'suppressed' : channel === 'in_app' ? 'delivered' : 'queued';
    const [row] = await tx
      .insert(notifications)
      .values({
        orgId: input.orgId,
        recipientMembershipId: input.recipientMembershipId,
        channel,
        category: input.category,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        subjectType: input.subjectType ?? null,
        subjectId: input.subjectId ?? null,
        deliveryStatus: status,
        sentAt: status === 'delivered' ? now : null,
        dedupeKey: `${input.dedupeKey}:${channel}`,
        data: on ? null : { suppressedBy: 'preference' },
      })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (!row) {
      result.deduplicated.push(channel);
      continue;
    }
    result.created.push({ channel, id: row.id, status });
    if (status === 'queued') {
      await enqueue(tx, {
        orgId: input.orgId,
        task: 'notification.deliver',
        aggregateType: 'notification',
        aggregateId: row.id,
        payload: { notificationId: row.id },
        correlationId: input.correlationId ?? null,
        jobKey: `notification:${row.id}`,
      });
    }
  }
  return result;
}
