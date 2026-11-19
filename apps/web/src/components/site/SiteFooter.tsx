import { BRAND } from '@fieldline/contracts';
import { LEGAL_DOCS } from '../../lib/legal-content';

const YEAR = 2026;

/**
 * Policy footer. Rendered on public pages and inside the signed-in shell, so the privacy policy,
 * terms, cookie notice and accessibility statement are always one link away.
 */
export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? 'web-footer web-footer--compact' : 'web-footer'}>
      <nav className="web-footer__nav" aria-label="Legal and policy">
        <ul className="web-footer__list">
          {LEGAL_DOCS.map((doc) => (
            <li key={doc.slug}>
              <a href={`/legal/${doc.slug}`}>{doc.title}</a>
            </li>
          ))}
          <li>
            <a href="/legal">All policies</a>
          </li>
        </ul>
      </nav>
      <p className="web-footer__note web-muted web-small">
        {`© ${YEAR} ${BRAND.name}. Measurements and estimates are calculation aids, not surveys or certifications.`}
      </p>
    </footer>
  );
}
