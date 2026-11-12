import type { Metadata } from 'next';
import { ConnectorSettings } from '../../../../features/settings/ConnectorSettings';
export const metadata: Metadata = { title: 'Bidding integrations' };
export default function Page(){return <ConnectorSettings/>;}
