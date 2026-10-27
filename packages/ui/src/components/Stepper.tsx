import type { ReactNode } from 'react';
import { AlertIcon, CheckIcon, LockIcon } from '../icons';
import { cx } from '../internal/cx';
import { VisuallyHidden } from '../VisuallyHidden';

export type StepState = 'complete' | 'current' | 'upcoming' | 'blocked' | 'error';

export interface StepItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  state: StepState;
  /** Why a blocked step cannot start (e.g. "Utility locate not confirmed"). */
  blockedReason?: string;
  /** When given (and the step is not blocked), the step is a link. */
  href?: string;
}

export interface StepperProps {
  steps: readonly StepItem[];
  label: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

const STATE_TEXT: Record<StepState, string> = {
  complete: 'completed',
  current: 'current step',
  upcoming: 'not started',
  blocked: 'blocked',
  error: 'needs attention',
};

/** Ordered progress list. The current step carries `aria-current="step"`; state is spelled out. */
export function Stepper({ steps, label, orientation = 'horizontal', className }: StepperProps) {
  return (
    <nav aria-label={label} className={cx('fl-stepper', `fl-stepper--${orientation}`, className)}>
      <ol className="fl-stepper__list">
        {steps.map((step, index) => {
          const marker =
            step.state === 'complete' ? (
              <CheckIcon size={16} />
            ) : step.state === 'blocked' ? (
              <LockIcon size={16} />
            ) : step.state === 'error' ? (
              <AlertIcon size={16} />
            ) : (
              <span aria-hidden="true">{index + 1}</span>
            );
          const body = (
            <>
              <span className="fl-stepper__marker">{marker}</span>
              <span className="fl-stepper__text">
                <span className="fl-stepper__label">{step.label}</span>
                <VisuallyHidden>{`, ${STATE_TEXT[step.state]}`}</VisuallyHidden>
                {step.description && <span className="fl-stepper__desc">{step.description}</span>}
                {step.state === 'blocked' && step.blockedReason && (
                  <span className="fl-stepper__desc">{step.blockedReason}</span>
                )}
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              className={cx('fl-stepper__step', `fl-stepper__step--${step.state}`)}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              {step.href && step.state !== 'blocked' ? (
                <a className="fl-stepper__link" href={step.href}>
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
