'use client';

// Estimate templates: write the budget lines, schedule tasks, and client questions
// once, then apply them to any job in one pass. Amounts are yours — an unpriced line
// stays unpriced (skipped and counted at apply time), and a cost code already on the
// job is never overwritten.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, parseDollarsToMinor, prettyStatus } from '../builderOps/shared';

const BudgetLine = z.object({
  costCode: z.string(),
  label: z.string(),
  budgetMinor: z.number().nullable(),
});
const ScheduleTask = z.object({
  title: z.string(),
  startOffsetDays: z.number(),
  durationDays: z.number(),
});
const Question = z.object({
  key: z.string(),
  prompt: z.string(),
  kind: z.enum(['text', 'choice', 'yes_no']),
  choices: z.array(z.string()).optional(),
});
const Template = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  budgetLines: z.array(BudgetLine),
  scheduleTasks: z.array(ScheduleTask),
  questionnaire: z.array(Question),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const TemplateList = z.object({ items: z.array(Template) });
const ApplyResult = z.object({
  templateId: z.string(),
  jobId: z.string(),
  budgetLinesCreated: z.number(),
  budgetLinesSkipped: z.number(),
  scheduleTasksCreated: z.number(),
  questionnaireId: z.string().nullable(),
});
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });
const Questionnaire = z.object({
  id: z.string(),
  jobId: z.string(),
  templateId: z.string().nullable(),
  title: z.string(),
  questions: z.array(Question),
  answers: z.array(z.object({ key: z.string(), value: z.string().nullable() })),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const QuestionnaireListResponse = z.object({ items: z.array(Questionnaire) });

type TemplateT = z.infer<typeof Template>;

export function TemplatesView() {
  return (
    <RouteGate routeId="estimateTemplates">
      <TemplatesContent />
    </RouteGate>
  );
}

function TemplatesContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.can('estimate:write');
  const [error, setError] = useState('');
  const [applyResult, setApplyResult] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'templates', 'list'),
    queryFn: () => api.get('/v1/estimate-templates', { schema: TemplateList }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'templates', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'templates') });
  };
  const fail = (e: unknown) => setError(errorHint(e));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post('/v1/estimate-templates', body, { schema: Template }),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: fail,
  });
  const apply = useMutation({
    mutationFn: (input: { templateId: string; jobId: string; startDate: string }) =>
      api.post(
        `/v1/estimate-templates/${input.templateId}/apply`,
        { jobId: input.jobId, startDate: input.startDate },
        { schema: ApplyResult },
      ),
    onSuccess: (r) => {
      setError('');
      setApplyResult(
        `Applied: ${r.budgetLinesCreated} budget lines created (${r.budgetLinesSkipped} skipped), ` +
          `${r.scheduleTasksCreated} schedule tasks created` +
          (r.questionnaireId ? ', questionnaire created.' : '.'),
      );
      invalidate();
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'job-cost') });
    },
    onError: fail,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [linesText, setLinesText] = useState('');
  const [tasksText, setTasksText] = useState('');
  const [questionsText, setQuestionsText] = useState('');
  const [applyJob, setApplyJob] = useState('');
  const [applyDate, setApplyDate] = useState(new Date().toISOString().slice(0, 10));
  const [applyTemplate, setApplyTemplate] = useState('');
  const [questionnaireJob, setQuestionnaireJob] = useState('');

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const budgetLines = linesText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [costCode = '', label = '', amount = ''] = l.split('|').map((s) => s.trim());
        return { costCode, label: label || costCode, budgetMinor: parseDollarsToMinor(amount) };
      })
      .filter((l) => l.costCode);
    const scheduleTasks = tasksText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [title = '', offset = '0', duration = '1'] = l.split('|').map((s) => s.trim());
        return {
          title,
          startOffsetDays: Math.max(0, Number.parseInt(offset, 10) || 0),
          durationDays: Math.max(1, Number.parseInt(duration, 10) || 1),
        };
      })
      .filter((t) => t.title);
    const questionnaire = questionsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((prompt, i) => ({ key: `q${i + 1}`, prompt, kind: 'text' as const }));
    create.mutate({
      name: name.trim(),
      description: description.trim() || null,
      budgetLines,
      scheduleTasks,
      questionnaire,
    });
    setName('');
    setDescription('');
    setLinesText('');
    setTasksText('');
    setQuestionsText('');
  }

  return (
    <main>
      <PageHeader title="Estimate Templates" />
      <p className="web-muted">
        Applying a template copies your budget lines, schedule tasks, and client questions
        onto a job. Unpriced lines and cost codes already on the job are skipped and counted.
      </p>
      {error ? (
        <p className="web-error" role="alert">
          {error}
        </p>
      ) : null}
      {applyResult ? (
        <p className="web-muted" role="status">
          {applyResult}
        </p>
      ) : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}

      {canWrite ? (
        <form className="web-card" onSubmit={onCreate}>
          <h2>New template</h2>
          <label>
            Name
            <input className="fl-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Description
            <input className="fl-input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Budget lines (one per line: cost code | label | amount $ — leave amount blank for unpriced)
            <textarea className="fl-input" rows={5} value={linesText} onChange={(e) => setLinesText(e.target.value)} />
          </label>
          <label>
            Schedule tasks (one per line: title | start offset days | duration days)
            <textarea className="fl-input" rows={4} value={tasksText} onChange={(e) => setTasksText(e.target.value)} />
          </label>
          <label>
            Client questions (one per line)
            <textarea className="fl-input" rows={4} value={questionsText} onChange={(e) => setQuestionsText(e.target.value)} />
          </label>
          <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
            Create template
          </button>
        </form>
      ) : null}

      <section className="web-card" aria-label="Templates">
        <h2>Templates</h2>
        {(list.data?.items ?? []).length === 0 && !list.isLoading ? (
          <p className="web-muted">No templates yet.</p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {(list.data?.items ?? []).map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </ul>
      </section>

      {canWrite ? (
        <section className="web-card" aria-label="Apply a template">
          <h2>Apply to a job</h2>
          <label>
            Template
            <select className="fl-input" value={applyTemplate} onChange={(e) => setApplyTemplate(e.target.value)}>
              <option value="">Pick a template…</option>
              {(list.data?.items ?? [])
                .filter((t) => t.active)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Job
            <select className="fl-input" value={applyJob} onChange={(e) => setApplyJob(e.target.value)}>
              <option value="">Pick a job…</option>
              {(jobs.data?.items ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number} — {j.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Schedule start date
            <input className="fl-input" type="date" value={applyDate} onChange={(e) => setApplyDate(e.target.value)} />
          </label>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={apply.isPending || !applyTemplate || !applyJob || !applyDate}
            onClick={() => apply.mutate({ templateId: applyTemplate, jobId: applyJob, startDate: applyDate })}
          >
            Apply template
          </button>
        </section>
      ) : null}

      <section className="web-card" aria-label="Job questionnaires">
        <h2>Job questionnaires</h2>
        <label>
          Job
          <select className="fl-input" value={questionnaireJob} onChange={(e) => setQuestionnaireJob(e.target.value)}>
            <option value="">Pick a job…</option>
            {(jobs.data?.items ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.number} — {j.title}
              </option>
            ))}
          </select>
        </label>
        {questionnaireJob ? (
          <QuestionnaireList jobId={questionnaireJob} canWrite={canWrite} onError={fail} />
        ) : null}
      </section>
    </main>
  );
}

function TemplateCard({ template }: { template: TemplateT }) {
  const total = template.budgetLines.reduce((s, l) => s + (l.budgetMinor ?? 0), 0);
  const unpriced = template.budgetLines.filter((l) => l.budgetMinor === null).length;
  return (
    <li className="web-card" style={{ padding: 12 }}>
      <p style={{ margin: '0 0 4px' }}>
        <strong>{template.name}</strong>
        {template.active ? '' : ' (inactive)'}
      </p>
      {template.description ? <p className="web-muted">{template.description}</p> : null}
      <p className="web-muted" style={{ margin: 0 }}>
        {template.budgetLines.length} budget lines ({money(total)} priced
        {unpriced ? `, ${unpriced} unpriced` : ''}) · {template.scheduleTasks.length} schedule
        tasks · {template.questionnaire.length} questions
      </p>
    </li>
  );
}

function QuestionnaireList({
  jobId,
  canWrite,
  onError,
}: {
  jobId: string;
  canWrite: boolean;
  onError: (e: unknown) => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: orgKey(session.orgId, 'templates', 'questionnaires', jobId),
    queryFn: () => api.get(`/v1/jobs/${jobId}/questionnaires`, { schema: QuestionnaireListResponse }),
  });
  const save = useMutation({
    mutationFn: (input: { id: string; answers: { key: string; value: string | null }[] }) =>
      api.patch(`/v1/questionnaires/${input.id}/answers`, { answers: input.answers }, { schema: Questionnaire }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'templates', 'questionnaires', jobId) }),
    onError,
  });
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});

  if (list.error) return <ErrorNotice error={list.error} />;
  if ((list.data?.items ?? []).length === 0 && !list.isLoading) {
    return <p className="web-muted">No questionnaires for this job yet — apply a template with questions.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {(list.data?.items ?? []).map((q) => {
        const draft = drafts[q.id] ?? Object.fromEntries(q.answers.map((a) => [a.key, a.value ?? '']));
        return (
          <article key={q.id} className="web-card" style={{ padding: 12 }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{q.title}</strong> · {prettyStatus(q.status)}
            </p>
            {q.questions.map((question) => (
              <label key={question.key} style={{ display: 'block' }}>
                {question.prompt}
                {question.kind === 'yes_no' ? (
                  <select
                    className="fl-input"
                    value={draft[question.key] ?? ''}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [q.id]: { ...draft, [question.key]: e.target.value } })
                    }
                  >
                    <option value="">—</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                ) : question.kind === 'choice' && question.choices?.length ? (
                  <select
                    className="fl-input"
                    value={draft[question.key] ?? ''}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [q.id]: { ...draft, [question.key]: e.target.value } })
                    }
                  >
                    <option value="">—</option>
                    {question.choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="fl-input"
                    value={draft[question.key] ?? ''}
                    disabled={!canWrite}
                    onChange={(e) =>
                      setDrafts({ ...drafts, [q.id]: { ...draft, [question.key]: e.target.value } })
                    }
                  />
                )}
              </label>
            ))}
            {canWrite ? (
              <button
                type="button"
                className="cc-btn cc-btn--primary"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    id: q.id,
                    answers: q.questions.map((question) => {
                      const value = draft[question.key];
                      return { key: question.key, value: value?.trim() ? value : null };
                    }),
                  })
                }
              >
                Save answers
              </button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
