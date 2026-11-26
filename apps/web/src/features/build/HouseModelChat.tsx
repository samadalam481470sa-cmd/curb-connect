'use client';

// Ask about this house: plain-language questions about the model on screen (rooms, areas,
// schedule), answered by the connected AI from a summary of the current plan only. Read-only —
// it cannot change the house. When no AI is connected the API says so and this panel shows
// that honest state instead of inventing an answer.
import type { HouseModelChatResponse, HouseModelSummary } from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../components/common';
import { useApi } from '../../lib/session';
import { Panel } from '../command/Panel';
import type { HouseLayout, HouseProgram } from './layout';

export function houseModelSummary(layout: HouseLayout, program: HouseProgram): HouseModelSummary {
  return {
    lengthFt: layout.footprint.lengthFt,
    widthFt: layout.footprint.widthFt,
    stories: program.stories,
    bedrooms: program.bedrooms,
    bathrooms: program.bathrooms,
    garage: program.garage,
    conditionedAreaSqFt: layout.conditionedAreaSqFt,
    floors: layout.floors.map((floor) => ({
      level: floor.level,
      rooms: floor.rooms.map((room) => ({
        name: room.name,
        kind: room.kind,
        w: room.w,
        h: room.h,
        areaSqFt: Math.round(room.w * room.h),
      })),
    })),
  };
}

export function HouseModelChat({ layout, program }: { layout: HouseLayout; program: HouseProgram }) {
  const { endpoints } = useApi();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [answer, setAnswer] = useState<HouseModelChatResponse | null>(null);

  const ask = useMutation({
    mutationFn: (text: string) =>
      endpoints.houseModelChat({ question: text, history, model: houseModelSummary(layout, program) }),
    onSuccess: (data, text) => {
      setAnswer(data);
      setHistory((h) => [...h, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: data.answer }].slice(-8));
      setQuestion('');
    },
  });

  const submit = () => {
    const text = question.trim();
    if (text.length < 2 || ask.isPending) return;
    setAnswer(null);
    ask.mutate(text);
  };

  return (
    <Panel title="Ask about this house" id="house-model-chat">
      <p className="web-muted web-small" style={{ marginBottom: 9 }}>
        Ask about the rooms, areas or schedule of the house on screen. Answers come from the
        current plan only and cannot change it — use the program controls or the CAD plan editor
        to make changes. Needs the AI connected; without it this panel says so.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'grid', gap: 8 }}
      >
        <label htmlFor="house-model-question">Your question</label>
        <textarea
          id="house-model-question"
          value={question}
          maxLength={2000}
          rows={2}
          placeholder="e.g. Which room is the smallest? Is there a bath near the kitchen?"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <div>
          <button type="submit" className="cc-btn cc-btn--sm cc-btn--primary" disabled={ask.isPending || question.trim().length < 2}>
            Ask
          </button>
        </div>
      </form>
      {ask.isPending && <p className="web-muted">Thinking...</p>}
      {answer && (
        <div aria-live="polite" style={{ marginTop: 8 }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</p>
          <p className="web-muted web-small">
            {answer.source === 'home_server' ? 'Home server' : 'Backup model'} · {answer.model}
            {answer.professionalAdvised
              ? ' · Confirm this with a licensed professional or your building office.'
              : ''}
          </p>
        </div>
      )}
      {ask.error && <ErrorNotice error={ask.error} title="House-model chat is not available" />}
    </Panel>
  );
}
