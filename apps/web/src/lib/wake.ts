'use client';

// Waking a sleeping API (Render free plan).
//
// The web app and the API sleep separately. While the API sleeps, the web server's /v1 proxy gets
// a Cloudflare "Just a moment..." 429 page from the host instead of waking it, so every API call
// fails ("Too many requests" on sign-in). A real browser visiting the API's own address gets the
// host's "waking up" page, which starts the API. So the browser is sent to the API's
// /v1/health/wake route as a full-page visit; once the API is up, that route sends the browser
// straight back to the page it came from.
import { useEffect } from 'react';
import { isApiWaking } from './api';

const WAKE_ORIGIN = (process.env.NEXT_PUBLIC_API_WAKE_ORIGIN ?? '').replace(/\/$/, '');
const LAST_WAKE_KEY = 'fl.apiWakeAt';
/** One automatic wake per tab in this window, so a wake that does not help cannot loop. */
export const AUTO_WAKE_COOLDOWN_MS = 3 * 60_000;

/** The wake-up hop for `returnTo`, or null where the API never sleeps (development). */
export function apiWakeUrl(returnTo: string, origin: string = WAKE_ORIGIN): string | null {
  if (!origin) return null;
  return `${origin}/v1/health/wake?to=${encodeURIComponent(returnTo)}`;
}

function readLastWake(): number {
  try {
    return Number(window.sessionStorage.getItem(LAST_WAKE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeLastWake(at: number): void {
  try {
    window.sessionStorage.setItem(LAST_WAKE_KEY, String(at));
  } catch {
    // Storage blocked: the wake still works, only the loop guard is lost.
  }
}

/**
 * - start: wake now.
 * - leaving: this page already started a wake and the browser is on its way out.
 * - cooldown: a wake ran a short time ago and did not help; show the error instead of looping.
 */
export type AutoWakeState = 'start' | 'leaving' | 'cooldown';

export function autoWakeState(lastWakeAt: number, pageLoadedAt: number): AutoWakeState {
  if (lastWakeAt <= 0) return 'start';
  if (lastWakeAt >= pageLoadedAt) return 'leaving';
  // The wake-up hop reloads this page, so a recent wake shows up just before the page load.
  if (pageLoadedAt - lastWakeAt < AUTO_WAKE_COOLDOWN_MS) return 'cooldown';
  return 'start';
}

/** Sends this tab through the wake-up hop and back to the current page. */
export function wakeApi(): boolean {
  const url = apiWakeUrl(window.location.href);
  if (!url) return false;
  writeLastWake(Date.now());
  window.location.assign(url);
  return true;
}

/** Opens the wake-up hop in a new tab, so nothing typed on this page is lost. */
export function wakeApiInNewTab(): boolean {
  const url = apiWakeUrl(window.location.href);
  if (!url) return false;
  window.open(url, '_blank', 'noopener');
  return true;
}

/**
 * For pages where nothing has been typed yet (sign-in, the first app load): when `error` says the
 * API is asleep, wake it automatically. Returns true while the browser is being sent to wake it,
 * so the page can say "starting" instead of showing an error.
 */
export function useAutoWakeApi(error: unknown): boolean {
  const state =
    isApiWaking(error) && apiWakeUrl('/') !== null
      ? autoWakeState(readLastWake(), performance.timeOrigin)
      : null;
  useEffect(() => {
    if (state === 'start') wakeApi();
  }, [state]);
  return state === 'start' || state === 'leaving';
}
