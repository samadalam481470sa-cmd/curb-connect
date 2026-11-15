'use client';

// New roof order (RF-021, RF-022, RR-039, COS-201..COS-203, ADD-020..ADD-023): 1) address search +
// property confirmation, 2) structures in scope, 3) DIY trace vs assisted measurement with an honest
// SLA and credit preview, 4) submit with one Idempotency-Key per attempt (a double tap returns the
// same order). Assisted orders reserve one report credit at submit; DIY uses none.
import type { RoofDeliverySpeed, RoofOrderMode } from '@fieldline/contracts';
import { Button, Checkbox, Field, Stepper, TextInput, useToast } from '@fieldline/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { newIdempotencyKey } from '../../lib/api';
import { useApi } from '../../lib/session';
import { ErrorNotice, PageHeader } from '../common';
import { AddressSearch, PropertyConfirm, type PropertyDetail } from '../property';
import { roofEndpoints, type RoofApi } from './roofApi';
import styles from './roof.module.css';

type Candidate = Parameters<Parameters<typeof AddressSearch>[0]['onSelect']>[0];
type Step = 'property' | 'structures' | 'mode' | 'confirm';
const STEPS: readonly Step[] = ['property', 'structures', 'mode', 'confirm'];
const STEP_LABEL: Record<Step, string> = { property: 'Property', structures: 'Structures', mode: 'Measurement', confirm: 'Review & order' };

export interface ModeOption {
  mode: RoofOrderMode;
  speed: RoofDeliverySpeed;
  title: string;
  sla: string;
  credits: number;
}

/** RR-039: SLA text is a target, never a guarantee; multi-structure orders take longer. */
export function modeOptions(structureCount: number): ModeOption[] {
  const extra = structureCount > 1 ? ' Several structures extend the target.' : '';
  return [
    { mode: 'diy', speed: 'instant_diy', title: 'Trace it yourself (DIY)', sla: 'Starts now. You trace facets and pitches; no delivery time applies and nothing is guaranteed.', credits: 0 },
    { mode: 'assisted', speed: 'standard', title: 'Assisted measurement', sla: `A reviewer measures it during business hours. The target is not guaranteed and pauses while imagery or a clarification is pending.${extra}`, credits: 1 },
    { mode: 'assisted', speed: 'priority', title: 'Assisted, priority', sla: `Shorter business-hours target, still not guaranteed; same pauses.${extra}`, credits: 1 },
  ];
}

export function OrderWizard({ apiOverride }: { apiOverride?: RoofApi }) {
  const { api } = useApi();
  const roof = roofEndpoints(apiOverride ?? api);
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<Step>('property');
  const [candidate, setCandidate] = useState<{ c: Candidate; q: string } | null>(null);
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef(newIdempotencyKey());

  const inScope = property?.structures.filter((s) => s.scopeStatus !== 'excluded') ?? [];
  const options = modeOptions(selected.length);
  const opt = choice === null ? null : options[choice];
  const idx = STEPS.indexOf(step);

  const submit = async () => {
    if (!property || !opt) return;
    setBusy(true);
    setError(null);
    try {
      const order = await roof.createOrder(
        {
          propertyId: property.id,
          mode: opt.mode,
          deliverySpeed: opt.speed,
          structureIds: selected,
          ...(instructions && { instructions }),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        key.current,
      );
      toast.show({ message: `Roof order ${order.number} placed`, tone: 'success' });
      router.push(`/roof/orders/${order.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="New roof order" description="Confirm the property and the structures in scope, then choose how the roof is measured." />
      <Stepper label="New roof order steps" steps={STEPS.map((s, i) => ({ id: s, label: STEP_LABEL[s], state: i < idx ? 'complete' : i === idx ? 'current' : 'upcoming' }))} />
      {step === 'property' && (
        <div className={styles.stack}>
          {!candidate && <AddressSearch api={apiOverride ?? api} onSelect={(c, q) => setCandidate({ c, q })} />}
          {candidate && !property && (
            <PropertyConfirm
              api={apiOverride ?? api}
              query={candidate.q}
              candidate={candidate.c}
              onConfirmed={(p) => {
                setProperty(p);
                setSelected(p.structures.filter((s) => s.scopeStatus === 'included').map((s) => s.id));
                setStep('structures');
              }}
            />
          )}
          {candidate && (
            <div className={styles.row}>
              <Button variant="ghost" onClick={() => setCandidate(null)}>
                Search again
              </Button>
            </div>
          )}
        </div>
      )}
      {step === 'structures' && property && (
        <fieldset className={styles.stack}>
          <legend>Which structures should be measured?</legend>
          {inScope.length === 0 && <p>No structure is in scope. Go back and mark at least one structure in scope.</p>}
          {inScope.map((s) => (
            <Checkbox
              key={s.id}
              label={`${s.label} (${s.kind.replace(/_/g, ' ')})`}
              hint={s.scopeStatus === 'unmeasured' ? 'In scope but marked as not measurable yet; it will show as unmeasured.' : undefined}
              checked={selected.includes(s.id)}
              onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))}
            />
          ))}
          <div className={styles.row}>
            <Button variant="ghost" onClick={() => { setProperty(null); setStep('property'); }}>
              Back
            </Button>
            <Button disabled={selected.length === 0} onClick={() => setStep('mode')}>
              Continue
            </Button>
          </div>
        </fieldset>
      )}
      {step === 'mode' && (
        <fieldset className={styles.stack}>
          <legend>How should the roof be measured?</legend>
          <div className={styles.choices}>
            {options.map((o, i) => (
              <label key={o.speed} className={styles.choice} data-selected={choice === i || undefined}>
                <span>
                  <input type="radio" name="mode" checked={choice === i} onChange={() => setChoice(i)} /> <strong>{o.title}</strong>
                </span>
                <span className={styles.muted}>{o.sla}</span>
                <span>{o.credits === 0 ? 'No report credit used.' : 'Uses 1 report credit: reserved when you order, used when the report is approved, returned if the order fails or is cancelled.'}</span>
              </label>
            ))}
          </div>
          <Field label="Notes for the measurer (optional)">
            <TextInput value={instructions} maxLength={4000} onChange={(e) => setInstructions(e.target.value)} />
          </Field>
          <div className={styles.row}>
            <Button variant="ghost" onClick={() => setStep('structures')}>
              Back
            </Button>
            <Button disabled={choice === null} onClick={() => setStep('confirm')}>
              Continue
            </Button>
          </div>
        </fieldset>
      )}
      {step === 'confirm' && property && opt && (
        <section className={styles.stack} aria-labelledby="roof-confirm-h">
          <h2 id="roof-confirm-h">Review your order</h2>
          <dl className={styles.kv}>
            <dt>Property</dt>
            <dd>{property.normalizedAddress ?? property.id}</dd>
            <dt>Structures</dt>
            <dd>{property.structures.filter((s) => selected.includes(s.id)).map((s) => s.label).join(', ')}</dd>
            <dt>Measurement</dt>
            <dd>{opt.title}</dd>
            <dt>Delivery</dt>
            <dd>{opt.sla}</dd>
            <dt>Credits</dt>
            <dd data-testid="credit-preview">{opt.credits === 0 ? 'None' : '1 report credit (reserved now)'}</dd>
          </dl>
          {error !== null && <ErrorNotice error={error} title="The order was not placed" />}
          <div className={styles.row}>
            <Button variant="ghost" onClick={() => setStep('mode')}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              Place order
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
