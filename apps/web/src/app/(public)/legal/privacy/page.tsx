import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Field Pro stores, why, where it is held, how long it is kept and your rights.',
};

export default function PrivacyPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.privacy!} />;
}
