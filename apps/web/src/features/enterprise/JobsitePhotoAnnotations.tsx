'use client';

import {
  type JobsiteAnnotationPoint,
  JobsitePhotoAnnotation,
  JobsitePhotoAnnotationRevision,
  JobsitePhotoAnnotationView,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobsitePhotoAnnotationCanvas } from './JobsitePhotoAnnotationCanvas';

const names = { arrow: 'Arrow', box: 'Box', note: 'Note', redaction: 'Redaction' };
type Draft = { base: number; annotations: JobsitePhotoAnnotation[] };

export function JobsitePhotoAnnotations({
  path,
  filename,
  canEdit,
}: {
  path: string;
  filename: string;
  canEdit: boolean;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const key = orgKey(orgId, 'enterprise', 'jobsite-photo-annotations', path);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [kind, setKind] = useState<JobsitePhotoAnnotation['kind']>('arrow');
  const [note, setNote] = useState('');
  const [validation, setValidation] = useState('');
  const [notice, setNotice] = useState('');
  const [copyText, setCopyText] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: JobsitePhotoAnnotationView }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: ({ base, annotations }: Draft) => {
      const signature = JSON.stringify({ base, annotations });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path,
        { baseDerivativeVersion: base, annotations, clientRequestId: request.current.id },
        { ifMatch: base, schema: JobsitePhotoAnnotationRevision },
      );
    },
    onSuccess: (version) => {
      client.setQueryData(key, (previous: typeof query.data) =>
        (previous?.revision ?? 0) > version.revision
          ? previous
          : {
              revision: version.revision,
              current: version,
              history: [
                version,
                ...(previous?.history ?? []).filter((item) => item.revision !== version.revision),
              ].slice(0, 20),
            },
      );
      request.current = null;
      setDraft(null);
      setCopyText('');
      setSelectedRevision(null);
      setNotice('Saved photo annotation revision ' + version.revision + '.');
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) void query.refetch();
    },
  });

  const visible = query.isError ? undefined : query.data;
  const stale = !!draft && !!visible && draft.base < visible.revision;
  const chosen =
    visible?.history.find((item) => item.revision === selectedRevision) ?? visible?.current;

  function edit() {
    if (!visible) return;
    save.reset();
    request.current = null;
    setDraft({ base: visible.revision, annotations: visible.current?.annotations ?? [] });
    setNote('');
    setValidation('');
    setNotice('');
    setCopyText('');
  }

  function add(from: JobsiteAnnotationPoint, to: JobsiteAnnotationPoint) {
    if (!draft || draft.annotations.length >= 50 || save.isPending) return;
    const result = JobsitePhotoAnnotation.safeParse(
      kind === 'note' ? { kind, at: from, text: note } : { kind, from, to },
    );
    if (!result.success) {
      setValidation(
        kind === 'note' ? 'Enter note text before placing it.' : 'Draw a visible shape.',
      );
      return;
    }
    setValidation('');
    setDraft({ ...draft, annotations: [...draft.annotations, result.data] });
    if (kind === 'note') setNote('');
  }

  function addByCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const coordinates = new FormData(event.currentTarget);
    const read = (name: string) => Number(coordinates.get(name)) / 100;
    const from = { x: read('start-x'), y: read('start-y') };
    add(from, kind === 'note' ? from : { x: read('end-x'), y: read('end-y') });
  }

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Photo annotations</summary>
      {open && query.isPending && <p role="status">Loading photo annotations…</p>}
      {open && query.isError && (
        <div role="alert">
          <p>{errorHint(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Retry annotations
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {open && visible && (
        <>
          {chosen ? (
            <div className="enterprise-photo-annotations">
              <label>
                Annotation revision
                <select
                  value={chosen.revision}
                  onChange={(event) => setSelectedRevision(Number(event.currentTarget.value))}
                >
                  {visible.history.map((item) => (
                    <option key={item.id} value={item.revision}>
                      Revision {item.revision}
                    </option>
                  ))}
                </select>
              </label>
              <Image
                unoptimized
                src={path + '/' + chosen.revision + '/image'}
                alt={'Annotated ' + filename + ', revision ' + chosen.revision}
                width={chosen.width}
                height={chosen.height}
                className="enterprise-photo-annotation-result"
              />
              <ul aria-label="Saved annotations">
                {chosen.annotations.map((shape, index) => (
                  <li key={index}>
                    {shape.kind === 'note' ? 'Note: ' + shape.text : names[shape.kind]}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>No photo annotations yet.</p>
          )}
          {canEdit && !draft && (
            <button type="button" onClick={edit}>
              {chosen ? 'Edit annotations' : 'Annotate photo'}
            </button>
          )}
        </>
      )}
      {draft && canEdit && (
        <section aria-label="Photo annotation editor" className="enterprise-photo-annotations">
          <p>Editing revision {draft.base}</p>
          {stale && (
            <div role="alert">
              <p>Another edit saved revision {visible.revision}. Your draft is still available.</p>
              <button type="button" onClick={edit}>
                Reload latest annotations
              </button>
              <button
                type="button"
                onClick={() => {
                  const json = JSON.stringify(draft.annotations, null, 2);
                  setCopyText(json);
                  if (navigator.clipboard) void navigator.clipboard.writeText(json).catch(() => {});
                }}
              >
                Copy draft annotations
              </button>
            </div>
          )}
          {copyText && (
            <label>
              Draft annotations to copy
              <textarea readOnly value={copyText} />
            </label>
          )}
          {save.isError && !stale && <p role="alert">{errorHint(save.error)}</p>}
          <label>
            Annotation tool
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.currentTarget.value as JobsitePhotoAnnotation['kind']);
                setValidation('');
              }}
            >
              {Object.entries(names).map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {kind === 'note' && (
            <label>
              Note text
              <input
                value={note}
                maxLength={240}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </label>
          )}
          <p>
            {kind === 'note' ? 'Tap the photo to place the note.' : 'Drag on the photo to draw.'}
          </p>
          <JobsitePhotoAnnotationCanvas
            sourceUrl={path + '/source'}
            annotations={draft.annotations}
            kind={kind}
            active={!save.isPending && draft.annotations.length < 50}
            onDraw={add}
          />
          <details>
            <summary>Place by coordinates</summary>
            <form aria-label="Place annotation by coordinates" onSubmit={addByCoordinates}>
              <div className="enterprise-photo-annotation-coordinates">
                <label>
                  Start X (%)
                  <input type="number" name="start-x" min="0" max="100" step="0.1" required />
                </label>
                <label>
                  Start Y (%)
                  <input type="number" name="start-y" min="0" max="100" step="0.1" required />
                </label>
                {kind !== 'note' && (
                  <>
                    <label>
                      End X (%)
                      <input type="number" name="end-x" min="0" max="100" step="0.1" required />
                    </label>
                    <label>
                      End Y (%)
                      <input type="number" name="end-y" min="0" max="100" step="0.1" required />
                    </label>
                  </>
                )}
              </div>
              <button type="submit" disabled={save.isPending || draft.annotations.length >= 50}>
                Add annotation
              </button>
            </form>
          </details>
          {validation && <p role="alert">{validation}</p>}
          {draft.annotations.length > 0 && (
            <ul aria-label="Draft annotation list">
              {draft.annotations.map((shape, index) => (
                <li key={index}>
                  {shape.kind === 'note' ? 'Note: ' + shape.text : names[shape.kind]}
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        annotations: draft.annotations.filter((_, at) => at !== index),
                      });
                    }}
                  >
                    Remove {names[shape.kind].toLowerCase()} {index + 1}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="enterprise-photo-annotation-actions">
            <button
              type="button"
              disabled={!visible || stale || !draft.annotations.length || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? 'Saving annotations…' : 'Save annotations'}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                save.reset();
              }}
            >
              Cancel annotation edit
            </button>
          </div>
        </section>
      )}
    </details>
  );
}
