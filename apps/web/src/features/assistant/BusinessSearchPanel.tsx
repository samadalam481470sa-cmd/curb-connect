'use client';

// AI Search over the company's own roofing business data (from the @colton.ai.dean
// "AI Agents for Roofing" reel: "how many have signed this month?"). Read-only: the
// endpoint only reads signed contracts, open roof quotes, funnel stages, jobs and
// invoices for this company, and every answer lists the tools and row counts it came
// from. When no AI is connected the answer is the direct counts from those records,
// labelled as such — never a made-up answer.
//
// The endpoint is called by its literal path here on purpose: the shared endpoints
// module is owned by another agent in this pass, so this panel does not touch it.
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@fieldline/ui';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';

/** Response shape of POST /v1/assistant/business-search, validated client-side. */
export const BusinessSearchResponseSchema = z.object({
  answer: z.string(),
  aiConnected: z.boolean(),
  source: z.enum(['home_server', 'backup_model', 'data_only']),
  model: z.string(),
  disclaimer: z.string(),
  sources: z.array(
    z.object({
      tool: z.string(),
      label: z.string(),
      rowCount: z.number(),
      summary: z.string(),
    }),
  ),
});

export type BusinessSearchResponse = z.infer<typeof BusinessSearchResponseSchema>;

export interface BusinessSearchPanelProps {
  /** Unique prefix for control ids, so two panels on one page never share an id. */
  idPrefix: string;
  title?: string;
  placeholder?: string;
}

export function BusinessSearchPanel({
  idPrefix,
  title = 'Roofing business search',
  placeholder = 'e.g. How many jobs signed this month?',
}: BusinessSearchPanelProps) {
  const { api } = useApi();
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<BusinessSearchResponse | null>(null);

  const search = useMutation({
    mutationFn: (text: string) =>
      api.post('/v1/assistant/business-search', { question: text }, {
        schema: BusinessSearchResponseSchema,
      }),
    onSuccess: (data) => setResult(data),
  });

  function submit() {
    const text = question.trim();
    if (text.length < 2 || search.isPending) return;
    setResult(null);
    search.mutate(text);
  }

  const inputId = `${idPrefix}-business-question`;

  return (
    <section className="web-section" aria-label={title}>
      <h2>{title}</h2>
      <p className="web-muted web-small">
        Ask about your own signed contracts, open roof quotes, funnel pipeline, jobs and
        invoices. Answers come only from your company&apos;s records — nothing is invented.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'grid', gap: 12 }}
      >
        <label htmlFor={inputId}>Roofing business question</label>
        <textarea
          id={inputId}
          value={question}
          maxLength={2000}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div>
          <Button type="submit" disabled={search.isPending || question.trim().length < 2}>
            Search my business data
          </Button>
        </div>
      </form>
      {search.isPending && <p className="web-muted">Searching your records...</p>}
      {result && (
        <div aria-live="polite">
          <p style={{ whiteSpace: 'pre-wrap' }}>{result.answer}</p>
          {!result.aiConnected && (
            <p className="web-muted web-small" role="status">
              AI not connected — these are direct counts from your records, not an AI summary.
              Connect the home AI server to get a written summary.
            </p>
          )}
          {result.aiConnected && result.source === 'data_only' && (
            <p className="web-muted web-small" role="status">
              The AI summary was unavailable, so this is the direct count from your records.
            </p>
          )}
          <p className="web-muted web-small">
            From your data:{' '}
            {result.sources.length === 0
              ? 'no records used'
              : result.sources
                  .map((s) => `${s.label} (${s.rowCount} row${s.rowCount === 1 ? '' : 's'})`)
                  .join(' · ')}
            {result.aiConnected && result.model
              ? ` · ${result.source === 'home_server' ? 'Home server' : 'Backup model'} · ${result.model}`
              : ''}
          </p>
          <ul className="web-muted web-small">
            {result.sources.map((s) => (
              <li key={s.tool}>
                <strong>{s.label}:</strong> {s.summary}
              </li>
            ))}
          </ul>
          <p className="web-muted web-small">{result.disclaimer}</p>
        </div>
      )}
      {search.error && <ErrorNotice error={search.error} title="Business search did not answer" />}
    </section>
  );
}
