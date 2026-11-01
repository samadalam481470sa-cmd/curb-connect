import type { Metadata } from 'next';
import { PriceBooksView } from '../../../../features/settings/PriceBooksView';

export const metadata: Metadata = { title: 'Price books' };

export default function Page() {
  return <PriceBooksView />;
}
