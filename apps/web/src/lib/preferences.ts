'use client';

// Per-device display preferences (PLT-019 A): imperial/metric display and locale. They change how
// values are shown, never the stored SI values or money minor units. Organization defaults come
// from the org profile; a personal choice here overrides them on this device only.
import type { MeasurementSystem } from '@fieldline/contracts';
import { useCallback, useSyncExternalStore } from 'react';

export interface DisplayPreferences {
  /** null = follow the organization default. */
  measurementSystem: MeasurementSystem | null;
  /** null = follow the organization / browser locale. */
  locale: string | null;
}

const STORAGE_KEY = 'fieldline.display-preferences.v1';
const DEFAULTS: DisplayPreferences = { measurementSystem: null, locale: null };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedValue: DisplayPreferences = DEFAULTS;
/** Used when localStorage is unavailable (private mode, blocked storage). */
let memoryOverride: DisplayPreferences | null = null;

function read(): DisplayPreferences {
  if (memoryOverride) return memoryOverride;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<DisplayPreferences>) : {};
    cachedValue = {
      measurementSystem:
        parsed.measurementSystem === 'imperial' || parsed.measurementSystem === 'metric'
          ? parsed.measurementSystem
          : null,
      locale: typeof parsed.locale === 'string' && parsed.locale ? parsed.locale : null,
    };
  } catch {
    cachedValue = DEFAULTS;
  }
  return cachedValue;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useDisplayPreferences(): [
  DisplayPreferences,
  (next: Partial<DisplayPreferences>) => void,
] {
  const value = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  const update = useCallback((next: Partial<DisplayPreferences>) => {
    const merged = { ...read(), ...next };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage disabled: the preference lasts for this page only.
      memoryOverride = merged;
    }
    for (const listener of listeners) listener();
  }, []);
  return [value, update];
}

export function resolveDisplay(
  prefs: DisplayPreferences,
  org: { measurementSystem?: MeasurementSystem; locale?: string } | undefined,
): { measurementSystem: MeasurementSystem; locale: string } {
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return {
    measurementSystem: prefs.measurementSystem ?? org?.measurementSystem ?? 'imperial',
    locale: prefs.locale ?? org?.locale ?? browserLocale ?? 'en-US',
  };
}

// ------------------------------------------------------------------ navigation tree state

/**
 * Which navigation-tree sections this user has collapsed on this device. Stored as the set of
 * collapsed ids so sections added later default to expanded. `null` means the user has never
 * toggled anything: callers pick their own initial state (desktop: all open; phone menu: only
 * the current section open).
 */
const NAV_STORAGE_KEY = 'fieldline.nav-collapsed.v1';
const navListeners = new Set<() => void>();
let navCachedRaw: string | null | undefined;
let navCachedValue: string[] | null = null;
let navMemoryOverride: string[] | null | undefined;

function readNavCollapsed(): string[] | null {
  if (navMemoryOverride !== undefined) return navMemoryOverride;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(NAV_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === navCachedRaw) return navCachedValue;
  navCachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    navCachedValue = Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === 'string')
      : null;
  } catch {
    navCachedValue = null;
  }
  return navCachedValue;
}

function subscribeNav(listener: () => void): () => void {
  navListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === NAV_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    navListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useNavCollapsed(): [string[] | null, (next: string[]) => void] {
  const value = useSyncExternalStore(subscribeNav, readNavCollapsed, () => null);
  const update = useCallback((next: string[]) => {
    try {
      window.localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(next));
      navMemoryOverride = undefined;
    } catch {
      navMemoryOverride = next;
    }
    for (const listener of navListeners) listener();
  }, []);
  return [value, update];
}
