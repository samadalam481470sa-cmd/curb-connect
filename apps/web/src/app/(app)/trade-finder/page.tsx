import type { Metadata } from 'next';
import { TradeFinderView } from '../../../features/tradeFinder/TradeFinderView';

export const metadata: Metadata = { title: 'Trade Finder' };

export default function Page() {
  return <TradeFinderView />;
}
