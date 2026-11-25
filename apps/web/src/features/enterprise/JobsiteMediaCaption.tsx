'use client';

import {
  JobsiteMediaCaption,
  MAX_JOBSITE_CAPTION_LENGTH,
  MAX_JOBSITE_MEDIA_TAGS,
  SetJobsiteMediaCaption,
  type JobsiteCaptionView,
} from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';

export function JobsiteCaption({
  path,
  initial,
  canEdit,
  onSaved,
}: {
  path: string;
  initial: JobsiteCaptionView;
  canEdit: boolean;
  onSaved: (caption: JobsiteCaptionView) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      {initial.caption && <p className="enterprise-jobsite-caption">{initial.caption}</p>}
      {!!initial.tags.length && <p>Tags · {initial.tags.join(', ')}</p>}
      {canEdit &&
        (editing ? (
          <CaptionForm
            path={path}
            initial={initial}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              onSaved(saved);
              setEditing(false);
            }}
          />
        ) : (
          <button type="button" onClick={() => setEditing(true)}>
            {initial.revision === 0 ? 'Add caption' : 'Edit caption'}
          </button>
        ))}
    </>
  );
}

function CaptionForm({
  path,
  initial,
  onCancel,
  onSaved,
}: {
  path: string;
  initial: JobsiteCaptionView;
  onCancel: () => void;
  onSaved: (caption: JobsiteCaptionView) => void;
}) {
  const { api } = useApi();
  const [base, setBase] = useState(initial);
  const [caption, setCaption] = useState(initial.caption);
  const [tags, setTags] = useState(initial.tags.join(', '));
  const [validation, setValidation] = useState('');
  const [conflict, setConflict] = useState<JobsiteCaptionView | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const current = useMutation({
    mutationFn: () => api.get(path, { schema: JobsiteMediaCaption }),
    onSuccess: setConflict,
  });
  const save = useMutation({
    mutationFn: (input: z.infer<typeof SetJobsiteMediaCaption>) =>
      api.put(path, input, { ifMatch: base.revision, schema: JobsiteMediaCaption }),
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) current.mutate();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || current.isPending || conflict) return;
    const cleanTags = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const fields = { caption: caption.trim(), tags: cleanTags };
    const signature = JSON.stringify({ ...fields, revision: base.revision });
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    const parsed = SetJobsiteMediaCaption.safeParse({
      ...fields,
      clientRequestId: request.current.id,
    });
    if (!parsed.success) {
      setValidation(parsed.error.issues[0]?.message ?? 'Check the caption and tags.');
      return;
    }
    setValidation('');
    save.mutate(parsed.data);
  }

  return (
    <form className="enterprise-form" aria-label="Jobsite media caption" onSubmit={submit}>
      <label>
        Caption
        <textarea
          value={caption}
          maxLength={MAX_JOBSITE_CAPTION_LENGTH}
          disabled={save.isPending}
          onChange={(event) => setCaption(event.target.value)}
        />
      </label>
      <label>
        Tags
        <input
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          disabled={save.isPending}
        />
      </label>
      <p>Separate tags with commas. Add up to {MAX_JOBSITE_MEDIA_TAGS}.</p>
      {validation && <p role="alert">{validation}</p>}
      {save.isError && !conflict && <p role="alert">{errorHint(save.error)}</p>}
      {current.isError && (
        <button type="button" onClick={() => current.mutate()}>
          Retry loading the current caption
        </button>
      )}
      {conflict && (
        <div role="status">
          <p>Another edit saved revision {conflict.revision} while this form was open.</p>
          {conflict.caption && <p>{conflict.caption}</p>}
          {!!conflict.tags.length && <p>Tags · {conflict.tags.join(', ')}</p>}
          <button
            type="button"
            onClick={() => {
              setBase(conflict);
              setConflict(null);
              save.reset();
            }}
          >
            Use revision {conflict.revision} as the basis for my edit
          </button>
        </div>
      )}
      <button
        type="submit"
        disabled={save.isPending || current.isPending || !!conflict || current.isError}
      >
        {save.isPending ? 'Saving caption…' : 'Save caption'}
      </button>
      <button type="button" disabled={save.isPending} onClick={onCancel}>
        Cancel caption edit
      </button>
    </form>
  );
}
