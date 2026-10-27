import { vi } from 'vitest';

/** Controllable stand-in for the App Router (see setup.ts). */
export const navigation = {
  pathname: '/',
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};
