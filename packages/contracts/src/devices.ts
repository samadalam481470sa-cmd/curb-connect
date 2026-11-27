// Device registration contracts (push notifications). A "device" is one place a member
// can receive push: a Web Push subscription from the PWA (endpoint + p256dh/auth keys),
// or a native iOS/Android token recorded by the app shells (endpoint = token). Web Push
// delivery works when the server has VAPID keys configured; native delivery is gated on
// the owner's Apple Developer / Firebase accounts and reports an honest not-connected
// state until then.
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common';

export const DEVICE_PLATFORMS = ['web', 'ios', 'android'] as const;
export const DevicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;

export const DeviceSchema = z.object({
  id: UuidSchema,
  platform: DevicePlatformSchema,
  /** Web Push endpoint URL, or the native device token. Never shown in full in the UI. */
  endpoint: z.string(),
  userAgent: z.string().nullable(),
  lastSeenAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceListSchema = z.object({ items: z.array(DeviceSchema) });

export const RegisterDeviceRequestSchema = z.object({
  platform: DevicePlatformSchema,
  endpoint: z.string().trim().min(1).max(2000),
  /** Web Push encryption keys (required for platform 'web'). */
  p256dh: z.string().trim().max(500).nullable().optional(),
  auth: z.string().trim().max(500).nullable().optional(),
  userAgent: z.string().trim().max(500).nullable().optional(),
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequestSchema>;

/** Whether push can actually be delivered right now, per platform. */
export const PushStatusSchema = z.object({
  web: z.object({
    connected: z.boolean(),
    /** The VAPID public key the browser subscribes with; null when not configured. */
    vapidPublicKey: z.string().nullable(),
    deviceCount: z.number().int(),
  }),
  ios: z.object({
    connected: z.boolean(),
    /** Plain-language reason when not connected (owner account step). */
    reason: z.string().nullable(),
    deviceCount: z.number().int(),
  }),
  android: z.object({
    connected: z.boolean(),
    reason: z.string().nullable(),
    deviceCount: z.number().int(),
  }),
});
export type PushStatus = z.infer<typeof PushStatusSchema>;
