import type { ReactNode } from 'react';
import '../../../components/curb/curb.css';

// Curb Cutting section (CV-041..CV-050, CP-051..CP-060): its own navigation and PRISM styles.
export default function CurbLayout({ children }: { children: ReactNode }) {
  return <div className="curb-section">{children}</div>;
}
