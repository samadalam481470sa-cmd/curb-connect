'use client';

// Field inspections (builder operations): generic inspection checklists — define a
// template once, run it on any job, record pass/fail per item. Records of what was
// observed; an inspection is not a code compliance guarantee. Labels switch between
// English and Spanish for field crews.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, FIELD_LABELS, type UiLang } from './shared';

const TemplateItem = z.object({ key: z.string(), label: z.string(), required: z.boolean() });
const Template = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  items: z.array(TemplateItem),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const TemplateList = z.object({ items: z.array(Template) });
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
  status: z.string(),
  answers: z.array(Answer),
  photoMediaIds: z.array(z.string()),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ResultList = z.object({ items: z.array(Result) });
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });

export function FieldInspectionsView() {
  return (
    <RouteGate routeId="fieldInspections">
      <FieldInspectionsContent />
    </RouteGate>
  );
}

function FieldInspectionsContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('inspection_checklist:write');
  const [lang, setLang] = useState<UiLang>('en');
  const L = FIELD_LABELS[lang];
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const templates = useQuery({
    queryKey: orgKey(session.orgId, 'field-inspections', 'templates'),
    queryFn: () => api.get('/v1/field-ops/checklist-templates', { schema: TemplateList }),
  });
  const results = useQuery({
    queryKey: orgKey(session.orgId, 'field-inspections', 'results'),
    queryFn: () => api.get('/v1/field-ops/inspection-results', { schema: ResultList }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'field-inspections', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field-inspections') });

  const [templateName, setTemplateName] = useState('');
  const [templateItems, setTemplateItems] = useState('');
  const createTemplate = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/field-ops/checklist-templates',
        {
          name: templateName.trim(),
          items: templateItems
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((label, i) => ({ key: `item-${i + 1}`, label, required: true })),
        },
        { schema: Template },
      ),
    onSuccess: () => {
      setTemplateName('');
      setTemplateItems('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [startTemplateId, setStartTemplateId] = useState('');
  const [startJobId, setStartJobId] = useState('');
  const [inspectorName, setInspectorName] = useState('');
  const startResult = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/field-ops/inspection-results',
        {
          templateId: startTemplateId,
          jobId: startJobId || null,
          inspectorName: inspectorName.trim() || null,
        },
        { schema: Result },
      ),
    onSuccess: (r) => {
      setInspectorName('');
      setError('');
      setOpenId(r.id);
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateResult = useMutation({
    mutationFn: (input: { id: string; answers?: z.infer<typeof Answer>[]; complete?: boolean }) =>
      api.patch(
        `/v1/field-ops/inspection-results/${input.id}`,
        { answers: input.answers, complete: input.complete },
        { schema: Result },
      ),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitTemplate = (event: FormEvent) => {
    event.preventDefault();
    if (!templateName.trim() || templateItems.split('\n').filter((s) => s.trim()).length === 0) {
      setError(lang === 'es' ? 'Ingrese un nombre y al menos un elemento.' : 'Enter a name and at least one item.');
      return;
    }
    setError('');
    createTemplate.mutate();
  };

  const templateById = (id: string) => templates.data?.items.find((t) => t.id === id);
  const open = results.data?.items.find((r) => r.id === openId);
  const openTemplate = open ? templateById(open.templateId) : undefined;
  const answerFor = (result: z.infer<typeof Result>, key: string) =>
    result.answers.find((a) => a.key === key);

  return (
    <main className="cc-work-board">
      <PageHeader
        title={L.inspections}
        description={
          lang === 'es'
            ? 'Listas de verificación reutilizables para cualquier trabajo: registre aprobado, falló o N/A por elemento. Es un registro de lo observado, no una garantía de cumplimiento.'
            : 'Reusable checklists for any job: record pass, fail, or N/A per item. A record of what was observed, not a compliance guarantee.'
        }
        actions={
          <label>
            {L.language}
            <select value={lang} onChange={(e) => setLang(e.target.value as UiLang)}>
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </label>
        }
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      <section className="web-card" aria-labelledby="templates-title">
        <h2 id="templates-title">{L.templates}</h2>
        {canWrite && (
          <form className="cc-work-board__form" onSubmit={submitTemplate}>
            <label>{L.templateName}<input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={lang === 'es' ? 'ej. Inspección de estructura' : 'e.g. Framing inspection'} /></label>
            <label>{L.items}<textarea value={templateItems} onChange={(e) => setTemplateItems(e.target.value)} rows={5} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createTemplate.isPending}>{L.newTemplate}</button>
          </form>
        )}
        {templates.isError && <ErrorNotice error={templates.error} title="Could not load templates" />}
        {templates.data && templates.data.items.length === 0 && <p className="web-muted">{L.noTemplates}</p>}
        {templates.data?.items.map((t) => (
          <p key={t.id}>
            <strong>{t.name}</strong> — {t.items.length} {lang === 'es' ? 'elementos' : 'items'}: {t.items.map((i) => i.label).join('; ')}
          </p>
        ))}
      </section>

      {canWrite && (
        <section className="web-card" aria-labelledby="start-inspection-title">
          <h2 id="start-inspection-title">{L.startInspection}</h2>
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!startTemplateId) {
                setError(lang === 'es' ? 'Elija una plantilla.' : 'Pick a template.');
                return;
              }
              setError('');
              startResult.mutate();
            }}
          >
            <label>
              {L.templates}
              <select value={startTemplateId} onChange={(e) => setStartTemplateId(e.target.value)}>
                <option value="">—</option>
                {(templates.data?.items ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <label>
              {L.job}
              <select value={startJobId} onChange={(e) => setStartJobId(e.target.value)}>
                <option value="">—</option>
                {(jobs.data?.items ?? []).map((j) => (
                  <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                ))}
              </select>
            </label>
            <label>{L.inspectorName}<input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={startResult.isPending}>{L.startInspection}</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="results-title">
        <h2 id="results-title">{L.results}</h2>
        {results.isError && <ErrorNotice error={results.error} title="Could not load inspections" />}
        {results.data && results.data.items.length === 0 && <p className="web-muted">{L.noResults}</p>}
        {results.data?.items.map((r) => (
          <div key={r.id} className="cc-detail-row">
            <div>
              <strong>{templateById(r.templateId)?.name ?? (lang === 'es' ? 'Inspección' : 'Inspection')}</strong> — {r.status === 'completed' ? L.completed : L.inProgress}
              {r.inspectorName ? ` · ${r.inspectorName}` : ''} · {dateOnly(r.createdAt)} ·{' '}
              {r.answers.filter((a) => a.result === 'pass').length} {L.pass} / {r.answers.filter((a) => a.result === 'fail').length} {L.fail}
            </div>
            <button type="button" className="cc-btn" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              {openId === r.id ? (lang === 'es' ? 'Cerrar' : 'Close') : (lang === 'es' ? 'Abrir' : 'Open')}
            </button>
          </div>
        ))}
      </section>

      {open && openTemplate && (
        <section className="web-card" aria-labelledby="result-detail-title">
          <h2 id="result-detail-title">{openTemplate.name}</h2>
          {openTemplate.items.map((item) => {
            const answer = answerFor(open, item.key);
            return (
              <div key={item.key} className="cc-detail-row">
                <div>{item.label}</div>
                {canWrite && open.status !== 'completed' ? (
                  <div role="group" aria-label={item.label}>
                    {(['pass', 'fail', 'na'] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        className="cc-btn"
                        aria-pressed={answer?.result === v}
                        onClick={() =>
                          updateResult.mutate({
                            id: open.id,
                            answers: [
                              ...open.answers.filter((a) => a.key !== item.key),
                              { key: item.key, result: v },
                            ],
                          })
                        }
                      >
                        {v === 'pass' ? L.pass : v === 'fail' ? L.fail : L.na}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span>{answer?.result === 'pass' ? L.pass : answer?.result === 'fail' ? L.fail : answer?.result === 'na' ? L.na : '—'}</span>
                )}
              </div>
            );
          })}
          {canWrite && open.status !== 'completed' && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => updateResult.mutate({ id: open.id, complete: true })}
            >
              {L.complete}
            </button>
          )}
        </section>
      )}
    </main>
  );
}
