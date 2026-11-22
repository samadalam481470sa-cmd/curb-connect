'use client';

// "My houses": every house built by the AI bar, read from a plan or drawn by hand is saved here.
// Open, save, rename, copy, move to the trash (with undo), restore, or delete for good. Saves name
// the revision they were made from, so an older tab can never overwrite newer work.
import {
  type StudioHouse,
  StudioHouseListSchema,
  StudioHouseSchema,
  type StudioHouseSettings,
  type StudioHouseSpec,
  type STUDIO_HOUSE_SOURCES,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';

export interface CurrentHouse {
  id: string;
  name: string;
  revision: number;
}

export interface HouseSnapshot {
  spec: StudioHouseSpec;
  settings: StudioHouseSettings;
  brief: string;
  source: (typeof STUDIO_HOUSE_SOURCES)[number];
}

const SOURCE_LABEL: Record<(typeof STUDIO_HOUSE_SOURCES)[number], string> = {
  ai: 'AI',
  rules: 'Typed brief',
  plan: 'From plan',
  manual: 'Hand-drawn',
};

export const STUDIO_HOUSES_KEY = ['studio-houses'] as const;

export function problemText(error: unknown): string {
  if (isApiError(error) && error.problem.detail) return error.problem.detail;
  return errorHint(error);
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function StudioHouses({
  current,
  onCurrentChange,
  snapshot,
  onOpen,
}: {
  current: CurrentHouse | null;
  onCurrentChange: (next: CurrentHouse | null) => void;
  snapshot: () => HouseSnapshot;
  onOpen: (house: StudioHouse) => void;
}) {
  const { api } = useApi();
  const qc = useQueryClient();
  const [showTrash, setShowTrash] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string; revision: number } | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null);
  const [undo, setUndo] = useState<StudioHouse | null>(null);
  const [message, setMessage] = useState<{ text: string; reload?: string } | null>(null);

  const list = useQuery({
    queryKey: [...STUDIO_HOUSES_KEY, showTrash ? 'trash' : 'active'],
    queryFn: () => api.get('/v1/studio-houses', { schema: StudioHouseListSchema, query: { trash: showTrash ? 'true' : 'false' } }),
    staleTime: 15_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: STUDIO_HOUSES_KEY });

  const fail = (error: unknown, id?: string) => {
    const conflict = isApiError(error) && error.code === 'revision_conflict';
    setMessage({ text: problemText(error), ...(conflict && id ? { reload: id } : {}) });
  };

  const save = useMutation({
    mutationFn: async (mode: 'save' | 'new') => {
      const snap = snapshot();
      if (mode === 'save' && current) {
        return api.patch(`/v1/studio-houses/${current.id}`, { revision: current.revision, spec: snap.spec, settings: snap.settings }, { schema: StudioHouseSchema });
      }
      const name = newName.trim() || (current ? `${current.name} (copy)` : `House ${new Date().toLocaleDateString('en-US')}`);
      return api.post('/v1/studio-houses', { name: name.slice(0, 160), source: snap.source, brief: snap.brief, spec: snap.spec, settings: snap.settings }, { schema: StudioHouseSchema });
    },
    onSuccess: (house) => {
      onCurrentChange({ id: house.id, name: house.name, revision: house.revision });
      setNewName('');
      setMessage({ text: `Saved "${house.name}".` });
      void refresh();
    },
    onError: (e) => fail(e, current?.id),
  });

  const rename = useMutation({
    mutationFn: (r: { id: string; name: string; revision: number }) =>
      api.patch(`/v1/studio-houses/${r.id}`, { revision: r.revision, name: r.name.trim() }, { schema: StudioHouseSchema }),
    onSuccess: (house) => {
      if (current?.id === house.id) onCurrentChange({ id: house.id, name: house.name, revision: house.revision });
      setRenaming(null);
      setMessage({ text: `Renamed to "${house.name}".` });
      void refresh();
    },
    onError: (e, r) => fail(e, r.id),
  });

  const copy = useMutation({
    mutationFn: (id: string) => api.post(`/v1/studio-houses/${id}/duplicate`, undefined, { schema: StudioHouseSchema }),
    onSuccess: (house) => {
      setMessage({ text: `Copied as "${house.name}".` });
      void refresh();
    },
    onError: (e) => fail(e),
  });

  const trash = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/studio-houses/${id}`, { schema: StudioHouseSchema }),
    onSuccess: (house) => {
      if (current?.id === house.id) onCurrentChange(null);
      setUndo(house);
      setMessage({ text: `Moved "${house.name}" to the trash.` });
      void refresh();
    },
    onError: (e) => fail(e),
  });

  const restore = useMutation({
    mutationFn: (id: string) => api.post(`/v1/studio-houses/${id}/restore`, undefined, { schema: StudioHouseSchema }),
    onSuccess: (house) => {
      setUndo(null);
      setMessage({ text: `Restored "${house.name}".` });
      void refresh();
    },
    onError: (e) => fail(e),
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/studio-houses/${id}`, { query: { permanent: 'true' } }),
    onSuccess: () => {
      setConfirmPurge(null);
      setMessage({ text: 'Deleted for good.' });
      void refresh();
    },
    onError: (e) => fail(e),
  });

  async function open(id: string) {
    try {
      const house = await api.get(`/v1/studio-houses/${id}`, { schema: StudioHouseSchema });
      onOpen(house);
      onCurrentChange({ id: house.id, name: house.name, revision: house.revision });
      setMessage({ text: `Opened "${house.name}".` });
    } catch (e) {
      fail(e);
    }
  }

  const items = list.data?.items ?? [];
  const busy = save.isPending || rename.isPending || copy.isPending || trash.isPending || restore.isPending || purge.isPending;

  return (
    <div className="wb-houses">
      <div className="wb-row">
        <div className="wb-current">
          <span className="wb-label">Working on</span>
          <strong>{current ? current.name : 'Unsaved house'}</strong>
          {current && <span className="wb-muted">revision {current.revision}</span>}
        </div>
        <div className="wb-actions">
          {current && (
            <button type="button" className="hs-pill is-on" disabled={busy} onClick={() => save.mutate('save')}>
              Save changes
            </button>
          )}
          <input
            className="wb-input"
            value={newName}
            maxLength={160}
            placeholder={current ? 'Name for a new copy' : 'Name this house'}
            aria-label="House name"
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="button" className={`hs-pill ${current ? '' : 'is-on'}`} disabled={busy} onClick={() => save.mutate('new')}>
            {current ? 'Save as new' : 'Save house'}
          </button>
        </div>
      </div>

      {message && (
        <p className="wb-message" role="status">
          {message.text}{' '}
          {message.reload && (
            <button type="button" className="wb-link" onClick={() => void open(message.reload!)}>
              Load the saved copy
            </button>
          )}
          {undo && !message.reload && (
            <button type="button" className="wb-link" onClick={() => restore.mutate(undo.id)}>
              Undo
            </button>
          )}
        </p>
      )}

      <div className="wb-row wb-tabs-mini" role="group" aria-label="Show">
        <button type="button" className={`hs-pill ${showTrash ? '' : 'is-on'}`} aria-pressed={!showTrash} onClick={() => setShowTrash(false)}>
          Saved
        </button>
        <button type="button" className={`hs-pill ${showTrash ? 'is-on' : ''}`} aria-pressed={showTrash} onClick={() => setShowTrash(true)}>
          Trash
        </button>
      </div>

      {list.isLoading && <p className="wb-muted">Loading houses…</p>}
      {list.error && <p className="hs-ai-error" role="alert">{problemText(list.error)}</p>}
      {!list.isLoading && items.length === 0 && (
        <p className="wb-muted">
          {showTrash ? 'The trash is empty.' : 'No saved houses yet. Build one with the AI bar above, or save this one.'}
        </p>
      )}
      <ul className="wb-list">
        {items.map((h) => (
          <li key={h.id} className={`wb-item ${current?.id === h.id ? 'is-current' : ''}`}>
            <div className="wb-item-main">
              {renaming?.id === h.id ? (
                <form
                  className="wb-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (renaming.name.trim()) rename.mutate(renaming);
                  }}
                >
                  <input
                    className="wb-input"
                    value={renaming.name}
                    maxLength={160}
                    aria-label={`New name for ${h.name}`}
                    autoFocus
                    onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                  />
                  <button type="submit" className="hs-pill is-on" disabled={busy || !renaming.name.trim()}>Save name</button>
                  <button type="button" className="hs-pill" onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <strong className="wb-name">{h.name}</strong>
                  <span className="wb-muted">
                    {SOURCE_LABEL[h.source]} · {h.spec.stories}-story · {h.spec.bedrooms} bed / {h.spec.bathrooms} bath ·{' '}
                    {h.spec.lengthFt} × {h.spec.widthFt} ft · {showTrash && h.deletedAt ? `deleted ${when(h.deletedAt)}` : `saved ${when(h.updatedAt)}`}
                  </span>
                </>
              )}
            </div>
            {renaming?.id !== h.id && (
              <div className="wb-item-actions">
                {showTrash ? (
                  <>
                    <button type="button" className="hs-pill" disabled={busy} onClick={() => restore.mutate(h.id)}>Restore</button>
                    {confirmPurge === h.id ? (
                      <>
                        <button type="button" className="hs-pill wb-danger" disabled={busy} onClick={() => purge.mutate(h.id)}>
                          Yes, delete for good
                        </button>
                        <button type="button" className="hs-pill" onClick={() => setConfirmPurge(null)}>Keep</button>
                      </>
                    ) : (
                      <button type="button" className="hs-pill wb-danger" disabled={busy} onClick={() => setConfirmPurge(h.id)}>
                        Delete forever
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" className="hs-pill is-on" disabled={busy} onClick={() => void open(h.id)}>Open</button>
                    <button type="button" className="hs-pill" disabled={busy} onClick={() => setRenaming({ id: h.id, name: h.name, revision: h.revision })}>
                      Rename
                    </button>
                    <button type="button" className="hs-pill" disabled={busy} onClick={() => copy.mutate(h.id)}>Copy</button>
                    <button type="button" className="hs-pill wb-danger" disabled={busy} onClick={() => trash.mutate(h.id)}>Delete</button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
