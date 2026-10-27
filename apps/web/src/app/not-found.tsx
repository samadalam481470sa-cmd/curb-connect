import { BRAND } from '@fieldline/contracts';

export default function NotFound() {
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Page not found</h1>
        <p>The link may be mistyped, or the page may have moved.</p>
        <a className="fl-btn fl-btn--primary fl-btn--md" href="/">
          <span className="fl-btn__label">Go to Home</span>
        </a>
      </div>
    </main>
  );
}
