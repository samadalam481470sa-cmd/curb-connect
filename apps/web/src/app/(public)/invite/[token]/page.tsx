import type { Metadata } from 'next';
import { InviteView } from '../../../../features/auth/InviteView';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteView token={token} />;
}
