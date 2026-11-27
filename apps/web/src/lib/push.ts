// Web Push client helpers: subscribe this browser through the service worker's
// PushManager and register the subscription with the API (/v1/devices). Everything
// degrades honestly — no service worker, no PushManager (e.g. iOS Safari tab), or a
// denied permission each report their own state instead of pretending.
import type { ApiClient } from './api';

export type PushSupport =
  | 'ready'
  | 'no_service_worker'
  | 'no_push_manager'
  | 'permission_denied'
  | 'not_configured';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replaceAll('-', '+').replaceAll('_', '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function keyToBase64(key: ArrayBuffer | null): string {
  if (!key) return '';
  const bytes = new Uint8Array(key);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function pushSupport(vapidPublicKey: string | null): PushSupport {
  if (!vapidPublicKey) return 'not_configured';
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'no_service_worker';
  if (typeof window === 'undefined' || !('PushManager' in window)) return 'no_push_manager';
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return 'permission_denied';
  }
  return 'ready';
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/** Subscribe this browser and register the device with the API. Returns the endpoint. */
export async function subscribePush(api: ApiClient, vapidPublicKey: string): Promise<string> {
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications permission was not granted.');
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  await api.post('/v1/devices', {
    platform: 'web',
    endpoint: subscription.endpoint,
    p256dh: keyToBase64(subscription.getKey('p256dh')),
    auth: keyToBase64(subscription.getKey('auth')),
    userAgent: navigator.userAgent,
  });
  return subscription.endpoint;
}

/** Unsubscribe this browser and revoke the device on the API. */
export async function unsubscribePush(api: ApiClient, deviceId: string): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) await subscription.unsubscribe();
  await api.delete(`/v1/devices/${deviceId}`);
}
