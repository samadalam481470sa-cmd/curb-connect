'use client';

// Native shell device bridge: when Field Pro runs inside the iOS shell
// (native/ios), the shell injects the APNs device token as
// `window.__fieldProNativeToken` and fires a `fieldpro-native-token` event.
// This component registers that token with the API (POST /v1/devices,
// platform "ios") so the member's devices list is complete.
//
// In a normal browser there is no token and this component does nothing.
// Server-side APNs delivery stays honestly `native_push_not_connected` until
// the owner's Apple Developer account + APNs key are wired — registering the
// token does not change that, and the devices screen says so.
import { useEffect } from 'react';
import { useApi } from '../../lib/session';

declare global {
  interface Window {
    __fieldProNativeToken?: string;
    webkit?: {
      messageHandlers?: {
        fieldProPush?: { postMessage: (message: unknown) => void };
      };
    };
  }
}

const registeredTokens = new Set<string>();

export function NativeDeviceBridge() {
  const { api } = useApi();

  useEffect(() => {
    let cancelled = false;

    const register = (token: unknown) => {
      if (typeof token !== 'string' || token.trim() === '') return;
      if (registeredTokens.has(token)) return;
      registeredTokens.add(token);
      void api
        .post('/v1/devices', {
          platform: 'ios',
          endpoint: token,
          userAgent: navigator.userAgent,
        })
        .catch(() => {
          // Best-effort: allow a retry on the next event if registration failed.
          registeredTokens.delete(token);
        });
    };

    const onToken = (event: Event) => {
      if (cancelled) return;
      register((event as CustomEvent<unknown>).detail);
    };

    register(window.__fieldProNativeToken);
    window.addEventListener('fieldpro-native-token', onToken);
    // If the shell injected the token before this app loaded, ask it to re-send.
    try {
      window.webkit?.messageHandlers?.fieldProPush?.postMessage({ action: 'token' });
    } catch {
      // Not running in the native shell — nothing to ask.
    }

    return () => {
      cancelled = true;
      window.removeEventListener('fieldpro-native-token', onToken);
    };
  }, [api]);

  return null;
}
