'use client';

// PLT-014 first-run company setup. Each confirmed step is saved to an on-device draft (IndexedDB),
// so setup resumes from the last confirmed step after a reload, a crash or a dropped connection
// (PLT-014 S). The company is created once, with an Idempotency-Key stored in the draft, so a
// retried "Create company" can never create two tenants. The logo upload uses a deterministic key
// (org + file checksum), so re-uploading the same file after a reload is also idempotent.
import { BRAND, CURRENCY_OPTIONS, type MeasurementSystem, type ProductLine } from './options';
import {
  Button,
  Field,
  RadioGroup,
  Select,
  Skeleton,
  Stepper,
  TextInput,
  type StepItem,
} from '@fieldline/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ButtonLink, ErrorNotice } from '../../components/common';
import { newIdempotencyKey } from '../../lib/api';
import { fractionToPercent, percentToFraction } from '../../lib/decimal-text';
import { getDraftStore, type DraftScope } from '../../lib/offline/drafts';
import { ME_QUERY_KEY, useApi, useMe } from '../../lib/session';

export const ONBOARDING_STEPS = [
  { id: 'company', label: 'Company' },
  { id: 'trade', label: 'Trade focus' },
  { id: 'regions', label: 'Work regions' },
  { id: 'defaults', label: 'Currency, units and tax' },
  { id: 'logo', label: 'Logo' },
  { id: 'finish', label: 'Finish' },
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

export type TradeFocus = 'roof' | 'curb' | 'both';
export type TaxMode = 'exclusive' | 'inclusive' | 'not_applicable';

export interface OnboardingDraft {
  confirmed: OnboardingStepId[];
  legalName: string;
  displayName: string;
  timezone: string;
  trade: TradeFocus | null;
  regions: string[];
  currency: string;
  measurementSystem: MeasurementSystem;
  taxMode: TaxMode | null;
  /** Fraction string, e.g. "0.0825" (never a float). */
  defaultTaxRate: string | null;
  orgId: string | null;
  createKey: string;
  logo: { mediaAssetId: string; fileName: string; sha256: string } | null;
}

export const DRAFT_KEY = 'onboarding';
export const DRAFT_VERSION = 1;

export function emptyDraft(): OnboardingDraft {
  return {
    confirmed: [],
    legalName: '',
    displayName: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    trade: null,
    regions: [],
    currency: 'USD',
    measurementSystem: 'imperial',
    taxMode: null,
    defaultTaxRate: null,
    orgId: null,
    createKey: newIdempotencyKey(),
    logo: null,
  };
}

export function productLinesFor(trade: TradeFocus): ProductLine[] {
  return trade === 'both' ? ['roof', 'curb'] : [trade];
}

/** First step not yet confirmed: where a resumed setup continues. */
export function resumeStep(draft: OnboardingDraft): OnboardingStepId {
  return ONBOARDING_STEPS.find((s) => !draft.confirmed.includes(s.id))?.id ?? 'finish';
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type LogoType = (typeof LOGO_TYPES)[number];

export function OnboardingWizard() {
  const me = useMe();
  if (me.isPending) {
    return (
      <Shell>
        <Skeleton label="Loading setup" />
      </Shell>
    );
  }
  if (me.error) {
    return (
      <Shell>
        <h1>Company setup</h1>
        <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
      </Shell>
    );
  }
  return <Wizard userId={me.data.user.id} hasWorkspace={Boolean(me.data.activeOrgId)} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main id="fl-main" className="web-onboarding" tabIndex={-1}>
      <p className="web-brand web-brand--large">{BRAND.name}</p>
      {children}
    </main>
  );
}

function Wizard({ userId, hasWorkspace }: { userId: string; hasWorkspace: boolean }) {
  const scope: DraftScope = { userId, orgId: null };
  const scopeRef = useRef(scope);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [step, setStep] = useState<OnboardingStepId>('company');
  const [startNew, setStartNew] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getDraftStore()
      .load<OnboardingDraft>(scopeRef.current, DRAFT_KEY, DRAFT_VERSION)
      .then((saved) => {
        if (cancelled) return;
        if (saved) {
          setDraft(saved.value);
          setStep(resumeStep(saved.value));
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: OnboardingDraft) => {
    setDraft(next);
    await getDraftStore().save(scopeRef.current, DRAFT_KEY, next, DRAFT_VERSION);
  };

  const confirm = async (id: OnboardingStepId, patch: Partial<OnboardingDraft>) => {
    const base = draft ?? emptyDraft();
    const next: OnboardingDraft = {
      ...base,
      ...patch,
      confirmed: base.confirmed.includes(id) ? base.confirmed : [...base.confirmed, id],
    };
    await persist(next);
    setStep(resumeStep(next));
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  if (!loaded) {
    return (
      <Shell>
        <Skeleton label="Loading setup" />
      </Shell>
    );
  }

  if (!draft && hasWorkspace && !startNew) {
    return (
      <Shell>
        <h1>Company setup</h1>
        <p>Your company is already set up. You can change its profile and defaults in Settings.</p>
        <div className="web-actions">
          <ButtonLink href="/">Go to Home</ButtonLink>
          <ButtonLink href="/settings" variant="secondary">
            Open Settings
          </ButtonLink>
          <Button variant="ghost" onClick={() => setStartNew(true)}>
            Set up another company
          </Button>
        </div>
      </Shell>
    );
  }

  const current = draft ?? emptyDraft();
  const steps: StepItem[] = ONBOARDING_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    state: s.id === step ? 'current' : current.confirmed.includes(s.id) ? 'complete' : 'upcoming',
  }));
  const stepLabel = ONBOARDING_STEPS.find((s) => s.id === step)?.label ?? '';
  const locked = Boolean(current.orgId);

  return (
    <Shell>
      <h1>Set up your company</h1>
      <p className="web-muted">
        About five minutes. Progress is saved on this device after every step, so you can stop and
        come back.
      </p>
      <Stepper steps={steps} label="Setup progress" />
      <section className="web-onboarding__step" aria-labelledby="onboarding-step-heading">
        <h2 id="onboarding-step-heading" ref={headingRef} tabIndex={-1}>
          {stepLabel}
        </h2>
        {locked && ['company', 'trade', 'regions', 'defaults'].includes(step) ? (
          <p>
            This step was saved when the company was created. Change it later in Settings.{' '}
            <Button size="sm" variant="secondary" onClick={() => setStep(resumeStep(current))}>
              Continue
            </Button>
          </p>
        ) : step === 'company' ? (
          <CompanyStep draft={current} onConfirm={(p) => confirm('company', p)} />
        ) : step === 'trade' ? (
          <TradeStep
            draft={current}
            onBack={() => setStep('company')}
            onConfirm={(p) => confirm('trade', p)}
          />
        ) : step === 'regions' ? (
          <RegionsStep
            draft={current}
            onBack={() => setStep('trade')}
            onConfirm={(p) => confirm('regions', p)}
          />
        ) : step === 'defaults' ? (
          <DefaultsStep
            draft={current}
            onBack={() => setStep('regions')}
            onCreated={(p) => confirm('defaults', p)}
            onKeyUsed={(p) => persist({ ...current, ...p })}
          />
        ) : step === 'logo' ? (
          <LogoStep draft={current} onConfirm={(p) => confirm('logo', p)} />
        ) : (
          <FinishStep draft={current} scope={scope} />
        )}
      </section>
    </Shell>
  );
}

type StepProps = {
  draft: OnboardingDraft;
  onConfirm: (patch: Partial<OnboardingDraft>) => Promise<void>;
  onBack?: () => void;
};

function StepActions({
  onBack,
  submitLabel = 'Save and continue',
  busy = false,
}: {
  onBack?: () => void;
  submitLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="web-actions">
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      )}
      <Button type="submit" loading={busy}>
        {submitLabel}
      </Button>
    </div>
  );
}

