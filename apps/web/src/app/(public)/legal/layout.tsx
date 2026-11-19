import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { BRAND } from '@fieldline/contracts';

export const metadata: Metadata = {
  title: 'Policies',
  description: `Privacy, terms, cookie and accessibility policies for ${BRAND.name}.`,
};

/**
 * Policy layout. These pages are reachable without a session, so they carry their own skip link and
 * main landmark instead of relying on the signed-in application shell. The footer comes from the
 * shared public layout.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a className="fl-skip-link" href="#fl-main">
        Skip to main content
      </a>
      <header className="web-legal__topbar">
        <a className="web-brand" href="/">
          {BRAND.name}
        </a>
      </header>
      <main id="fl-main" tabIndex={-1} className="web-legal__main">
        {children}
      </main>
    </>
  );
}
