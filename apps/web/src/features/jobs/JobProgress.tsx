// Stage tracker shared by the contractor's job panel and the customer's status page.
import { CUSTOMER_STAGES, stageIndex } from './customerStatus';

export function JobProgress({ stage, compact = false }: { stage: string; compact?: boolean }) {
  const current = stageIndex(stage);
  const done = stage === 'completed';
  return (
    <ol
      className={`js-progress${compact ? ' js-progress--compact' : ''}`}
      aria-label={`Job progress: step ${current + 1} of ${CUSTOMER_STAGES.length}, ${CUSTOMER_STAGES[current]!.label}`}
    >
      {CUSTOMER_STAGES.map((s, i) => {
        const state = i < current || done ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={s.key}
            className={`js-progress__step js-progress__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="js-progress__dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="js-progress__label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
