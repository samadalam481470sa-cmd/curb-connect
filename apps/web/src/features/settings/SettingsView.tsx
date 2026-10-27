'use client';

// PLT-014 / PLT-019 settings: the company profile and defaults (versioned server-side; changes
// never alter approved documents, PLT-014 R) and this device's display preferences (units and
// locale, display only: stored SI values and money minor units never change, PLT-019 A).
import {
  MEASUREMENT_SYSTEMS,
  type MeasurementSystem,
  type Organization,
} from '@fieldline/contracts';
import { Button, Field, RadioGroup, Select, Skeleton, TextInput, useToast } from '@fieldline/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { isApiError } from '../../lib/api';
import { useDisplay, useOrganization } from '../../lib/display';
import {
  formatAreaDisplay,
  formatDateTime,
  formatLengthDisplay,
  formatMoney,
} from '../../lib/format';
import { useDisplayPreferences } from '../../lib/preferences';
import { orgKey, useApi, useSession } from '../../lib/session';
import { CURRENCY_OPTIONS } from '../onboarding/options';

const LOCALE_OPTIONS = [
  { value: '', label: 'Company default' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'es-US', label: 'Español (Estados Unidos)' },
  { value: 'de-DE', label: 'Deutsch (Deutschland)' },
];

export function SettingsView() {
  return (
    <RouteGate routeId="settings">
      <PageHeader
        title="Settings"
        description="Company profile, defaults and your display preferences."
      />
      <nav aria-label="Settings sections" className="web-subnav">
        <a href="/settings/notifications">Notification preferences</a>
        <a href="/settings/price-books">Price books</a>
        <a href="/team">Team and roles</a>
      </nav>
      <CompanyProfile />
      <DisplayPreferencesSection />
    </RouteGate>
  );
}

function CompanyProfile() {
  const org = useOrganization();
  const session = useSession();
  const canEdit = session.check('org:update');
  return (
    <section aria-labelledby="company-heading" className="web-section">
      <h2 id="company-heading">Company profile and defaults</h2>
      {org.isPending ? (
        <Skeleton label="Loading company profile" />
      ) : org.error ? (
        <ErrorNotice
          error={org.error}
          title="The company profile could not be loaded"
          onRetry={() => void org.refetch()}
        />
      ) : (
        // Remount the form when a new revision arrives so it never edits stale values.
        <CompanyForm
          key={org.data.revision}
          org={org.data}
          deniedReason={canEdit.allowed ? undefined : canEdit.reason}
        />
      )}
    </section>
  );
}

function CompanyForm({ org, deniedReason }: { org: Organization; deniedReason?: string }) {
  const { endpoints } = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const display = useDisplay();
  const [legalName, setLegalName] = useState(org.legalName);
  const [displayName, setDisplayName] = useState(org.displayName);
  const [timezone, setTimezone] = useState(org.timezone);
  const [currency, setCurrency] = useState(org.currency);
  const [system, setSystem] = useState<MeasurementSystem>(org.measurementSystem);
  const readOnly = Boolean(deniedReason);
  const save = useMutation({
    mutationFn: () =>
      endpoints.updateOrganization(
        org.id,
        { legalName, displayName, timezone, currency, measurementSystem: system },
        org.revision,
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData(orgKey(org.id, 'organization'), updated);
      toast.show({ tone: 'success', message: 'Company profile saved.' });
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) {
        void queryClient.invalidateQueries({ queryKey: orgKey(org.id, 'organization') });
      }
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!readOnly) save.mutate();
  };
  return (
    <form className="web-card" onSubmit={submit} noValidate>
      {deniedReason && <p className="web-denied-reason">Read only. {deniedReason}</p>}
      <Field label="Legal company name" required disabled={readOnly}>
        <TextInput
          value={legalName}
          readOnly={readOnly}
          onChange={(e) => setLegalName(e.target.value)}
        />
      </Field>
      <Field label="Name customers see" disabled={readOnly}>
        <TextInput
          value={displayName}
          readOnly={readOnly}
          onChange={(e) => setDisplayName(e.target.value)}
        />
      </Field>
      <Field label="Time zone" hint="IANA name, e.g. America/Chicago." disabled={readOnly}>
        <TextInput
          value={timezone}
          readOnly={readOnly}
          onChange={(e) => setTimezone(e.target.value)}
        />
      </Field>
      <Field
        label="Default currency"
        hint="Applies to new quotes. Existing and approved documents keep the currency they were created with."
        disabled={readOnly}
      >
        <Select
          value={currency}
          disabled={readOnly}
          onChange={(e) => setCurrency(e.target.value)}
          options={
            CURRENCY_OPTIONS.some((o) => o.value === currency)
              ? CURRENCY_OPTIONS
              : [...CURRENCY_OPTIONS, { value: currency, label: currency }]
          }
        />
      </Field>
      <RadioGroup<MeasurementSystem>
        legend="Company measurement display"
        hint="Display default for everyone. Stored measurements are always metric and never converted."
        value={system}
        onChange={setSystem}
        disabled={readOnly}
        options={MEASUREMENT_SYSTEMS.map((s) => ({
          value: s,
          label: s === 'imperial' ? 'Imperial' : 'Metric',
        }))}
      />
      <p className="web-muted web-small">
        Revision {org.revision}, last changed{' '}
        {formatDateTime(org.updatedAt, display.locale, display.timeZone)}.
      </p>
      {save.error && (
        <ErrorNotice
          error={save.error}
          title={
            isApiError(save.error) && save.error.is('precondition_failed')
              ? 'Someone else saved a newer version; it has been reloaded'
              : 'The profile was not saved'
          }
        />
      )}
      {!readOnly && (
        <Button type="submit" loading={save.isPending}>
          Save company profile
        </Button>
      )}
    </form>
  );
}

function DisplayPreferencesSection() {
  const [prefs, setPrefs] = useDisplayPreferences();
  const display = useDisplay();
  const exampleLength = 5.4864; // metres (18 ft): an example only, nothing is stored.
  const exampleArea = 185.806; // square metres (2,000 sq ft)
  return (
    <section aria-labelledby="display-heading" className="web-section">
      <h2 id="display-heading">Your display preferences</h2>
      <div className="web-card">
        <p className="web-muted">
          These apply on this device only and change how values are shown, not what is saved.
        </p>
        <RadioGroup<'org' | MeasurementSystem>
          legend="Units"
          value={prefs.measurementSystem ?? 'org'}
          onChange={(v) => setPrefs({ measurementSystem: v === 'org' ? null : v })}
          options={[
            { value: 'org', label: 'Company default' },
            { value: 'imperial', label: 'Imperial' },
            { value: 'metric', label: 'Metric' },
          ]}
        />
        <Field label="Language and region format" hint="Dates, numbers and money formatting.">
          <Select
            value={prefs.locale ?? ''}
            options={LOCALE_OPTIONS}
            onChange={(e) => setPrefs({ locale: e.target.value || null })}
          />
        </Field>
        <p aria-live="polite">
          Preview: {formatLengthDisplay(exampleLength, display.measurementSystem, display.locale)} ·{' '}
          {formatAreaDisplay(exampleArea, display.measurementSystem, display.locale)} ·{' '}
          {formatMoney(
            { amountMinor: 549120, currency: display.currency ?? 'USD' },
            display.locale,
          )}{' '}
          · {formatDateTime(new Date().toISOString(), display.locale, display.timeZone)}
        </p>
      </div>
    </section>
  );
}
