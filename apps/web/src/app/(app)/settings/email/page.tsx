import type { Metadata } from 'next';
import { EmailSettings } from '../../../../features/settings/EmailSettings';
export const metadata: Metadata = { title: 'Email sending' };
export default function Page() {
  return <EmailSettings />;
}
