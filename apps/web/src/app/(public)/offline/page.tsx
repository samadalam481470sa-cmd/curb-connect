import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

/**
 * Static fallback the service worker serves when a navigation fails offline. It contains no
 * tenant data by construction (it is prerendered at build time, before anyone signs in).
 */
export default function OfflinePage() {
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>You are offline</h1>
        <p>
          This page needs a connection. Drafts and photos you queued are kept on this device and are
          sent automatically when you are back online.
        </p>
        <a className="fl-btn fl-btn--primary fl-btn--md" href="/">
          <span className="fl-btn__label">Try again</span>
        </a>
      </div>
    </main>
  );
}
