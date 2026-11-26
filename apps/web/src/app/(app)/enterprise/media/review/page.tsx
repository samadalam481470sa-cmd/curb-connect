import type { Metadata } from 'next';
import { EnterpriseMediaReviewQueue } from '../../../../../features/enterprise/EnterpriseMediaReviewQueue';

export const metadata: Metadata = { title: 'Media review — Enterprise Suite' };
export default function Page() {
  return <EnterpriseMediaReviewQueue />;
}
