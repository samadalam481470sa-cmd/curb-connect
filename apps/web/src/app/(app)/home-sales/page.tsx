import type { Metadata } from 'next';
import { HomeSalesView } from '../../../features/builderOps/HomeSalesView';

export const metadata: Metadata = { title: 'Home Sales' };

export default function Page() {
  return <HomeSalesView />;
}
