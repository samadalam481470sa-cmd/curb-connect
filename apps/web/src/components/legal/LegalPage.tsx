import { BRAND } from '@fieldline/contracts';
import type { ReactNode } from 'react';

export const LEGAL_UPDATED = 'November 14, 2026';
export const LEGAL_CONTACT = 'samad.alam481470SA@gmail.com';

/** Shared shell for the public, signed-out legal pages (privacy, terms). */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card" style={{ maxWidth: 760, textAlign: 'left' }}>
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>{title}</h1>
        <p className="web-muted web-small">Last updated: {LEGAL_UPDATED}</p>
        {children}
        <p className="web-muted web-small">
          <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> ·{' '}
          <a href="/sign-in">Sign in</a>
        </p>
      </div>
    </main>
  );
}

/** Line for auth screens linking the legal pages. */
export function LegalLinks() {
  return (
    <p className="web-muted web-small">
      By continuing you agree to the <a href="/terms">Terms of Use</a> and acknowledge the{' '}
      <a href="/privacy">Privacy Policy</a>.
    </p>
  );
}
