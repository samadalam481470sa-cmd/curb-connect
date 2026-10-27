import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchView } from '../../../features/search/SearchView';

export const metadata: Metadata = { title: 'Search' };

export default function Page() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  );
}
