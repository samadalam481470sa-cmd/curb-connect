'use client';

import {
  CreateTakeoffComparisonNote,
  TakeoffComparisonNote,
  TakeoffComparisonNotePage,
  type TakeoffComparisonPreview,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Preview = z.infer<typeof TakeoffComparisonPreview>;
type Anchor = { x: number; y: number };
const center = { x: 0.5, y: 0.5 };

export function TakeoffComparisonNotes({
  projectPath,
  preview,
  children,
}: {
  projectPath: string;
  preview: Preview;
  children: (place: (event: MouseEvent<HTMLCanvasElement>) => void) => ReactNode;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const path = projectPath + '/takeoff/comparison-notes';
  const key = [
    ...orgKey(session.orgId, 'enterprise'),
    'takeoff-comparison-notes',
    preview.comparisonKey,
  ];
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const retry = useRef<{ input: string; id: string } | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const notes = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, {
        query: { comparisonKey: preview.comparisonKey, cursor: pageParam },
        schema: TakeoffComparisonNotePage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const entries = notes.data?.pages.flatMap((page) => page.items) ?? [];
  const add = useMutation({
    mutationFn: (input: z.infer<typeof CreateTakeoffComparisonNote>) =>
      api.post(path, input, { schema: TakeoffComparisonNote }),
  });

  function place(event: MouseEvent<HTMLCanvasElement>) {
    if (!anchor || add.isPending) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    setAnchor({
      x: (event.clientX - box.left) / box.width,
      y: (event.clientY - box.top) / box.height,
    });
    setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!anchor || add.isPending) return;
    const form = new FormData(event.currentTarget);
    const body = String(form.get('body')).trim();
    setError('');
    setSaved(false);
    const fields = {
      oldRevisionId: preview.earlier.planId,
      oldSheetId: preview.earlier.sheetId,
      newRevisionId: preview.current.planId,
      newSheetId: preview.current.sheetId,
      alignment: preview.alignment,
      comparisonKey: preview.comparisonKey,
      ...anchor,
      body,
    };
    const input = JSON.stringify(fields);
    if (retry.current?.input !== input) retry.current = { input, id: crypto.randomUUID() };
    try {
      const command = CreateTakeoffComparisonNote.parse({
        ...fields,
        clientRequestId: retry.current.id,
      });
      await add.mutateAsync(command);
      retry.current = null;
      setAnchor(null);
      setSaved(true);
      await client.invalidateQueries({ queryKey: key });
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? (cause.issues[0]?.message ?? 'Check the review note.')
          : isApiError(cause) && cause.kind === 'problem'
            ? cause.message
            : errorHint(cause),
      );
    }
  }

  return (
    <section className="enterprise-stack" aria-label="Comparison review notes">
      <div className="enterprise-comparison-surface">
        {children(place)}
        {entries.map((note, index) => (
          <button
            key={note.id}
            className="enterprise-comparison-pin"
            type="button"
            aria-label={'Show comparison note ' + (index + 1)}
            style={{ left: note.x * 100 + '%', top: note.y * 100 + '%' }}
            onClick={() => rows.current.get(note.id)?.focus()}
          >
            {index + 1}
          </button>
        ))}
        {anchor && (
          <span
            className="enterprise-comparison-pin enterprise-comparison-draft-pin"
            style={{ left: anchor.x * 100 + '%', top: anchor.y * 100 + '%' }}
            aria-hidden="true"
          >
            +
          </span>
        )}
      </div>
      {session.can('estimate:write') && !anchor && (
        <button
          type="button"
          onClick={() => {
            setSaved(false);
            setAnchor(center);
          }}
        >
          Add comparison note
        </button>
      )}
      {anchor && (
        <form
          className="enterprise-form"
          aria-label="New comparison note"
          onSubmit={(event) => void save(event)}
        >
          <p>Choose a location on the drawing or enter its position.</p>
          <label>
            Horizontal position (%){' '}
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={Number((anchor.x * 100).toFixed(4))}
              required
              onChange={(event) => setAnchor({ ...anchor, x: Number(event.target.value) / 100 })}
            />
          </label>
          <label>
            Vertical position (%){' '}
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={Number((anchor.y * 100).toFixed(4))}
              required
              onChange={(event) => setAnchor({ ...anchor, y: Number(event.target.value) / 100 })}
            />
          </label>
          <label>
            Review note <textarea name="body" required minLength={3} maxLength={1000} />
          </label>
          <button type="submit" disabled={add.isPending}>
            {add.isPending ? 'Saving note…' : 'Save comparison note'}
          </button>
          <button
            type="button"
            disabled={add.isPending}
            onClick={() => {
              setAnchor(null);
              setError('');
            }}
          >
            Cancel note
          </button>
        </form>
      )}
      {notes.isPending && <p role="status">Loading review notes…</p>}
      {notes.isError && (
        <div>
          <p role="alert" className="enterprise-error">
            {errorHint(notes.error)}
          </p>
          <button type="button" onClick={() => void notes.refetch()}>
            Retry loading notes
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      {saved && <p role="status">Comparison note saved</p>}
      {entries.length > 0 && (
        <ol aria-label="Saved comparison notes" className="enterprise-change-history">
          {entries.map((note) => (
            <li
              key={note.id}
              tabIndex={-1}
              ref={(node) => {
                if (node) rows.current.set(note.id, node);
                else rows.current.delete(note.id);
              }}
            >
              <span>{note.body}</span>
              <time dateTime={note.createdAt}>{note.createdAt.slice(0, 10)}</time>
            </li>
          ))}
        </ol>
      )}
      {notes.hasNextPage && (
        <button
          type="button"
          disabled={notes.isFetchingNextPage}
          onClick={() => void notes.fetchNextPage()}
        >
          Load more comparison notes
        </button>
      )}
    </section>
  );
}
