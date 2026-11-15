'use client';

// CV-042 typed intake with explicit Unknown. Early questions (permit, engineer, ownership, risk)
// come first and must each be answered, Unknown allowed, before any price is requested. Each
// answer autosaves as a CurbObservationsAnswered command. Unknown is never sent as false.
import { CURB_INTAKE_QUESTIONS, type CurbObservationAnswer, type IntakeQuestion } from '@fieldline/contracts';
import { Button, Field, RadioGroup, TextInput } from '@fieldline/ui';
import { useState } from 'react';
import { answerText, earlyQuestionsAnswered } from './model';
import { useCurbProject } from './useCurbProject';

const UNKNOWN = '__unknown__';

export function toAnswer(q: IntakeQuestion, raw: string): CurbObservationAnswer {
  if (raw === UNKNOWN) return { state: 'unknown', reason: 'not_provided' };
  if (q.type === 'boolean') return { state: 'known', value: raw === 'yes', source: 'user_entered', evidence_source: 'customer_answer' };
  if (q.type === 'number') {
    const n = Number(raw);
    return { state: 'known', value: n, ...(q.unit && { unit: q.unit }), source: 'user_entered', evidence_source: 'customer_answer' };
  }
  return { state: 'known', value: raw, source: 'user_entered', evidence_source: 'customer_answer' };
}

function currentRaw(q: IntakeQuestion, answer: { state: string; value?: unknown } | undefined): string | null {
  if (!answer) return null;
  if (answer.state !== 'known') return UNKNOWN;
  if (q.type === 'boolean') return answer.value ? 'yes' : 'no';
  return String(answer.value);
}

export function IntakeForm({ only }: { only?: 'early' | 'all' }) {
  const { detail, run } = useCurbProject();
  const answers = new Map((detail?.observations ?? []).map((o) => [o.questionKey, o.answer as { state: string; value?: unknown }]));
  const questions = [...CURB_INTAKE_QUESTIONS].filter((q) => only !== 'early' || q.early).sort((a, b) => Number(b.early) - Number(a.early));
  const gate = earlyQuestionsAnswered(detail?.observations ?? []);

  const answer = (q: IntakeQuestion, raw: string) =>
    run('CurbObservationsAnswered', { answers: [{ question_key: q.key, answer: toAnswer(q, raw), media_asset_ids: [] }] });

  return (
    <div className="curb-intake">
      <p className={gate.done ? 'curb-ok' : 'curb-warn'} role="status">
        {gate.done
          ? 'Permit, ownership and risk questions answered. Unknown answers stay open as risks.'
          : `Answer ${gate.missing.length} permit / ownership / risk question(s) before any price. "Unknown" is a valid answer.`}
      </p>
      {questions.map((q) => (
        <QuestionRow key={q.key} q={q} raw={currentRaw(q, answers.get(q.key))} onAnswer={(raw) => void answer(q, raw)} />
      ))}
    </div>
  );
}

function QuestionRow({ q, raw, onAnswer }: { q: IntakeQuestion; raw: string | null; onAnswer: (raw: string) => void }) {
  const [text, setText] = useState(raw && raw !== UNKNOWN ? raw : '');
  const legend = (
    <>
      {q.label} {q.early && <span className="curb-tag">Before price</span>}
    </>
  );
  if (q.type === 'boolean' || q.type === 'choice') {
    const options =
      q.type === 'boolean'
        ? [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]
        : (q.choices ?? []).map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }));
    return (
      <div className="curb-question" data-early={q.early || undefined}>
        <RadioGroup legend={legend} hint={q.help} orientation="horizontal" value={raw} onChange={onAnswer} options={[...options, { value: UNKNOWN, label: 'Unknown' }]} />
      </div>
    );
  }
  return (
    <div className="curb-question">
      <Field label={legend} hint={`${q.help}${raw ? ` Current: ${raw === UNKNOWN ? 'Unknown' : answerText({ state: 'known', value: raw } as never)}` : ''}`}>
        <TextInput value={text} inputMode={q.type === 'number' ? 'decimal' : 'text'} suffix={q.unit} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="curb-row">
        <Button size="sm" disabled={!text || (q.type === 'number' && !Number.isFinite(Number(text)))} onClick={() => onAnswer(text)}>
          Save answer
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAnswer(UNKNOWN)}>
          Unknown
        </Button>
      </div>
    </div>
  );
}
