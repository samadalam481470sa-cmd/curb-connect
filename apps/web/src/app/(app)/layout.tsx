import type { ReactNode } from 'react';
import { AppFrame } from '../../components/shell/AppFrame';

/** Every signed-in area renders inside the shell (session + active workspace required). */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <AppFrame>{children}</AppFrame>;
}
