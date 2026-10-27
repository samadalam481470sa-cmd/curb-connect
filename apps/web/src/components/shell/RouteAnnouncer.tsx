'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * WCAG 2.4.3 / 4.1.3 for client-side navigation: after a route change, focus moves to the new
 * page's heading (or the main region) and the page name is announced in a polite live region.
 * The first render is skipped so the browser's normal load focus is kept.
 */
export function RouteAnnouncer({ mainId = 'fl-main' }: { mainId?: string }) {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (previous.current === null) {
      previous.current = pathname;
      return;
    }
    if (previous.current === pathname) return;
    previous.current = pathname;
    // Wait a frame so the new page has rendered its heading.
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById(mainId);
      const heading =
        main?.querySelector<HTMLElement>('[data-route-heading]') ?? main?.querySelector('h1');
      const target = heading ?? main;
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: false });
      }
      setMessage(`${heading?.textContent ?? document.title} page`);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, mainId]);

  return (
    <div className="fl-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}
