'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { SearchIcon } from '../icons';

/**
 * Universal search entry (PLT-016 A): address, customer, report id, invoice or job. Submitting
 * opens /search, which queries the tenant-scoped search API. The box itself never caches results.
 */
export function SearchBox({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    router.push(`/search?q=${encodeURIComponent(term)}`);
  };
  return (
    <form
      role="search"
      className={compact ? 'web-search web-search--compact' : 'web-search'}
      onSubmit={submit}
    >
      <label htmlFor={id} className="fl-visually-hidden">
        Search addresses, customers, reports, invoices and jobs
      </label>
      <span className="web-search__icon" aria-hidden="true">
        <SearchIcon size={18} />
      </span>
      <input
        id={id}
        type="search"
        name="q"
        className="web-search__input"
        placeholder="Search records"
        autoComplete="off"
        minLength={2}
        maxLength={200}
        value={q}
        onChange={(event) => setQ(event.target.value)}
      />
    </form>
  );
}
