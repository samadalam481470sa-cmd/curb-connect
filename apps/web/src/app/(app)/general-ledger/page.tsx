import type { Metadata } from 'next';
import { GeneralLedgerView } from '../../../features/generalLedger/GeneralLedgerView';

export const metadata: Metadata = { title: 'General Ledger' };

export default function Page() {
  return <GeneralLedgerView />;
}
