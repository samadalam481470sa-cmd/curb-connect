import type { Metadata } from 'next';
import { AskPanel } from '../../../features/assistant/AskPanel';
import { BuildEstimatorView } from '../../../features/build/BuildEstimatorView';

export const metadata: Metadata = { title: 'House Builder' };

export default function Page() {
  return (
    <>
      <BuildEstimatorView />
      <AskPanel
        mode="home_build"
        tool="build"
        context="House Builder: planning and estimating a house build, including Land feasibility."
        title="Ask Field Pro — home build help"
        placeholder="e.g. What order do the trades go in after framing?"
      />
    </>
  );
}
