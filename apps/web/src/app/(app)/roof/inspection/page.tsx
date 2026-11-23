import type { Metadata } from 'next';
import { PhotoInspection } from '../../../../features/roof/inspection/PhotoInspection';

export const metadata: Metadata = { title: 'Photo inspection report' };

export default function Page() {
  return <PhotoInspection />;
}
