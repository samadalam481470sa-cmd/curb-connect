import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Cookie notice',
  description: 'The cookies Field Pro sets, what each one does and how to remove them.',
};

export default function CookiesPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.cookies!} />;
}
