'use client';

import { useCallback, useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fieldline.theme.v1';
const listeners = new Set<() => void>();

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
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

function getSnapshot(): Theme {
  return readStored();
}

function getServerSnapshot(): Theme {
  return 'system';
}

/** Toggles light/dark using @fieldline/ui `data-theme` tokens. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Keep DOM attribute in sync with the store value.
  applyTheme(theme);

  const cycle = useCallback(() => {
    const order: Theme[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length]!;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    applyTheme(next);
    for (const listener of listeners) listener();
  }, [theme]);

  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <button
      type="button"
      className="web-map-tool web-theme-toggle"
      onClick={cycle}
      aria-label={`Color theme: ${label}. Click to change.`}
      title="Toggle light / dark theme"
    >
      {label}
    </button>
  );
}
