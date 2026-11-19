import type { Metadata } from 'next';
import { LEGAL_DOCS, LEGAL_UPDATED } from '../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Policies',
  description: 'Privacy policy, terms of service, cookie notice and accessibility statement.',
};

export default function PoliciesPage() {
  return (
    <article className="web-legal">
      <header className="web-legal__header">
        <h1>Policies</h1>
        <p className="web-muted">
          How Field Pro handles your company’s information, what the service promises about
          measurements, which cookies it sets and how accessible it is.
        </p>
        <p className="web-small">
          <span className="web-muted">Last updated: </span>
          <time dateTime="2026-11-19">{LEGAL_UPDATED}</time>
        </p>
      </header>
      <ul className="web-legal__index">
        {LEGAL_DOCS.map((doc) => (
          <li key={doc.slug}>
            <h2>
              <a href={`/legal/${doc.slug}`}>{doc.title}</a>
            </h2>
            <p>{doc.summary}</p>
          </li>
        ))}
      </ul>
    </article>
  );
}
