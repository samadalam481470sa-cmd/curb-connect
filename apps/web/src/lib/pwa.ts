// Messages understood by public/sw.js. The worker only ever caches the app shell and static
// assets (never /v1 responses), but on sign-out or access loss the shell cache is dropped too so
// nothing from the previous session is served from this device (PLT-011 S).
export type ServiceWorkerMessage = { type: 'SKIP_WAITING' } | { type: 'CLEAR_CACHES' };

export function postToServiceWorker(message: ServiceWorkerMessage): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.controller?.postMessage(message);
}

/** Drop the worker's caches and any Cache Storage entries this origin created. */
export async function clearShellCaches(): Promise<void> {
  postToServiceWorker({ type: 'CLEAR_CACHES' });
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('fieldline-')).map((k) => caches.delete(k)));
  } catch {
    // Cache Storage unavailable (private mode): nothing cached to clear.
  }
}
