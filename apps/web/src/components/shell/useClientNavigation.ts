'use client';

import { useRouter } from 'next/navigation';
import { useCallback, type MouseEvent } from 'react';

/**
 * @fieldline/ui renders plain <a href> links (it does not depend on Next.js). This click handler,
 * attached once to the shell, turns ordinary same-origin link clicks into client-side navigations
 * so the shell, draft state and the offline outbox survive moving between areas. Modified clicks,
 * new-tab links, downloads, hash links and /v1 API links keep the browser's default behaviour.
 */
export function useClientNavigation() {
  const router = useRouter();
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a');
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
      const raw = anchor.getAttribute('href');
      if (!raw || raw.startsWith('#') || anchor.getAttribute('aria-disabled') === 'true') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/v1/')) return;
      event.preventDefault();
      router.push(`${url.pathname}${url.search}${url.hash}`);
    },
    [router],
  );
}
