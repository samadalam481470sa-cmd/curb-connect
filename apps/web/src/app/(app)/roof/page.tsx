import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import { RoofDamageCheck } from '../../../features/roof/RoofDamageCheck';
import { RoofWorkspace } from '../../../features/roof/RoofWorkspace';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return (
    <>
      <div style={{ padding: '16px 16px 0' }}>
        <RoofDamageCheck />
      </div>
      <RoofWorkspace />
    </>
  );
}
