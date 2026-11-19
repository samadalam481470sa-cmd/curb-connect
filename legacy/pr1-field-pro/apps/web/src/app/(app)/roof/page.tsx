import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { RoofWorkspace } from '../../../features/roof/RoofWorkspace';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return <RoofWorkspace />;
}
