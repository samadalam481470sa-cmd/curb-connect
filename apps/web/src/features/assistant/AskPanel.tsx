'use client';

// Ask Field Pro, embedded inside a tool (Phase F item 28). Compact version of the /ask page:
// the mode and context are fixed by the host tool, answers come from the home AI server or the
// backup model, and when no AI is reachable the panel searches the built-in help topics instead
// of inventing an answer.
import type { AssistantAskResponse, AssistantMode } from '@fieldline/contracts';
import { Button } from '@fieldline/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../components/common';
import { orgKey, useApi, useSession } from '../../lib/session';

export interface AskPanelProps {
  mode: AssistantMode;
  /** Route id of the host tool, used to rank help topics (e.g. 'build', 'roof', 'search'). */
  tool: string;
  /** What the reader is looking at, sent to the model as context. Plain text, no secrets. */
  context: string;
  title?: string;
  placeholder?: string;
}

export function AskPanel({ mode, tool, context, title = 'Ask Field Pro', placeholder }: AskPanelProps) {
  const { endpoints } = useApi();
  const session = useSession();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAskResponse | null>(null);
  const [helpQuery, setHelpQuery] = useState('');

  const status = useQuery({
    queryKey: orgKey(session.orgId, 'assistant', 'status'),
    queryFn: ({ signal }) => endpoints.assistantStatus(signal),
    refetchInterval: 60_000,
    retry: false,
  });

  const help = useQuery({
    queryKey: orgKey(session.orgId, 'assistant', 'help', tool, helpQuery),
    queryFn: ({ signal }) => endpoints.assistantHelp(helpQuery, tool, signal),
    retry: false,
  });

  const ask = useMutation({
    mutationFn: (text: string) =>
      endpoints.assistantAsk({ question: text, mode, history: [], context }),
    onSuccess: (data) => setAnswer(data),
  });

  const aiAvailable = status.data?.available === true;
  const topics = help.data?.topics ?? [];

  function submit() {
    const text = question.trim();
    if (text.length < 2 || ask.isPending) return;
    setAnswer(null);
    ask.mutate(text);
  }

  return (
    <section className="web-section" aria-label={title}>
      <h2>{title}</h2>
      <p className="web-muted web-small" role="status">
        {status.isPending
          ? 'Checking the AI server...'
          : aiAvailable
            ? 'AI help for this tool. AI can be wrong — check prices, codes and safety items.'
            : 'No AI is connected right now, so here are the built-in help topics for this tool.'}
      </p>

      {aiAvailable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: 'grid', gap: 12 }}
        >
          <label htmlFor={`ask-panel-${tool}`}>Your question</label>
          <textarea
            id={`ask-panel-${tool}`}
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
            <Button type="submit" disabled={ask.isPending || question.trim().length < 2}>
              Ask
            </Button>
          </div>
        </form>
      )}
      {ask.isPending && <p className="web-muted">Thinking...</p>}
      {answer && (
        <div aria-live="polite">
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>
          <p className="web-muted web-small">
            {answer.source === 'home_server' ? 'Home server' : 'Backup model'} · {answer.model}
            {answer.professionalAdvised
              ? ' · Confirm this with a licensed professional or your building office.'
              : ''}
          </p>
        </div>
      )}
      {ask.error && <ErrorNotice error={ask.error} title="The AI did not answer" />}

      <div style={{ marginTop: 12 }}>
        <label htmlFor={`ask-help-${tool}`}>Search help topics</label>
        <input
          id={`ask-help-${tool}`}
          type="search"
          value={helpQuery}
          maxLength={200}
          placeholder="e.g. trial, invoice email, permit"
          onChange={(e) => setHelpQuery(e.target.value)}
          style={{ display: 'block', width: '100%', marginTop: 4 }}
        />
        {topics.length > 0 ? (
          <dl style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            {topics.map((t) => (
              <div key={t.id}>
                <dt>
                  <strong>{t.title}</strong>
                </dt>
                <dd style={{ margin: '2px 0 0' }}>{t.body}</dd>
              </div>
            ))}
          </dl>
        ) : (
          !help.isPending && (
            <p className="web-muted web-small">
              No help topic matches that yet. Try different words, or open Ask Field Pro for the
              full assistant.
            </p>
          )
        )}
      </div>
    </section>
  );
}
