import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { CurbHome } from '../../../components/curb/CurbHome';

export const metadata: Metadata = { title: BRAND.products.curb };

export default function Page() {
  return <CurbHome />;
}
