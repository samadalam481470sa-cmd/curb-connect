import type { ReactNode } from 'react';
import { SiteFooter } from '../../components/site/SiteFooter';

/** Footer on every public page (sign-in, recovery, invitation, onboarding, policies). */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
