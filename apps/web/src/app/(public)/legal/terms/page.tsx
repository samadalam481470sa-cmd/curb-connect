import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Terms of service',
  description:
    'The agreement for using Field Pro and the limits of its measurements and estimates.',
};

export default function TermsPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.terms!} />;
}
