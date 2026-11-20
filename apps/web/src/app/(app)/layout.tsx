import type { ReactNode } from 'react';
import { AppFrame } from '../../components/shell/AppFrame';
import { AccountNotice } from '../../features/subscription/AccountNotice';

/** Every signed-in area renders inside the shell (session + active workspace required). */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <AppFrame>
      <AccountNotice />
      {children}
    </AppFrame>
  );
}
