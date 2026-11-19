import { describe, expect, it } from 'vitest';
import { AUTO_WAKE_COOLDOWN_MS, apiWakeUrl, autoWakeState } from './wake';

describe('API wake-up hop', () => {
  it('points the browser at the API wake route with the page to return to', () => {
    expect(apiWakeUrl('https://web.example/sign-in?returnTo=%2Fjobs', 'https://api.example')).toBe(
      'https://api.example/v1/health/wake?to=https%3A%2F%2Fweb.example%2Fsign-in%3FreturnTo%3D%252Fjobs',
    );
  });

  it('does nothing where the API never sleeps (no wake origin)', () => {
    expect(apiWakeUrl('/sign-in', '')).toBeNull();
  });

  it('wakes once, then holds off instead of looping', () => {
    const loaded = 1_000_000;
    // Never woken in this tab.
    expect(autoWakeState(0, loaded)).toBe('start');
    // This page already started a wake and is leaving.
    expect(autoWakeState(loaded + 400, loaded)).toBe('leaving');
    // Came back from a wake moments ago and the API still is not answering.
    expect(autoWakeState(loaded - 5_000, loaded)).toBe('cooldown');
    // A later sleep, long after the last wake.
    expect(autoWakeState(loaded - AUTO_WAKE_COOLDOWN_MS - 1, loaded)).toBe('start');
  });
});
