// `notifications` module (PLT-020): the caller's in-app inbox, per-category/channel preferences,
// and the operational queue of failed deliveries and dead-lettered outbox events, with a manual
// retry (BE-076 B "manual reconciliation"). Members only ever see their own notifications.
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NotificationListSchema,
  NotificationPreferenceSchema,
  PageQuerySchema,
  UpdateNotificationPreferencesRequestSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { domainEvents, notificationPreferences, notifications } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { enqueue } from '../../jobs/outbox';
import { DEFAULT_CHANNEL_ENABLED } from '../../services/notifications';

type NotificationRow = typeof notifications.$inferSelect;

function notificationDto(row: NotificationRow) {
  return {
    id: row.id,
    channel: row.channel,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

const DeliveryFailureSchema = z.object({
  kind: z.enum(['notification', 'outbox_event']),
  id: UuidSchema,
  title: z.string(),
  channel: z.string().nullable(),
  status: z.string(),
  lastError: z.string().nullable(),
  attempts: z.number().int().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});

const notificationsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/notifications',
    {
      config: { permission: 'notification:read_own' },
      schema: {
        tags: ['notifications'],
        summary: 'My in-app notifications, newest first',
        querystring: PageQuerySchema.extend({ unread: z.enum(['true', 'false']).optional() }),
        response: { 200: NotificationListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const q = request.query;
      const cursor = decodeCursor(q.cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.orgId, org.orgId),
              eq(notifications.recipientMembershipId, org.membershipId),
              eq(notifications.channel, 'in_app'),
              eq(notifications.deliveryStatus, 'delivered'),
              q.unread === 'true' ? isNull(notifications.readAt) : undefined,
              beforeCursor(notifications.createdAt, notifications.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(notifications.createdAt)), desc(notifications.id))
          .limit(q.limit + 1),
      );
      return pageResult(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }), notificationDto);
    },
  );

  app.post(
    '/notifications/:id/read',
    {
      config: { permission: 'notification:read_own' },
      schema: {
        tags: ['notifications'],
        summary: 'Mark one of my notifications read',
        params: z.object({ id: UuidSchema }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const updated = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select({ id: notifications.id, readAt: notifications.readAt })
          .from(notifications)
          .where(
            and(
              eq(notifications.orgId, org.orgId),
              eq(notifications.id, request.params.id),
              eq(notifications.recipientMembershipId, org.membershipId),
            ),
          );
        if (!row) return false;
        if (!row.readAt) await tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, row.id));
        return true;
      });
      if (!updated) throw problem('not_found');
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/notifications/read-all',
    {
      config: { permission: 'notification:read_own' },
      schema: { tags: ['notifications'], summary: 'Mark all my notifications read', response: { 204: z.null() } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      await tenantTx(request, (tx) =>
        tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(
            and(
              eq(notifications.orgId, org.orgId),
              eq(notifications.recipientMembershipId, org.membershipId),
              isNull(notifications.readAt),
            ),
          ),
      );
      return reply.status(204).send(null);
    },
  );

  const PreferencesResponse = z.object({ preferences: z.array(NotificationPreferenceSchema) });

  app.get(
    '/notifications/preferences',
    {
      config: { permission: 'notification:read_own' },
      schema: {
        tags: ['notifications'],
        summary: 'My effective preferences for every category and channel',
        response: { 200: PreferencesResponse },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx.select().from(notificationPreferences).where(eq(notificationPreferences.membershipId, org.membershipId)),
      );
      const stored = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
      return {
        preferences: NOTIFICATION_CATEGORIES.flatMap((category) =>
          NOTIFICATION_CHANNELS.map((channel) => ({
            category,
            channel,
            enabled: stored.get(`${category}:${channel}`) ?? DEFAULT_CHANNEL_ENABLED[channel],
          })),
        ),
      };
    },
  );

  app.put(
    '/notifications/preferences',
    {
      config: { permission: 'notification:update_preferences' },
      schema: {
        tags: ['notifications'],
        summary: 'Opt in or out per category and channel',
        body: UpdateNotificationPreferencesRequestSchema,
        response: { 200: PreferencesResponse },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      await tenantTx(request, async (tx) => {
        for (const p of request.body.preferences) {
          await tx
            .insert(notificationPreferences)
            .values({ orgId: org.orgId, membershipId: org.membershipId, category: p.category, channel: p.channel, enabled: p.enabled })
            .onConflictDoUpdate({
              target: [notificationPreferences.membershipId, notificationPreferences.category, notificationPreferences.channel],
              set: { enabled: p.enabled },
            });
        }
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'notifications.preferences_updated',
          resourceType: 'membership',
          resourceId: org.membershipId,
          after: { preferences: request.body.preferences },
        });
      });
      const rows = await tenantTx(request, (tx) =>
        tx.select().from(notificationPreferences).where(eq(notificationPreferences.membershipId, org.membershipId)),
      );
      const stored = new Map(rows.map((r) => [`${r.category}:${r.channel}`, r.enabled]));
      return {
        preferences: NOTIFICATION_CATEGORIES.flatMap((category) =>
          NOTIFICATION_CHANNELS.map((channel) => ({
            category,
            channel,
            enabled: stored.get(`${category}:${channel}`) ?? DEFAULT_CHANNEL_ENABLED[channel],
          })),
        ),
      };
    },
  );

  app.get(
    '/notifications/delivery-failures',
    {
      config: { permission: 'integration:manage' },
      schema: {
        tags: ['notifications'],
        summary: 'Operational queue: failed deliveries and dead-lettered background events (PLT-020 S)',
        response: { 200: z.object({ items: z.array(DeliveryFailureSchema) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { failed, dead } = await tenantTx(request, async (tx) => ({
        failed: await tx
          .select()
          .from(notifications)
          .where(and(eq(notifications.orgId, org.orgId), eq(notifications.deliveryStatus, 'failed')))
          .orderBy(desc(notifications.updatedAt))
          .limit(100),
        dead: await tx
          .select()
          .from(domainEvents)
          .where(and(eq(domainEvents.orgId, org.orgId), inArray(domainEvents.status, ['dead', 'failed'])))
          .orderBy(desc(domainEvents.updatedAt))
          .limit(100),
      }));
      return {
        items: [
          ...failed.map((n) => ({
            kind: 'notification' as const,
            id: n.id,
            title: n.title,
            channel: n.channel,
            status: n.deliveryStatus,
            lastError: (n.data as { lastError?: string } | null)?.lastError ?? null,
            attempts: null,
            occurredAt: n.updatedAt.toISOString(),
          })),
          ...dead.map((e) => ({
            kind: 'outbox_event' as const,
            id: e.id,
            title: e.eventType,
            channel: null,
            status: e.status,
            lastError: e.lastError,
            attempts: e.attempts,
            occurredAt: e.updatedAt.toISOString(),
          })),
        ],
      };
    },
  );

  app.post(
    '/notifications/delivery-failures/:id/retry',
    {
      config: { permission: 'integration:manage' },
      schema: {
        tags: ['notifications'],
        summary: 'Re-queue a failed notification delivery',
        params: z.object({ id: UuidSchema }),
        response: { 202: z.object({ id: UuidSchema, status: z.literal('queued') }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(notifications)
          .where(and(eq(notifications.orgId, org.orgId), eq(notifications.id, request.params.id)));
        if (!row) throw problem('not_found');
        if (row.deliveryStatus !== 'failed') throw problem('invalid_transition', 'Only failed deliveries can be retried.');
        await tx.update(notifications).set({ deliveryStatus: 'queued' }).where(eq(notifications.id, row.id));
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'notification.deliver',
          aggregateType: 'notification',
          aggregateId: row.id,
          payload: { notificationId: row.id, manualRetry: true },
          correlationId: request.id,
          jobKey: `notification:${row.id}:retry:${Date.now()}`,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'notifications.delivery_retried',
          resourceType: 'notification',
          resourceId: row.id,
        });
      });
      reply.status(202);
      return { id: request.params.id, status: 'queued' as const };
    },
  );
};

export default notificationsModule;
