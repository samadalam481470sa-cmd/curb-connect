// `devices` module: push-notification device registration. A member registers the
// places they can receive push — a Web Push subscription from the PWA today, native
// iOS/Android tokens from the app shells (recorded the same way). Web Push delivery
// runs when VAPID keys are configured; native delivery stays gated on the owner's
// Apple Developer / Firebase accounts and the status endpoint says so plainly.
import {
  DeviceListSchema,
  DeviceSchema,
  PushStatusSchema,
  RegisterDeviceRequestSchema,
} from '@fieldline/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { devices } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { pushConfigured } from '../../services/webPush';

const READ = 'notification:read_own';
const WRITE = 'notification:update_preferences';

const IdParams = z.object({ id: z.uuid() });

type DeviceRow = typeof devices.$inferSelect;

function deviceDto(row: DeviceRow) {
  return {
    id: row.id,
    platform: row.platform,
    endpoint: row.endpoint,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const devicesModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/devices',
    {
      config: { permission: WRITE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['devices'],
        summary: 'Register (or refresh) a push device for the signed-in member',
        body: RegisterDeviceRequestSchema,
        response: { 200: DeviceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      if (request.body.platform === 'web' && (!request.body.p256dh || !request.body.auth)) {
        throw problem('validation_failed', 'Web Push registration needs the p256dh and auth keys.');
      }
      const now = new Date();
      const row = await tenantTx(request, async (tx) => {
        const [upserted] = await tx
          .insert(devices)
          .values({
            orgId: org.orgId,
            membershipId: org.membershipId,
            userId: org.userId,
            platform: request.body.platform,
            endpoint: request.body.endpoint,
            p256dh: request.body.p256dh ?? null,
            auth: request.body.auth ?? null,
            userAgent: request.body.userAgent ?? null,
            lastSeenAt: now,
          })
          .onConflictDoUpdate({
            target: [devices.orgId, devices.membershipId, devices.platform, devices.endpoint],
            set: {
              p256dh: request.body.p256dh ?? null,
              auth: request.body.auth ?? null,
              userAgent: request.body.userAgent ?? null,
              lastSeenAt: now,
              revokedAt: null,
              updatedAt: now,
            },
          })
          .returning();
        if (!upserted) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'device.registered',
          resourceType: 'device',
          resourceId: upserted.id,
          after: { platform: upserted.platform },
        });
        return upserted;
      });
      return deviceDto(row);
    },
  );

  app.get(
    '/devices',
    {
      config: { permission: READ },
      schema: {
        tags: ['devices'],
        summary: 'The signed-in member’s registered push devices',
        response: { 200: DeviceListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select()
          .from(devices)
          .where(and(eq(devices.orgId, org.orgId), eq(devices.membershipId, org.membershipId)))
          .orderBy(desc(devices.lastSeenAt))
          .limit(50),
      );
      return { items: rows.map(deviceDto) };
    },
  );

  app.delete(
    '/devices/:id',
    {
      config: { permission: WRITE },
      schema: {
        tags: ['devices'],
        summary: 'Revoke one of the signed-in member’s push devices',
        params: IdParams,
        response: { 200: DeviceSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const now = new Date();
      const row = await tenantTx(request, async (tx) => {
        const [updated] = await tx
          .update(devices)
          .set({ revokedAt: now, updatedAt: now })
          .where(
            and(
              eq(devices.orgId, org.orgId),
              eq(devices.membershipId, org.membershipId),
              eq(devices.id, request.params.id),
            ),
          )
          .returning();
        if (!updated) throw problem('not_found');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'device.revoked',
          resourceType: 'device',
          resourceId: updated.id,
        });
        return updated;
      });
      return deviceDto(row);
    },
  );

  app.get(
    '/devices/push-status',
    {
      config: { permission: READ },
      schema: {
        tags: ['devices'],
        summary: 'Whether push can actually be delivered, per platform',
        response: { 200: PushStatusSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const counts = await tenantTx(request, (tx) =>
        tx
          .select({ platform: devices.platform, n: sql<number>`count(*)::int` })
          .from(devices)
          .where(
            and(
              eq(devices.orgId, org.orgId),
              eq(devices.membershipId, org.membershipId),
              isNull(devices.revokedAt),
            ),
          )
          .groupBy(devices.platform),
      );
      const byPlatform = new Map(counts.map((c) => [c.platform, c.n]));
      const config = request.server.config;
      return {
        web: {
          connected: pushConfigured(config),
          vapidPublicKey: config.push.vapidPublicKey ?? null,
          deviceCount: byPlatform.get('web') ?? 0,
        },
        ios: {
          connected: false,
          reason: 'Needs the owner’s Apple Developer account (APNs) — not connected yet.',
          deviceCount: byPlatform.get('ios') ?? 0,
        },
        android: {
          connected: false,
          reason: 'Needs the owner’s Firebase project (FCM) — not connected yet.',
          deviceCount: byPlatform.get('android') ?? 0,
        },
      };
    },
  );
};

export default devicesModule;
