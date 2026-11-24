'use client';

// Ask Field Pro: AI answers for general questions, home-build help and search help. Answers come
// from the always-on home AI server, with a backup model. Nothing here is cached by the service
// worker, and a chat lives only in this page's memory.
import type { AssistantAskResponse, AssistantMode } from '@fieldline/contracts';
import { Button } from '@fieldline/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';

const MODES: { id: AssistantMode; label: string; hint: string }[] = [
  { id: 'general', label: 'Any question', hint: 'Ask anything about work, trades or business.' },
  {
    id: 'home_build',
    label: 'Home build help',
    hint: 'Steps, order of trades, what to ask a builder.',
  },
  {
    id: 'search_help',
    label: 'Find it',
    hint: 'Where something lives in Field Pro and what to look up.',
  },
  {
    id: 'estimate_review',
    label: 'Estimate review',
    hint: 'Sanity-check quantities, waste and easy-to-miss lines. Paste your lines for a closer look.',
  },
];

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  meta?: AssistantAskResponse;
}

export function AssistantView() {
  return (
    <RouteGate routeId="assistant">
      <AssistantContent />
    </RouteGate>
  );
}

function AssistantContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const [mode, setMode] = useState<AssistantMode>('general');
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const status = useQuery({
    queryKey: orgKey(session.orgId, 'assistant', 'status'),
    queryFn: ({ signal }) => endpoints.assistantStatus(signal),
    refetchInterval: 60_000,
    retry: false,
  });

  // Built-in help topics (item 28): shown when no AI is reachable, so the page still helps
  // without inventing answers.
  const [helpQuery, setHelpQuery] = useState('');
  const help = useQuery({
    queryKey: orgKey(session.orgId, 'assistant', 'help', 'assistant', helpQuery),
    queryFn: ({ signal }) => endpoints.assistantHelp(helpQuery, undefined, signal),
    retry: false,
  });

  const ask = useMutation({
    mutationFn: (input: { question: string; history: Turn[] }) =>
      endpoints.assistantAsk({
        question: input.question,
        mode,
        history: input.history.map(({ role, content }) => ({ role, content })),
      }),
    onSuccess: (data) => {
      setTurns((prev) => [...prev, { role: 'assistant', content: data.answer, meta: data }]);
      queueMicrotask(() => endRef.current?.scrollIntoView({ block: 'end' }));
    },
  });

  function submit() {
    const text = question.trim();
    if (text.length < 2 || ask.isPending) return;
    const history = turns;
    setTurns([...history, { role: 'user', content: text }]);
    setQuestion('');
    ask.mutate({ question: text, history });
  }

  const home = status.data?.homeServer;
  const statusText = status.isPending
    ? 'Checking the AI server...'
    : status.error
      ? 'AI status unknown.'
      : !status.data.available
        ? 'No AI is reachable right now. Start the home server, or set a backup model.'
        : home === 'online'
          ? 'Home AI server is online.'
          : 'Home AI server is off. The backup model will answer.';

  return (
    <>
      <PageHeader
        title="Ask Field Pro"
        description="Ask about jobs, trades, building a home, or where to find things. AI can be wrong, so check prices, codes and anything about safety."
      />
      <div className="web-section">
        <div
          role="radiogroup"
          aria-label="Kind of help"
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          {MODES.map((m) => (
            <Button
              key={m.id}
              role="radio"
              aria-checked={mode === m.id}
              variant={mode === m.id ? 'primary' : 'secondary'}
              onClick={() => setMode(m.id)}
              title={m.hint}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <p className="web-muted web-small" role="status">
          {statusText}
        </p>

        <div
          aria-live="polite"
          aria-label="Conversation"
          style={{ display: 'grid', gap: 12, margin: '12px 0' }}
        >
          {turns.length === 0 && (
            <p className="web-muted">{MODES.find((m) => m.id === mode)?.hint}</p>
          )}
          {turns.map((t, i) => (
            <div key={i}>
              <strong>{t.role === 'user' ? 'You' : 'Field Pro'}</strong>
              <p style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{t.content}</p>
              {t.meta && (
                <p className="web-muted web-small">
                  {t.meta.source === 'home_server' ? 'Home server' : 'Backup model'} ·{' '}
                  {t.meta.model}
                  {t.meta.professionalAdvised
                    ? ' · Confirm this with a licensed professional or your building office.'
                    : ''}
                </p>
              )}
            </div>
          ))}
          {ask.isPending && <p className="web-muted">Thinking...</p>}
          <div ref={endRef} />
        </div>

        {ask.error && (
          <ErrorNotice
            error={ask.error}
            title="The AI did not answer"
            onRetry={() => {
              const last = [...turns].reverse().find((t) => t.role === 'user');
              if (last) ask.mutate({ question: last.content, history: turns.slice(0, -1) });
            }}
          />
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          style={{ display: 'grid', gap: 12 }}
        >
          <label htmlFor="ask-question">Your question</label>
          <textarea
            id="ask-question"
            value={question}
            maxLength={2000}
            rows={3}
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
        {turns.length > 0 && (
          <p>
            <Button variant="secondary" onClick={() => setTurns([])}>
              New chat
            </Button>
          </p>
        )}

        {status.data && !status.data.available && (
          <div style={{ marginTop: 16 }}>
            <h2>Help topics</h2>
            <p className="web-muted web-small">
              No AI is connected right now. These built-in topics cover the common questions;
              nothing here is made up by a model.
            </p>
            <label htmlFor="ask-help-search">Search help topics</label>
            <input
              id="ask-help-search"
              type="search"
              value={helpQuery}
              maxLength={200}
              placeholder="e.g. trial, invoice email, permit"
              onChange={(e) => setHelpQuery(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4 }}
            />
            <dl style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {(help.data?.topics ?? []).map((t) => (
                <div key={t.id}>
                  <dt>
                    <strong>{t.title}</strong>
                  </dt>
                  <dd style={{ margin: '2px 0 0' }}>{t.body}</dd>
                </div>
              ))}
            </dl>
            {!help.isPending && (help.data?.topics.length ?? 0) === 0 && (
              <p className="web-muted web-small">No help topic matches that yet.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
