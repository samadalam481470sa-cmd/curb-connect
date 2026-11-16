'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Curb Connect rendering failure', error);
  }, [error]);

  return (
    <main id="fl-main" role="alert" style={{
      minHeight: '100dvh', display: 'grid', placeItems: 'center',
      padding: 24, color: '#e6f1ff'
    }}>
      <section style={{
        width: '100%', maxWidth: 460, padding: 28, borderRadius: 16,
        background: 'rgba(12,22,36,.96)', border: '1px solid rgba(94,214,255,.3)'
      }}>
        <h1>Curb Connect couldn't open</h1>
        <p>Your page encountered an error. Retry or open sign-in to restart your session.</p>
        <button type="button" onClick={reset} style={{
          background: '#22d3ee', color: '#031018', border: 0,
          borderRadius: 8, padding: '12px 18px', fontWeight: 700, cursor: 'pointer'
        }}>Try again</button>
        {' '}
        <a href="/sign-in" style={{ color: '#67e8f9' }}>Open sign-in</a>
      </section>
    </main>
  );
}
