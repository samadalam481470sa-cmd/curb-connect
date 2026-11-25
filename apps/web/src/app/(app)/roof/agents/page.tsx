import type { Metadata } from 'next';
import { AgentsDashboard } from '../../../../features/roof/agents/AgentsDashboard';

export const metadata: Metadata = { title: 'AI Agents for Roofing' };

export default function Page() {
  return <AgentsDashboard />;
}
