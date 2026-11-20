import type { Metadata } from 'next';
import { LegalArticle } from '../../../../components/legal/LegalArticle';
import { LEGAL_DOC_BY_SLUG } from '../../../../lib/legal-content';

export const metadata: Metadata = {
  title: 'Estimate disclaimer',
  description:
    'Measurements, quantities and prices in Field Pro are estimates, not professional advice, and must be verified on site.',
};

export default function DisclaimerPage() {
  return <LegalArticle doc={LEGAL_DOC_BY_SLUG.disclaimer!} />;
}
