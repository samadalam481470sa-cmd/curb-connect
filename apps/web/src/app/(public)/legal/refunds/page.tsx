import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Refund policy',
  description:
    'When a Field Pro subscription or a one-time purchase is refunded, and how to ask.',
};

export default function RefundsPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.refunds!} />;
}
