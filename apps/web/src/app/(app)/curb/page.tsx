import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { CurbWorkspace } from '../../../features/curb/CurbWorkspace';

export const metadata: Metadata = { title: BRAND.products.curb };

export default function Page() {
  return <CurbWorkspace />;
}
