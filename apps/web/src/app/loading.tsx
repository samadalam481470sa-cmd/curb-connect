/** Server-rendered loading state while Next.js streams the application. */
export default function Loading() {
  return (
    <main id="fl-main" role="status" aria-live="polite" style={{
      minHeight: '100dvh', display: 'grid', placeItems: 'center',
      padding: 24, color: '#e6f1ff'
    }}>
      <section style={{
        maxWidth: 440, width: '100%', textAlign: 'center', padding: 28,
        background: 'rgba(12,22,36,.9)', border: '1px solid rgba(94,214,255,.28)',
        borderRadius: 16
      }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 28 }}>Curb Connect</h1>
        <p>Opening your construction workspace…</p>
        <p style={{ color: '#a6c2d8', fontSize: 14, lineHeight: 1.6 }}>
          This can take longer on the first visit while the hosting services start.
        </p>
        <a href="/sign-in" style={{ color: '#67e8f9' }}>Go to sign-in</a>
      </section>
    </main>
  );
}
