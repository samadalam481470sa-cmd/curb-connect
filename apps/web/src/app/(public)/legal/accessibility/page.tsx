import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Accessibility statement',
  description:
    'Field Pro’s WCAG 2.2 AA target, what has been tested, known limitations and how to report a barrier.',
};

export default function AccessibilityPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.accessibility!} />;
}
