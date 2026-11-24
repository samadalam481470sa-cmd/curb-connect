import { BRAND } from '@fieldline/contracts';
import type { LegalDoc } from '../../lib/legal-content';
import { LEGAL_REVIEW_NOTICE, LEGAL_UPDATED } from '../../lib/legal-content';

/**
 * One policy document. Server-rendered prose with a single h1 (the page title), section headings in
 * order, and the review notice shown as visible text rather than hidden in a comment.
 */
export function LegalArticle({ doc }: { doc: LegalDoc }) {
  return (
    <article className="web-legal">
      <header className="web-legal__header">
        <p className="web-muted web-small">{BRAND.name}</p>
        <h1>{doc.title}</h1>
        <p className="web-muted">{doc.summary}</p>
        <p className="web-small">
          <span className="web-muted">Last updated: </span>
          <time dateTime="2026-11-24">{LEGAL_UPDATED}</time>
        </p>
      </header>

      <p className="web-legal__notice" role="note">
        {LEGAL_REVIEW_NOTICE}
      </p>

      {doc.sections.map((section, index) => (
        <section key={section.heading} className="web-legal__section">
          <h2>{`${index + 1}. ${section.heading}`}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets && (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  );
}
