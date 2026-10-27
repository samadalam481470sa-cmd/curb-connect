import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { navigation } from './navigation';

// next/navigation needs the App Router runtime; tests get a controllable stand-in.
vi.mock('next/navigation', async () => {
  const { navigation: nav } = await import('./navigation');
  return {
    useRouter: () => nav,
    usePathname: () => nav.pathname,
    useSearchParams: () => nav.search,
    redirect: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  navigation.pathname = '/';
  navigation.search = new URLSearchParams();
  navigation.push.mockReset();
  navigation.replace.mockReset();
});
