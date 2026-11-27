import type { Metadata } from 'next';
import { PortalCaptureView } from '../../../features/portalCapture/PortalCaptureView';

export const metadata: Metadata = { title: 'Portal Capture' };

export default function Page() {
  return <PortalCaptureView />;
}
