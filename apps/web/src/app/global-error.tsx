'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Curb Connect root rendering failure', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{
        margin: 0, background: '#050a12', color: '#e6f1ff',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <main role="alert" style={{
          minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24
        }}>
          <section style={{
            width: '100%', maxWidth: 460, padding: 28,
            boxSizing: 'border-box', borderRadius: 16, background: '#0d1726',
            border: '1px solid rgba(94,214,255,.3)'
          }}>
            <h1>Curb Connect couldn't open</h1>
            <p>The application had a loading error. Retry or open sign-in.</p>
            <button type="button" onClick={reset} style={{
              background: '#22d3ee', color: '#031018', border: 0,
              borderRadius: 8, padding: '12px 18px', fontWeight: 700
            }}>Try again</button>
            {' '}
            <a href="/sign-in" style={{ color: '#67e8f9' }}>Open sign-in</a>
          </section>
        </main>
      </body>
    </html>
  );
}
