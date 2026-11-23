import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AskPanel } from '../../../features/assistant/AskPanel';
import { SearchView } from '../../../features/search/SearchView';

export const metadata: Metadata = { title: 'Search' };

export default function Page() {
  return (
    <>
      <Suspense>
        <SearchView />
      </Suspense>
      <AskPanel
        mode="search_help"
        tool="search"
        context="Search screen: finding customers, jobs, estimates, invoices and projects in Field Pro."
        title="Ask Field Pro — find it"
        placeholder="e.g. Where do I find a customer's invoices?"
      />
    </>
  );
}
