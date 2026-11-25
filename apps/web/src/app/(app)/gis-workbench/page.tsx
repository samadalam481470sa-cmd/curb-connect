import type { Metadata } from 'next';
import { GisWorkbenchView } from '../../../features/gisWorkbench/GisWorkbenchView';

export const metadata: Metadata = { title: 'GIS Workbench' };

export default function Page() {
  return <GisWorkbenchView />;
}
