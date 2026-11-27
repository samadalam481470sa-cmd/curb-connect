'use client';

// Field home: the phone-first screen for crews — clock in/out, work assigned to you,
// open inspections with the checklist runner, and deliveries. Everything here reuses
// the existing APIs and writes through the offline outbox, so it keeps working with
// no signal and sends when the connection returns. Labels switch English/Spanish.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { resolveDisplay, useDisplayPreferences } from '../../lib/preferences';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, initialFieldLang, type UiLang } from '../builderOps/shared';
import { AssignmentCards } from './AssignmentCards';
import { ChecklistRunner } from './ChecklistRunner';
import { ClockCard } from './ClockCard';
import { DeliveryCards } from './DeliveryCards';

const Result = z.object({
  id: z.string(),
  templateId: z.string(),
  jobId: z.string().nullable(),
  inspectorName: z.string().nullable(),
  status: z.enum(['in_progress', 'completed']),
  answers: z.array(z.object({ key: z.string(), result: z.string() })),
  photoMediaIds: z.array(z.string()),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ResultList = z.object({ items: z.array(Result) });

export function FieldHomeView() {
  return (
    <RouteGate routeId="field">
      <FieldHomeContent />
    </RouteGate>
  );
}

function FieldHomeContent() {
  const session = useSession();
  const { api } = useApi();
  const [prefs] = useDisplayPreferences();
  const [lang, setLang] = useState<UiLang>(() =>
    initialFieldLang(resolveDisplay(prefs, { locale: session.me.user.locale }).locale),
  );
  const L = FIELD_LABELS[lang];
  const [openRunner, setOpenRunner] = useState<string | null>(null);

  const inspections = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'open-inspections'),
    queryFn: () =>
      api.get('/v1/field-ops/inspection-results?status=in_progress', { schema: ResultList }),
    enabled: session.can('inspection_checklist:read'),
  });

  return (
    <main>
      <PageHeader title={L.fieldHome} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <span>{L.language}</span>
        <button
          type="button"
          className={lang === 'en' ? 'cc-btn cc-btn--primary' : 'cc-btn'}
          aria-pressed={lang === 'en'}
          onClick={() => setLang('en')}
        >
          EN
        </button>
        <button
          type="button"
          className={lang === 'es' ? 'cc-btn cc-btn--primary' : 'cc-btn'}
          aria-pressed={lang === 'es'}
          onClick={() => setLang('es')}
        >
          ES
        </button>
      </div>
      <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
        {session.can('time_entry:read') ? <ClockCard lang={lang} /> : null}
        {session.can('assignment:read') ? <AssignmentCards lang={lang} /> : null}
        {session.can('inspection_checklist:read') ? (
          <section className="web-card" aria-label={L.openInspections}>
            <h2>{L.openInspections}</h2>
            {inspections.error ? <ErrorNotice error={inspections.error} /> : null}
            {(inspections.data?.items ?? []).length === 0 && !inspections.isLoading ? (
              <p className="web-muted">{L.noResults}</p>
            ) : null}
            <div style={{ display: 'grid', gap: 12 }}>
              {(inspections.data?.items ?? []).map((r) => (
                <article key={r.id} className="web-card" style={{ padding: 12 }}>
                  <p style={{ margin: '0 0 8px' }}>
                    {r.inspectorName ?? '—'} · {r.answers.length} {L.items}
                  </p>
                  <button
                    type="button"
                    className="cc-btn cc-btn--primary"
                    style={{ minHeight: 48, width: '100%' }}
                    aria-expanded={openRunner === r.id}
                    onClick={() => setOpenRunner(openRunner === r.id ? null : r.id)}
                  >
                    {L.runChecklist}
                  </button>
                  {openRunner === r.id ? (
                    <div style={{ marginTop: 12 }}>
                      <ChecklistRunner resultId={r.id} lang={lang} />
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
        {session.can('network_order:read') ? <DeliveryCards lang={lang} /> : null}
      </div>
    </main>
  );
}
