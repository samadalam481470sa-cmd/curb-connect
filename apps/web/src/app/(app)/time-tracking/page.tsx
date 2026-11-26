import type { Metadata } from 'next';
import { TimeTrackingView } from '../../../features/builderOps/TimeTrackingView';

export const metadata: Metadata = { title: 'Time Tracking' };

export default function Page() {
  return <TimeTrackingView />;
}
