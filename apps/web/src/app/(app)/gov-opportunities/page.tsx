import type { Metadata } from 'next';
import { GovOpportunitiesView } from '../../../features/govOpportunities/GovOpportunitiesView';

export const metadata: Metadata = { title: 'Gov Opportunities' };

export default function Page() {
  return <GovOpportunitiesView />;
}