function CompanyStep({ draft, onConfirm }: StepProps) {
  const [legalName, setLegalName] = useState(draft.legalName);
  const [displayName, setDisplayName] = useState(draft.displayName);
  const [timezone, setTimezone] = useState(draft.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!legalName.trim()) next.legalName = 'Enter the registered company name.';
    if (!timezone.trim()) next.timezone = 'Enter a time zone such as America/Chicago.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    await onConfirm({
      legalName: legalName.trim(),
      displayName: displayName.trim() || legalName.trim(),
      timezone: timezone.trim(),
    });
  };
  return (
    <form onSubmit={submit} noValidate>
      <Field label="Legal company name" required error={errors.legalName}>
        <TextInput
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          autoComplete="organization"
        />
      </Field>
      <Field
        label="Name customers see"
        hint="Shown on proposals and reports. Defaults to the legal name."
      >
        <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field
        label="Time zone"
        required
        hint="IANA name, e.g. America/Chicago. Dates are shown in this zone."
        error={errors.timezone}
      >
        <TextInput value={timezone} onChange={(e) => setTimezone(e.target.value)} />
      </Field>
      <StepActions />
    </form>
  );
}

function TradeStep({ draft, onConfirm, onBack }: StepProps) {
  const [trade, setTrade] = useState<TradeFocus | null>(draft.trade);
  const [error, setError] = useState<string | undefined>();
  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!trade) {
          setError('Choose what your company does.');
          return;
        }
        await onConfirm({ trade });
      }}
    >
      <RadioGroup<TradeFocus>
        legend="What work does your company do?"
        hint="Both products stay available later; this sets which guided setup and defaults you see first."
        value={trade}
        onChange={(v) => {
          setTrade(v);
          setError(undefined);
        }}
        error={error}
        required
        options={[
          { value: 'roof', label: BRAND.products.roof },
          { value: 'curb', label: BRAND.products.curb },
          { value: 'both', label: `Both: ${BRAND.products.roof} and ${BRAND.products.curb}` },
        ]}
      />
      <StepActions onBack={onBack} />
    </form>
  );
}

