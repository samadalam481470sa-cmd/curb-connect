import { BRAND } from '@fieldline/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AskPanel } from '../../../features/assistant/AskPanel';
import { RoofDamageCheck } from '../../../features/roof/RoofDamageCheck';
import { RoofWorkspace } from '../../../features/roof/RoofWorkspace';

export const metadata: Metadata = { title: BRAND.products.roof };

export default function Page() {
  return (
    <>
      <div style={{ padding: '16px 16px 0' }}>
        <RoofDamageCheck />
        <p style={{ margin: '12px 0 0' }}>
          <Link href="/roof/agents">AI Agents for Roofing</Link> — hailstorm map,
          Storm Response, claims, follow-ups, inspection booking, and answers from
          your business data.
        </p>
        <p style={{ margin: '12px 0 0' }}>
          <Link href="/roof/inspection">Photo inspection report</Link> — mark findings on photos
          and print a pass/fail report.
        </p>
      </div>
      <RoofWorkspace />
      <AskPanel
        mode="estimate_review"
        tool="roof"
        context="Roof workspace: roof measurements, damage check and roof estimates."
        title="Ask Field Pro — estimate review"
        placeholder="e.g. What lines do people miss on a tear-off estimate?"
      />
    </>
  );
}
