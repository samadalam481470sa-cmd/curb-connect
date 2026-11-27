import type { Metadata } from 'next';
import { TemplatesView } from '../../../features/templates/TemplatesView';

export const metadata: Metadata = { title: 'Estimate Templates' };

export default function Page() {
  return <TemplatesView />;
}
