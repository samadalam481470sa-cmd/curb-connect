'use client';

// Cloud-first personal autosave. The signed-in identity is read from the session context.
// Never silently import legacy, unscoped localStorage from a shared device.
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useApi, useSession } from './session';

const CloudDraftSchema = z.object({
  key: z.string(),
  value: z.record(z.string(), z.unknown()),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
});
export type CloudDraftState = 'loading' | 'saved' | 'unsaved' | 'saving' | 'conflict' | 'error';
const MAX_JSON_LENGTH = 240_000;

export function useAccountDraft<T extends object>({
  key, value, onRestore, legacyKey,
}: {
  key: 'house-builder' | 'curb-workspace' | 'roof-workspace' | 'invoice-contacts' | 'bid-portals' | 'external-bid-imports' | 'lawn-workspace';
  value: T;
  onRestore: (value: Partial<T>) => void;
  legacyKey: string;
}) {
  const { api } = useApi();
  const { me, orgId } = useSession();
  const scope = orgId + '/' + me.user.id + '/' + key;
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<CloudDraftState>('loading');
  const [message, setMessage] = useState('');
  const [hasCloudDraft, setHasCloudDraft] = useState(false);
  const revision = useRef(0);
  const lastSaved = useRef('');
  const blocked = useRef(false);
  const restoreRef = useRef(onRestore);
  useEffect(() => { restoreRef.current = onRestore; }, [onRestore]);
  const queued = useRef<Promise<void>>(Promise.resolve());
  const serialized = JSON.stringify(value);
  const path = '/v1/me/drafts/' + key;

  useEffect(() => {
    let active = true;
    // Stale responses are ignored when switching companies, users or workspaces.
    revision.current = 0;
    lastSaved.current = '';
    blocked.current = false;
    Promise.resolve().then(() => {
      if (!active) return;
      setReady(false);
      setStatus('loading');
      setMessage('');
      setHasCloudDraft(false);
    });
    void (async () => {
      try {
        const draft = await api.get(path, { schema: CloudDraftSchema.nullable() });
        if (!active) return;
        if (draft) {
          revision.current = draft.revision;
          lastSaved.current = JSON.stringify(draft.value);
          restoreRef.current(draft.value as Partial<T>);
          setHasCloudDraft(true);
        } else {
          // No cloud document: do not reuse another person's old unscoped local draft.
          lastSaved.current = ''; // New accounts start with no saved draft; create it on first open.
        }
        setReady(true);
        setStatus(draft ? 'saved' : 'unsaved');
      } catch (error) {
        if (!active) return;
        blocked.current = true;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'Could not load account data.');
      }
    })();
    return () => { active = false; };
    // Intentionally loads only when signed-in identity or workspace changes.
  }, [api, scope, path]);

  useEffect(() => {
    if (!ready || blocked.current || serialized === lastSaved.current) return;
    const handle = window.setTimeout(() => {
      if (blocked.current) return;
      if (serialized.length > MAX_JSON_LENGTH) {
        blocked.current = true;
        setStatus('error');
        setMessage('This draft is too large for autosave (240 KB). Save a smaller draft.');
        return;
      }
      setStatus('saving');
      queued.current = queued.current.then(async () => {
        if (blocked.current || serialized === lastSaved.current) return;
        try {
          const saved = await api.put(path, {
            value: JSON.parse(serialized) as T,
            expectedRevision: revision.current,
          }, { schema: CloudDraftSchema });
          revision.current = saved.revision;
          lastSaved.current = serialized;
          setHasCloudDraft(true);
          setStatus('saved');
          setMessage('');
        } catch (error) {
          blocked.current = true; // Prevent stale-device overwrites.
          const status = error && typeof error === 'object' && 'status' in error
            ? (error as { status: number }).status : 0;
          setStatus(status === 409 ? 'conflict' : 'error');
          setMessage(error instanceof Error ? error.message : 'Autosave failed.');
        }
      });
    }, 850);
    return () => window.clearTimeout(handle);
  }, [api, path, ready, serialized]);

  const importLegacy = () => {
    let raw: string | null = null;
    try { raw = window.localStorage.getItem(legacyKey); } catch { /* blocked browser storage */ }
    if (!raw) {
      setMessage('No previous browser-only draft was found on this device.');
      return;
    }
    if (hasCloudDraft && !window.confirm(
      'An account draft exists. Replace it with this browser\'s previous draft?'
    )) return;
    try {
      const oldValue = JSON.parse(raw) as Partial<T>;
      if (!oldValue || typeof oldValue !== 'object' || Array.isArray(oldValue))
        throw new Error('Invalid draft.');
      blocked.current = false;
      setMessage('');
      setStatus('unsaved');
      restoreRef.current(oldValue);
      // The change is written through the normal version-aware debounced saver.
    } catch {
      setMessage('The previous browser draft is invalid and was not imported.');
    }
  };

  const reload = () => {
    // A conflict must not be resolved by guessing which edit wins. Reload the page
    // to explicitly discard local changes, or export them before reloading.
    if (window.confirm('Reload the account draft? Unsaved changes on this device will be discarded.')) {
      window.location.reload();
    }
  };

  return { ready, status, message, importLegacy, reload, hasCloudDraft };
}

export function AccountDraftStatus({
  status, message, onImport, onReload,
}: {
  status: CloudDraftState;
  message: string;
  onImport: () => void;
  onReload: () => void;
}) {
  return (
    <div className="cc-callout" role="status" aria-live="polite">
      <strong>Account cloud save:</strong>{' '}
      {status === 'loading' ? 'Loading your saved workspace…' :
        status === 'saving' ? 'Saving to your account…' :
        status === 'saved' ? 'Synced to your signed-in account.' :
        status === 'unsaved' ? 'Local changes pending cloud save.' :
        status === 'conflict' ? 'Another session changed this draft. Saving paused.' :
        'Cloud save is unavailable. Your edits are not yet backed up.'}
      {message && <span> {message}</span>}
      <div className="cc-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
        <button type="button" className="cc-btn cc-btn--sm" onClick={onImport}>
          Import this device's old draft
        </button>
        {(status === 'conflict' || status === 'error') && (
          <button type="button" className="cc-btn cc-btn--sm" onClick={onReload}>
            Reload account copy
          </button>
        )}
      </div>
    </div>
  );
}
