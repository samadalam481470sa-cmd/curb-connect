'use client';

// Phone-first checklist runner: one big Pass / Fail / N/A tap per item, progress at the
// top, photo capture attached to the result, and a Complete button. Answers save
// through the offline outbox, so a dead spot on site never loses the walk.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, type UiLang } from '../builderOps/shared';
import { PhotoCapture } from './PhotoCapture';

const Answer = z.object({
  key: z.string(),
  result: z.enum(['pass', 'fail', 'na']),
  note: z.string().nullable().optional(),
});
const Result = z.object({
  id: z.string(),
  templateId: z.string(),
  jobId: z.string().nullable(),
  inspectorName: z.string().nullable(),
  status: z.enum(['in_progress', 'completed']),
  answers: z.array(Answer),
  photoMediaIds: z.array(z.string()),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Template = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  items: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const TemplateList = z.object({ items: z.array(Template) });

type AnswerValue = 'pass' | 'fail' | 'na';

export function ChecklistRunner({ resultId, lang }: { resultId: string; lang: UiLang }) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const L = FIELD_LABELS[lang];
  const scope = { userId: session.me.user.id, orgId: session.orgId };
  const canWrite = session.can('inspection_checklist:write');
  const [localAnswers, setLocalAnswers] = useState<Record<string, AnswerValue> | null>(null);
  const [queuedNote, setQueuedNote] = useState('');

  const result = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'inspection', resultId),
    queryFn: () => api.get(`/v1/field-ops/inspection-results/${resultId}`, { schema: Result }),
  });
  const templates = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'templates'),
    queryFn: () => api.get('/v1/field-ops/checklist-templates', { schema: TemplateList }),
  });

  const template = (templates.data?.items ?? []).find((t) => t.id === result.data?.templateId);
  const answers: Record<string, AnswerValue> = useMemo(() => {
    if (localAnswers) return localAnswers;
    const map: Record<string, AnswerValue> = {};
    for (const a of result.data?.answers ?? []) map[a.key] = a.result;
    return map;
  }, [localAnswers, result.data]);

  const items = template?.items ?? [];
  const answered = items.filter((i) => answers[i.key]).length;
  const completed = result.data?.status === 'completed';

  const save = useMutation({
    mutationFn: async (next: { answers: Record<string, AnswerValue>; complete: boolean }) => {
      const payload = Object.entries(next.answers).map(([key, value]) => ({ key, result: value }));
      const body = { answers: payload, complete: next.complete };
      const path = `/v1/field-ops/inspection-results/${resultId}`;
      return submitOrQueue({
        scope,
        kind: next.complete ? 'inspection_complete' : 'inspection_answers',
        label: next.complete ? L.complete : L.save,
        method: 'PATCH',
        path,
        body,
        send: (idempotencyKey) => api.patch(path, body, { schema: Result, idempotencyKey }),
      });
    },
    onSuccess: (r) => {
      setQueuedNote(r.queued ? L.queuedNote : '');
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field') });
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field-inspections') });
    },
  });

  function tap(key: string, value: AnswerValue) {
    const next = { ...answers, [key]: value };
    setLocalAnswers(next);
    save.mutate({ answers: next, complete: false });
  }

  if (result.error) return <ErrorNotice error={result.error} />;
  if (!result.data || !template) return <p className="web-muted">…</p>;

  return (
    <div>
      <p>
        <strong>{template.name}</strong> — {answered}/{items.length}
        {completed ? ` · ${L.completed}` : ` · ${L.inProgress}`}
      </p>
      <div
        role="progressbar"
        aria-valuenow={answered}
        aria-valuemax={items.length}
        aria-label={template.name}
        style={{ height: 8, background: 'var(--fl-surface-muted, #eee)', borderRadius: 4 }}
      >
        <div
          style={{
            height: '100%',
            width: items.length ? `${(answered / items.length) * 100}%` : '0%',
            background: 'var(--fl-accent, #2563eb)',
            borderRadius: 4,
          }}
        />
      </div>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
        {items.map((item) => (
          <li key={item.key} className="web-card" style={{ padding: 12 }}>
            <p style={{ margin: '0 0 8px' }}>
              {item.label}
              {item.required ? ' *' : ''}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['pass', 'fail', 'na'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={answers[item.key] === value ? 'cc-btn cc-btn--primary' : 'cc-btn'}
                  style={{ minHeight: 48, flex: 1 }}
                  aria-pressed={answers[item.key] === value}
                  disabled={!canWrite || completed || save.isPending}
                  onClick={() => tap(item.key, value)}
                >
                  {value === 'pass' ? L.pass : value === 'fail' ? L.fail : L.na}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {canWrite && !completed ? (
        <>
          <PhotoCapture
            ownerType="inspection_result"
            ownerId={resultId}
            attachToInspectionResultId={resultId}
            lang={lang}
            onUploaded={() =>
              void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field') })
            }
          />
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            style={{ minHeight: 52, width: '100%' }}
            disabled={save.isPending}
            onClick={() => save.mutate({ answers, complete: true })}
          >
            {L.complete}
          </button>
        </>
      ) : null}
      {queuedNote ? (
        <p className="web-muted" role="status">
          {queuedNote}
        </p>
      ) : null}
      {save.error ? (
        <p className="web-error" role="alert">
          {errorHint(save.error)}
        </p>
      ) : null}
    </div>
  );
}
