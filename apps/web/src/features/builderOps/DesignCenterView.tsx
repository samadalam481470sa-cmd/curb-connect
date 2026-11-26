'use client';

// Design center (builder operations): your own options catalog (structural options,
// elevations, finishes, fixtures, flooring) at builder-entered prices, and the selection
// sheet per sales contract. Selections snapshot the catalog price when picked, so a later
// catalog price change never rewrites a signed selection sheet. A contract can link a
// House Studio house so the buyer sees selections against the 3D model in House Builder.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, parseDollarsToMinor, prettyStatus } from './shared';

const Option = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
  visualNote: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const OptionList = z.object({ items: z.array(Option) });
const Selection = z.object({
  id: z.string(),
  contractId: z.string(),
  optionId: z.string(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const Contract = z.object({
  id: z.string(),
  prospectId: z.string(),
  status: z.string(),
  communityName: z.string().nullable(),
  lotLabel: z.string().nullable(),
  planName: z.string().nullable(),
  basePriceMinor: z.number().nullable(),
  currency: z.string(),
  studioHouseId: z.string().nullable(),
  jobId: z.string().nullable(),
  signedOn: z.string().nullable(),
  selections: z.array(Selection),
  totalMinor: z.number().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ContractList = z.object({ items: z.array(Contract) });
const StudioHouse = z.object({ id: z.string(), name: z.string() });
const StudioList = z.object({ items: z.array(StudioHouse) }).passthrough();

const CATEGORIES = ['structural', 'elevation', 'finish', 'fixture', 'flooring', 'other'];

export function DesignCenterView() {
  return (
    <RouteGate routeId="designCenter">
      <DesignCenterContent />
    </RouteGate>
  );
}

function DesignCenterContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('design_center:write');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [contractId, setContractId] = useState('');
  const [error, setError] = useState('');

  const options = useQuery({
    queryKey: orgKey(session.orgId, 'design-center', 'options', categoryFilter),
    queryFn: () =>
      api.get(`/v1/home-sales/options${categoryFilter ? `?category=${categoryFilter}` : ''}`, { schema: OptionList }),
  });
  const contracts = useQuery({
    queryKey: orgKey(session.orgId, 'design-center', 'contracts'),
    queryFn: () => api.get('/v1/home-sales/contracts', { schema: ContractList }),
  });
  const contract = useQuery({
    queryKey: orgKey(session.orgId, 'design-center', 'contract', contractId),
    queryFn: () => api.get(`/v1/home-sales/contracts/${contractId}`, { schema: Contract }),
    enabled: Boolean(contractId),
  });
  const studios = useQuery({
    queryKey: orgKey(session.orgId, 'design-center', 'studios'),
    queryFn: () => api.get('/v1/studio-houses', { schema: StudioList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'design-center') });

  const [category, setCategory] = useState('finish');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [visualNote, setVisualNote] = useState('');
  const createOption = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/home-sales/options',
        {
          category,
          name: name.trim(),
          description: description.trim() || null,
          priceMinor: parseDollarsToMinor(price),
          visualNote: visualNote.trim() || null,
        },
        { schema: Option },
      ),
    onSuccess: () => {
      setName('');
      setDescription('');
      setPrice('');
      setVisualNote('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateOption = useMutation({
    mutationFn: (input: { id: string; active?: boolean; priceMinor?: number | null }) =>
      api.patch(`/v1/home-sales/options/${input.id}`, { active: input.active, priceMinor: input.priceMinor }, { schema: Option }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const addSelection = useMutation({
    mutationFn: (optionId: string) =>
      api.post(`/v1/home-sales/contracts/${contractId}/selections`, { optionId }, { schema: Selection }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const removeSelection = useMutation({
    mutationFn: (selectionId: string) =>
      api.delete(`/v1/home-sales/contracts/${contractId}/selections/${selectionId}`, {
        schema: z.object({ removed: z.literal(true) }),
      }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const linkStudio = useMutation({
    mutationFn: (studioHouseId: string | null) =>
      api.patch(`/v1/home-sales/contracts/${contractId}`, { studioHouseId }, { schema: Contract }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitOption = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Enter an option name.');
      return;
    }
    setError('');
    createOption.mutate();
  };

  const optionName = (id: string) => options.data?.items.find((o) => o.id === id)?.name ?? 'Option';
  const selectedIds = new Set((contract.data?.selections ?? []).map((s) => s.optionId));

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Design Center"
        description="Your options catalog and each contract's selection sheet. Prices are yours to enter; a selection keeps the price from when it was picked. Link a contract to a House Studio house to see the selections against the 3D model in House Builder."
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="option-create-title">
          <h2 id="option-create-title">Add an option</h2>
          <form className="cc-work-board__form" onSubmit={submitOption}>
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{prettyStatus(c)}</option>
                ))}
              </select>
            </label>
            <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Quartz counters" /></label>
            <label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <label>Price ($, blank = price on request)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label>Visual note (finish/color)<input value={visualNote} onChange={(e) => setVisualNote(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createOption.isPending}>Add option</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="option-list-title">
        <h2 id="option-list-title">Options catalog</h2>
        <label>
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{prettyStatus(c)}</option>
            ))}
          </select>
        </label>
        {options.isError && <ErrorNotice error={options.error} title="Could not load options" />}
        {options.data && options.data.items.length === 0 && <p className="web-muted">No options yet.</p>}
        {options.data && options.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Visual note</th><th>Active</th>{canWrite && contractId && <th>Select</th>}</tr></thead>
              <tbody>
                {options.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>{o.name}{o.description ? <span className="web-muted"> — {o.description}</span> : null}</td>
                    <td>{prettyStatus(o.category)}</td>
                    <td>{o.priceMinor === null ? 'Price on request' : money(o.priceMinor, o.currency)}</td>
                    <td>{o.visualNote ?? '—'}</td>
                    <td>
                      {canWrite ? (
                        <button type="button" className="cc-btn" onClick={() => updateOption.mutate({ id: o.id, active: !o.active })}>
                          {o.active ? 'Active' : 'Inactive'}
                        </button>
                      ) : (
                        o.active ? 'Active' : 'Inactive'
                      )}
                    </td>
                    {canWrite && contractId && (
                      <td>
                        {selectedIds.has(o.id) ? (
                          <span className="web-muted">Selected</span>
                        ) : (
                          <button type="button" className="cc-btn cc-btn--primary" onClick={() => addSelection.mutate(o.id)}>
                            Select
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="web-card" aria-labelledby="selection-sheet-title">
        <h2 id="selection-sheet-title">Selection sheet</h2>
        <label>
          Contract
          <select value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">Choose a contract…</option>
            {(contracts.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.planName ?? 'Unnamed plan'}{c.lotLabel ? ` · Lot ${c.lotLabel}` : ''} · {prettyStatus(c.status)}
              </option>
            ))}
          </select>
        </label>
        {contractId && contract.data && (
          <>
            <p className="web-muted">
              Base price: {money(contract.data.basePriceMinor, contract.data.currency)} · Total with selections:{' '}
              <strong>{money(contract.data.totalMinor, contract.data.currency)}</strong>
            </p>
            {canWrite && (
              <label>
                House Studio house (3D model)
                <select
                  value={contract.data.studioHouseId ?? ''}
                  onChange={(e) => linkStudio.mutate(e.target.value || null)}
                >
                  <option value="">Not linked</option>
                  {(studios.data?.items ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
            )}
            {contract.data.studioHouseId && (
              <p>
                <a href="/build">Open House Builder to see this house in 3D</a>
              </p>
            )}
            {contract.data.selections.length === 0 && <p className="web-muted">No selections yet — pick options from the catalog above.</p>}
            {contract.data.selections.length > 0 && (
              <div className="cc-table-wrap">
                <table>
                  <thead><tr><th>Option</th><th>Price at selection</th>{canWrite && <th></th>}</tr></thead>
                  <tbody>
                    {contract.data.selections.map((s) => (
                      <tr key={s.id}>
                        <td>{optionName(s.optionId)}</td>
                        <td>{s.priceMinor === null ? 'Price on request' : money(s.priceMinor, s.currency)}</td>
                        {canWrite && (
                          <td>
                            <button type="button" className="cc-btn" onClick={() => removeSelection.mutate(s.id)}>
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}
