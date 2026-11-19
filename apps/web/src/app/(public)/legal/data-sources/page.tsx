import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Data sources and your rights',
  description: 'Where building and map data comes from, its licences, accuracy limits and your rights.',
};

export default function DataSourcesPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG['data-sources']!} />;
}
