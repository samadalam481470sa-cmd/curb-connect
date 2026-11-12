import type { Metadata } from 'next';
import { LawnCareWorkspace } from '../../../features/lawn/LawnCareWorkspace';

export const metadata: Metadata = {
  title: 'Lawn Care | Field Pro',
  description: 'Grass cutting, property satellite measurement and lawn-care quotes',
};

export default function LawnPage() {
  return <LawnCareWorkspace />;
}
