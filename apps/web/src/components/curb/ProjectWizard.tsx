'use client';

// CV-041 / ADD-040 new curb project: 1) service taxonomy with original diagrams, 2) property
// (address search + confirmation, which sets jurisdiction), 3) create. The project then opens on
// the eligibility / permit questions, which gate every price (CV-042 B).
import { Button, Field, Stepper, TextInput, useToast } from '@fieldline/ui';
import type { CurbServiceCode } from '@fieldline/contracts';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ErrorNotice, PageHeader } from '../common';
import { AddressSearch, PropertyConfirm, type PropertyDetail } from '../property';
import { newIdempotencyKey } from '../../lib/api';
import { useApi } from '../../lib/session';
import { CURB_SERVICE_TAXONOMY } from './model';
import { ServiceDiagram } from './ServiceDiagram';
import { useCurbEndpoints } from './useCurbProject';

type Candidate = Parameters<Parameters<typeof AddressSearch>[0]['onSelect']>[0];

export function ProjectWizard() {
  const { api } = useApi();
  const curb = useCurbEndpoints();
  const router = useRouter();
  const toast = useToast();
  const [service, setService] = useState<CurbServiceCode | null>(null);
  const [step, setStep] = useState<'service' | 'property' | 'confirm'>('service');
  const [candidate, setCandidate] = useState<{ c: Candidate; q: string } | null>(null);
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());

  const create = async () => {
    if (!service || !property) return;
    setBusy(true);
    setError(null);
    try {
      const d = await curb.create({ propertyId: property.id, serviceCode: service, ...(description && { description }) }, key.current);
      toast.show({ message: `Project ${d.project.number} created`, tone: 'success' });
      router.push(`/curb/projects/${d.project.id}?tab=intake`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const order = ['service', 'property', 'confirm'] as const;
  const idx = order.indexOf(step);
  return (
    <>
      <PageHeader title="New curb project" description="Choose the work, confirm the property, then answer the permit and risk questions before any price." />
      <Stepper
        label="New curb project steps"
        steps={order.map((s, i) => ({ id: s, label: s === 'service' ? 'Service' : s === 'property' ? 'Property' : 'Create', state: i < idx ? 'complete' : i === idx ? 'current' : 'upcoming' }))}
      />
      {step === 'service' && (
        <fieldset className="curb-services">
          <legend>What work is this?</legend>
          {CURB_SERVICE_TAXONOMY.map((s) => (
            <label key={s.code} className="curb-service" data-selected={service === s.code || undefined}>
              <input type="radio" name="service" value={s.code} checked={service === s.code} onChange={() => setService(s.code)} />
              <ServiceDiagram code={s.code} title={s.label} />
              <strong>{s.label}</strong>
              <span className="web-muted">{s.summary}</span>
              {s.needsHumanScoping && <span className="curb-tag">Human scoping before price</span>}
            </label>
          ))}
          <div className="curb-row">
            <Button disabled={!service} onClick={() => setStep('property')}>
              Continue
            </Button>
          </div>
        </fieldset>
      )}
      {step === 'property' && (
        <div className="curb-stack">
          {!candidate && <AddressSearch api={api} onSelect={(c, q) => setCandidate({ c, q })} />}
          {candidate && !property && (
            <PropertyConfirm
              api={api}
              query={candidate.q}
              candidate={candidate.c}
              onConfirmed={(p) => {
                setProperty(p);
                setStep('confirm');
              }}
            />
          )}
          <div className="curb-row">
            <Button variant="ghost" onClick={() => (candidate ? setCandidate(null) : setStep('service'))}>
              Back
            </Button>
          </div>
        </div>
      )}
      {step === 'confirm' && service && property && (
        <div className="curb-stack">
          <p>
            <strong>{CURB_SERVICE_TAXONOMY.find((s) => s.code === service)?.label}</strong> at the confirmed property. Jurisdiction and its permit rules
            are taken from the property.
          </p>
          <Field label="Short description (optional)" hint="For example: widen driveway by one car width.">
            <TextInput value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {error !== null && <ErrorNotice error={error} />}
          <div className="curb-row">
            <Button variant="ghost" onClick={() => setStep('property')}>
              Back
            </Button>
            <Button loading={busy} onClick={() => void create()}>
              Create project
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
