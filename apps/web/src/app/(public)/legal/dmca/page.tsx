import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Copyright and DMCA policy',
  description:
    'How to report copyright infringement in Field Pro and what a notice must include.',
};

export default function DmcaPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.dmca!} />;
}
