import type { Metadata } from 'next';
import { AssistantView } from '../../../features/assistant/AssistantView';

export const metadata: Metadata = { title: 'Ask Field Pro' };

export default function Page() {
  return <AssistantView />;
}