function RegionsStep({ draft, onConfirm, onBack }: StepProps) {
  const [text, setText] = useState(draft.regions.join('\n'));
  const regions = text
    .split(/\n|,/)
    .map((r) => r.trim())
    .filter(Boolean);
  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        await onConfirm({ regions });
      }}
    >
      <Field
        label="Cities, counties or states you work in"
        hint="One per line. Used to pick regional price books and curb permit jurisdictions. Drawing exact service-area boundaries on a map comes in a later slice."
      >
        <textarea
          className="web-textarea"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      <p className="web-muted web-small">
        {regions.length === 0
          ? 'No regions yet; you can add them later.'
          : `${regions.length} region(s).`}
      </p>
      <StepActions onBack={onBack} />
    </form>
  );
}

function DefaultsStep({
  draft,
  onBack,
  onCreated,
  onKeyUsed,
}: {
  draft: OnboardingDraft;
  onBack: () => void;
  onCreated: (patch: Partial<OnboardingDraft>) => Promise<void>;
  onKeyUsed: (patch: Partial<OnboardingDraft>) => Promise<void>;
}) {
  const { endpoints } = useApi();
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState(draft.currency);
  const [system, setSystem] = useState<MeasurementSystem>(draft.measurementSystem);
  const [taxMode, setTaxMode] = useState<TaxMode | null>(draft.taxMode);
  const [rateText, setRateText] = useState(
    draft.defaultTaxRate ? (fractionToPercent(draft.defaultTaxRate) ?? '') : '',
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!taxMode) next.taxMode = 'Choose how you charge tax.';
    let rate: string | null = null;
    if (taxMode && taxMode !== 'not_applicable' && rateText.trim()) {
      rate = percentToFraction(rateText);
      if (rate === null) next.rate = 'Enter a percent between 0 and 99.9999, e.g. 8.25.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !draft.trade) return;
    setBusy(true);
    setError(null);
    const patch: Partial<OnboardingDraft> = {
      currency,
      measurementSystem: system,
      taxMode,
      defaultTaxRate: rate,
    };
    // Persist the choices first so a failure keeps them (and the same idempotency key).
    await onKeyUsed(patch);
    try {
      const org = await endpoints.createOrganization(
        {
          legalName: draft.legalName,
          displayName: draft.displayName,
          productLines: productLinesFor(draft.trade),
          timezone: draft.timezone,
          currency,
          measurementSystem: system,
        },
        draft.createKey,
      );
      const me = await endpoints.switchWorkspace(org.id);
      queryClient.clear();
      queryClient.setQueryData(ME_QUERY_KEY, me);
      // Each settings section is its own versioned revision on the API; step progress itself
      // resumes from the on-device draft.
      await endpoints.saveOrgSettings('general', { workRegions: draft.regions }, 'Company setup');
      await endpoints.saveOrgSettings(
        'billing',
        { taxRate: taxMode === 'not_applicable' ? null : rate },
        'Company setup',
      );
      await onCreated({ ...patch, orgId: org.id });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Field label="Currency" hint="Prices are stored exactly in this currency's smallest unit.">
        <Select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          options={CURRENCY_OPTIONS}
        />
      </Field>
      <RadioGroup<MeasurementSystem>
        legend="Measurement display"
        hint="Only changes how lengths and areas are shown. Measurements are always stored in metric units, so switching later never changes a saved value."
        value={system}
        onChange={setSystem}
        options={[
          { value: 'imperial', label: 'Imperial (feet, square feet, roofing squares)' },
          { value: 'metric', label: 'Metric (metres, square metres)' },
        ]}
      />
      <RadioGroup<TaxMode>
        legend="Sales tax on your quotes"
        value={taxMode}
        onChange={setTaxMode}
        error={errors.taxMode}
        required
        options={[
          { value: 'exclusive', label: 'Added on top of prices' },
          { value: 'inclusive', label: 'Included in prices' },
          { value: 'not_applicable', label: 'Not charged' },
        ]}
      />
      {taxMode && taxMode !== 'not_applicable' && (
        <Field
          label="Default tax rate (%)"
          hint="Optional. Can be overridden on each quote; approved documents keep the rate they were issued with."
          error={errors.rate}
        >
          <TextInput
            inputMode="decimal"
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            suffix="%"
          />
        </Field>
      )}
      {error !== null && <ErrorNotice error={error} title="The company could not be created" />}
      <StepActions onBack={onBack} submitLabel="Create company" busy={busy} />
    </form>
  );
}

function LogoStep({ draft, onConfirm }: StepProps) {
  const { endpoints } = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const orgId = draft.orgId;

  const upload = async (file: File) => {
    if (!orgId) return;
    if (!(LOGO_TYPES as readonly string[]).includes(file.type)) {
      setMessage('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage('The logo must be 5 MB or smaller.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const sha256 = await sha256Hex(file);
      // Deterministic key: the same file for the same company is one upload, even after reload.
      const ticket = await endpoints.createUpload(
        {
          fileName: file.name,
          mimeType: file.type as LogoType,
          sizeBytes: file.size,
          sha256,
          kind: 'document',
        },
        `logo-${orgId}-${sha256}`,
      );
      if (!ticket.duplicate) {
        const put = await fetch(ticket.uploadUrl, {
          method: ticket.method,
          headers: ticket.headers,
          body: file,
          credentials: 'include',
        });
        if (!put.ok) throw new Error(`Upload failed with status ${put.status}.`);
      }
      await onConfirm({ logo: { mediaAssetId: ticket.mediaAssetId, fileName: file.name, sha256 } });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p>
        Optional. The logo file is stored with your company now; placing it on reports and proposals
        comes with the document templates in a later slice.
      </p>
      {draft.logo && <p role="status">Uploaded: {draft.logo.fileName}</p>}
      <Field label="Company logo" hint="PNG, JPEG or WebP, up to 5 MB.">
        <input
          type="file"
          accept={LOGO_TYPES.join(',')}
          disabled={busy || !orgId}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </Field>
      {busy && <p role="status">Uploading…</p>}
      {message && <p role="alert">{message}</p>}
      {error !== null && <ErrorNotice error={error} title="The logo could not be uploaded" />}
      <div className="web-actions">
        <Button variant="secondary" onClick={() => void onConfirm({})} disabled={busy}>
          {draft.logo ? 'Continue' : 'Skip for now'}
        </Button>
      </div>
    </div>
  );
}

function FinishStep({ draft, scope }: { draft: OnboardingDraft; scope: DraftScope }) {
  const { endpoints } = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div>
      <p>
        <strong>{draft.displayName || draft.legalName}</strong> is ready. Next you can invite your
        team and assign roles. You will be the owner of record.
      </p>
      <ul>
        <li>
          Trade focus:{' '}
          {draft.trade === 'both'
            ? 'Both products'
            : draft.trade === 'roof'
              ? BRAND.products.roof
              : BRAND.products.curb}
        </li>
        <li>Regions: {draft.regions.length > 0 ? draft.regions.join(', ') : 'none yet'}</li>
        <li>
          Currency {draft.currency}, {draft.measurementSystem} display
        </li>
      </ul>
      <p className="web-muted web-small">
        A sample estimate and your first price book are set up from {BRAND.products.roof} and{' '}
        {BRAND.products.curb} once those areas are available.
      </p>
      {error !== null && <ErrorNotice error={error} title="Setup could not be completed" />}
      <div className="web-actions">
        <Button
          loading={busy}
          onClick={async () => {
            if (!draft.orgId) return;
            setBusy(true);
            setError(null);
            try {
              await endpoints.saveOrgSettings(
                'general',
                {
                  workRegions: draft.regions,
                  logoMediaAssetId: draft.logo?.mediaAssetId ?? null,
                },
                'Company setup completed',
              );
              await getDraftStore().remove(scope, DRAFT_KEY);
              router.replace('/team');
            } catch (e) {
              setError(e);
              setBusy(false);
            }
          }}
        >
          Finish and invite my team
        </Button>
      </div>
    </div>
  );
}
