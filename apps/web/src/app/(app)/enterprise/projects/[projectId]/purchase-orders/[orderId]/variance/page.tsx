import { UuidSchema } from '@fieldline/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EnterprisePurchaseVariances } from '../../../../../../../../features/enterprise/EnterprisePurchaseVariances';

export const metadata: Metadata = { title: 'Purchase overrun — Enterprise Suite' };

export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string; orderId: string }>;
}) {
  const { projectId, orderId } = await params;
  if (!UuidSchema.safeParse(projectId).success || !UuidSchema.safeParse(orderId).success)
    notFound();
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <nav aria-label="Overrun breadcrumb">
          <Link className="enterprise-back" href="/enterprise/costing">
            ← Job Costing
          </Link>
        </nav>
        <h1>Purchase overrun</h1>
      </header>
      <div className="enterprise-panel">
        <EnterprisePurchaseVariances
          projectId={projectId.toLowerCase()}
          orderId={orderId.toLowerCase()}
          defaultOpen
        />
      </div>
    </main>
  );
}
