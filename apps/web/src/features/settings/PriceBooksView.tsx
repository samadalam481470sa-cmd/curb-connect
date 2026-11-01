'use client';

import { Button, EmptyState, EstimateLayerSection, Field, TextInput } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { isApiError } from '../../lib/api';
import {
  LocalPriceBookDraftSchema,
  type LocalPriceBookDraft,
} from '../../lib/endpoints';
import { orgKey, useApi, useSession } from '../../lib/session';

const LOCAL_KEY_PREFIX = 'fieldline.price-book-org.';

function isNotAvailable(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.is('not_found') ||
      error.is('feature_unavailable') ||
      error.is('method_not_allowed') ||
      error.status === 404 ||
      error.status === 501)
  );
}

function defaultDraft(): LocalPriceBookDraft {
  return {
    wastePercent: '10',
    overheadPercent: '10',
    marginPercent: '25',
    laborRatePerSquare: '95',
    updatedAt: new Date(0).toISOString(),
  };
}

function loadLocal(orgId: string): LocalPriceBookDraft {
  if (typeof window === 'undefined') return defaultDraft();
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY_PREFIX + orgId);
    if (!raw) return defaultDraft();
    const parsed = LocalPriceBookDraftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    /* ignore */
  }
  return defaultDraft();
}

function saveLocal(orgId: string, draft: LocalPriceBookDraft) {
  window.localStorage.setItem(LOCAL_KEY_PREFIX + orgId, JSON.stringify(draft));
}

export function PriceBooksView() {
  return (
    <RouteGate routeId="settings.price_books">
      <PriceBooksContent />
    </RouteGate>
  );
}

function PriceBooksContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const orgId = session.orgId!;

  const books = useQuery({
    queryKey: orgKey(orgId, 'price-books'),
    queryFn: () => endpoints.priceBooks(),
    retry: false,
  });

  const initial = useMemo(() => loadLocal(orgId), [orgId]);
  const [wastePercent, setWastePercent] = useState(initial.wastePercent);
  const [overheadPercent, setOverheadPercent] = useState(initial.overheadPercent);
  const [marginPercent, setMarginPercent] = useState(initial.marginPercent);
  const [laborRatePerSquare, setLaborRatePerSquare] = useState(initial.laborRatePerSquare);
  const [savedAt, setSavedAt] = useState<string | null>(
    initial.updatedAt !== new Date(0).toISOString() ? initial.updatedAt : null,
  );
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [loadedOrg, setLoadedOrg] = useState(orgId);

  // When the active workspace changes, re-seed from that org's local draft without an effect.
  if (loadedOrg !== orgId) {
    const next = loadLocal(orgId);
    setLoadedOrg(orgId);
    setWastePercent(next.wastePercent);
    setOverheadPercent(next.overheadPercent);
    setMarginPercent(next.marginPercent);
    setLaborRatePerSquare(next.laborRatePerSquare);
    setSavedAt(next.updatedAt !== new Date(0).toISOString() ? next.updatedAt : null);
  }

  const persist = useCallback(async () => {
    const draft: LocalPriceBookDraft = {
      wastePercent,
      overheadPercent,
      marginPercent,
      laborRatePerSquare,
      updatedAt: new Date().toISOString(),
    };
    saveLocal(orgId, draft);
    setSavedAt(draft.updatedAt);

    try {
      await endpoints.saveOrgSettings(
        'estimating',
        {
          wastePercent,
          overheadPercent,
          marginPercent,
          laborRatePerSquare,
        },
        'Price book rates updated from Settings',
      );
      setSaveNote('Saved to organization settings and this device.');
    } catch (error) {
      if (isNotAvailable(error)) {
        setSaveNote('Saved on this device (price-books / settings API unavailable).');
      } else if (isApiError(error)) {
        setSaveNote(`Device save kept. Server: ${error.message}`);
      } else {
        setSaveNote('Saved on this device.');
      }
    }
  }, [
    wastePercent,
    overheadPercent,
    marginPercent,
    laborRatePerSquare,
    orgId,
    endpoints,
  ]);

  const unavailable = books.error && isNotAvailable(books.error);

  return (
    <>
      <PageHeader
        title="Price books"
        description="Edit default waste, overhead, margin and labor rates used by Roof and Curb estimators."
      />

      <EstimateLayerSection layer="assumption" title="Organization rate defaults">
        <div className="web-calc-row">
          <Field label="Waste %">
            <TextInput
              inputMode="decimal"
              value={wastePercent}
              onChange={(e) => setWastePercent(e.target.value)}
              suffix="%"
            />
          </Field>
          <Field label="Overhead %">
            <TextInput
              inputMode="decimal"
              value={overheadPercent}
              onChange={(e) => setOverheadPercent(e.target.value)}
              suffix="%"
            />
          </Field>
          <Field label="Margin %">
            <TextInput
              inputMode="decimal"
              value={marginPercent}
              onChange={(e) => setMarginPercent(e.target.value)}
              suffix="%"
            />
          </Field>
          <Field label="Labor $/square">
            <TextInput
              inputMode="decimal"
              value={laborRatePerSquare}
              onChange={(e) => setLaborRatePerSquare(e.target.value)}
              prefix="$"
            />
          </Field>
        </div>
        <div className="web-actions">
          <Button onClick={() => void persist()}>Save rates</Button>
          {savedAt && <span className="web-muted web-small">Last saved {savedAt}</span>}
        </div>
        {saveNote && <p className="web-info web-small">{saveNote}</p>}
      </EstimateLayerSection>

      <section className="web-section" aria-labelledby="server-books-heading">
        <h2 id="server-books-heading">Server price books</h2>
        {books.isPending ? (
          <p className="web-muted">Loading…</p>
        ) : books.error && !unavailable ? (
          <ErrorNotice
            error={books.error}
            title="Price books could not be loaded"
            onRetry={() => void books.refetch()}
          />
        ) : unavailable || !books.data?.items.length ? (
          <EmptyState
            title="No server price books yet"
            description="Approved price-book revisions from the API appear here. Org rate defaults above apply when no revision is selected."
            headingLevel={3}
          />
        ) : (
          <div className="web-table-scroll">
            <table className="web-matrix web-calc-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Currency</th>
                </tr>
              </thead>
              <tbody>
                {books.data.items.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.productLine}</td>
                    <td>{b.status}</td>
                    <td>{b.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
