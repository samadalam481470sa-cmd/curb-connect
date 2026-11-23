import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RoofDamageCheck } from '../../../features/roof/RoofDamageCheck';
import { RoofWorkspace } from '../../../features/roof/RoofWorkspace';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return (
    <>
      <div style={{ padding: '16px 16px 0' }}>
        <RoofDamageCheck />
        <p style={{ margin: '12px 0 0' }}>
          <Link href="/roof/inspection">Photo inspection report</Link> — mark findings on photos
          and print a pass/fail report.
        </p>
      </div>
      <RoofWorkspace />
    </>
  );
}
