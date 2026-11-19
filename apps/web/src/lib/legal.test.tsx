import { render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { LegalArticle } from '../components/legal/LegalArticle';
import { SiteFooter } from '../components/site/SiteFooter';
import { LEGAL_DOCS, LEGAL_REVIEW_NOTICE, type LegalDoc } from './legal-content';

/**
 * Policy pages are public, so they must be readable without a session and must not claim more than
 * the product does. The axe check is the automated part of the accessibility statement's evidence.
 */
async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    // jsdom has no layout engine, so rules that need geometry cannot be evaluated here.
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.help}`);
}

describe('legal documents', () => {
  it.each(LEGAL_DOCS.map((doc) => [doc.title, doc] as const))(
    '%s has one h1, ordered sections and an explicit review notice',
    (_title, doc: LegalDoc) => {
      const { container } = render(<LegalArticle doc={doc} />);
      const headings = screen.getAllByRole('heading');
      expect(headings.filter((h) => h.tagName === 'H1')).toHaveLength(1);
      expect(headings[0]?.textContent).toBe(doc.title);
      expect(screen.getByRole('heading', { level: 2, name: /1\. / })).toBeTruthy();
      expect(container.textContent).toContain(LEGAL_REVIEW_NOTICE);
      expect(screen.getByText('Last updated:')).toBeTruthy();
    },
  );

  it.each(LEGAL_DOCS.map((doc) => [doc.slug, doc] as const))(
    'the %s page has no detectable axe violations',
    async (_slug, doc: LegalDoc) => {
      const { container } = render(<LegalArticle doc={doc} />);
      expect(await violations(container)).toEqual([]);
    },
  );

  it('states the ADA/WCAG position and the honest limitations', () => {
    const accessibility = LEGAL_DOCS.find((doc) => doc.slug === 'accessibility')!;
    const text = render(<LegalArticle doc={accessibility} />).container.textContent ?? '';
    expect(text).toMatch(/WCAG\) 2\.2 Level AA/);
    expect(text).toMatch(/Americans with Disabilities Act/);
    expect(text).toContain('No independent third-party accessibility audit');
    expect(text).toContain('not tagged PDFs');
  });

  it('does not claim payments or processors that are not configured', () => {
    const terms = LEGAL_DOCS.find((doc) => doc.slug === 'terms')!;
    const privacy = LEGAL_DOCS.find((doc) => doc.slug === 'privacy')!;
    const termsText = render(<LegalArticle doc={terms} />).container.textContent ?? '';
    const privacyText = render(<LegalArticle doc={privacy} />).container.textContent ?? '';
    expect(termsText).toContain('No paid plan is active in this build');
    expect(privacyText).toContain('No third-party processors are configured in this build');
  });
});

describe('policy footer', () => {
  it('links every policy from an labelled navigation landmark', () => {
    render(<SiteFooter />);
    const nav = screen.getByRole('navigation', { name: 'Legal and policy' });
    for (const doc of LEGAL_DOCS) {
      expect(within(nav).getByRole('link', { name: doc.title }).getAttribute('href')).toBe(
        `/legal/${doc.slug}`,
      );
    }
    expect(within(nav).getByRole('link', { name: 'All policies' }).getAttribute('href')).toBe(
      '/legal',
    );
  });

  it('has no detectable axe violations', async () => {
    const { container } = render(<SiteFooter />);
    expect(await violations(container)).toEqual([]);
  });
});
