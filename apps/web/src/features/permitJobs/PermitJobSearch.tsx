'use client';
// Texas permit job search. Pulls public building permits, ranks early-stage jobs for one trade,
// builds builder profiles and writes outreach. Read-only: nothing is sent without the user.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { orgKey, useApi, useSession } from '../../lib/session';

const TRADES = {
  grading: 'Grading and site work',
  concrete: 'Concrete and curb cutting',
  roofing: 'Roofing',
  materials: 'Building materials supply',
  framing: 'Framing and lumber',
  hvac: 'HVAC',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  general: 'General subcontracting',
} as const;
type Trade = keyof typeof TRADES;
const PROJECTS = {
  single_family: 'Single-family',
  townhome: 'Townhomes',
  multifamily: 'Multifamily',
  cottage: 'Cottages / ADUs',
  site_work: 'Land development / site work',
  commercial: 'Commercial',
  other: 'Other',
} as const;
type Project = keyof typeof PROJECTS;

const METRO_PICKS: Record<string, string[]> = {
  'All Texas live feeds': ['All Texas'],
  DFW: [
    'Dallas',
    'Fort Worth',
    'Carrollton',
    'Plano',
    'Frisco',
    'McKinney',
    'Arlington',
    'Irving',
    'Denton',
    'Lewisville',
  ],
  'Collin County': [
    'Plano',
    'Frisco',
    'McKinney',
    'Allen',
    'Prosper',
    'Celina',
    'Princeton',
    'Anna',
    'Wylie',
    'Murphy',
    'Melissa',
  ],
  Houston: ['Houston', 'Katy', 'Sugar Land', 'Pearland', 'Conroe', 'League City', 'Cypress'],
  Austin: ['Austin', 'Round Rock', 'Georgetown', 'Cedar Park', 'Pflugerville', 'Leander', 'Kyle'],
  'San Antonio': ['San Antonio', 'New Braunfels', 'Schertz', 'Boerne', 'Seguin'],
};

const City = z.object({ name: z.string(), county: z.string(), metro: z.string() });
const Catalog = z.object({
  liveSources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      cities: z.array(z.string()),
      url: z.string(),
      note: z.string(),
    }),
  ),
  cities: z.array(City),
});
const Lead = z.object({
  source: z.string(),
  sourceName: z.string(),
  permitNumber: z.string(),
  city: z.string(),
  address: z.string(),
  description: z.string(),
  status: z.string(),
  issuedAt: z.string().nullable(),
  appliedAt: z.string().nullable(),
  value: z.number(),
  contractor: z.string(),
  contractorPhone: z.string(),
  url: z.string(),
  projectType: z.string(),
  earlyStage: z.boolean(),
  stage: z.enum(['planning', 'application', 'permitted', 'completed', 'unknown']).optional(),
  tradeEvidence: z.enum(['recorded', 'not_observed', 'unknown', 'not_applicable']).optional(),
  possibleTradeOpening: z.boolean().optional(),
  contractorAssigned: z.boolean(),
  distanceLabel: z.string(),
  score: z.number(),
  grade: z.string(),
  reasons: z.array(z.string()),
});
const Profile = z.object({
  key: z.string(),
  name: z.string(),
  phone: z.string(),
  permitCount: z.number(),
  totalValue: z.number(),
  cities: z.array(z.string()),
  projectTypes: z.array(z.string()),
  latestPermitAt: z.string().nullable(),
  topScore: z.number(),
  grade: z.string(),
  intent: z.string(),
  permits: z.array(
    z.object({
      permitNumber: z.string(),
      address: z.string(),
      city: z.string(),
      value: z.number(),
      url: z.string(),
    }),
  ),
});
const Kit = z.object({
  forKey: z.string(),
  materials: z.array(z.string()),
  emails: z.array(z.object({ label: z.string(), subject: z.string(), body: z.string() })),
  callOpener: z.string(),
  followUps: z.array(z.object({ day: z.number(), channel: z.string(), message: z.string() })),
  pitchDeck: z.array(z.object({ title: z.string(), points: z.array(z.string()) })),
});
const Result = z.object({
  fetchedAt: z.string(),
  appliedFilters: z.object({
    minimumValue: z.number(),
    stages: z.array(z.string()),
    ruleInterpretation: z.array(z.string()),
    note: z.string(),
  }).optional(),
  summary: z.object({
    checked: z.number(),
    qualified: z.number(),
    totalValue: z.number(),
    builders: z.number(),
    gradeA: z.number(),
    possibleTradeOpenings: z.number().optional(),
    planningSignals: z.number().optional(),
    excluded: z.record(z.string(), z.number()),
    skippedCompanies: z.array(z.string()),
  }),
  feeds: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      count: z.number(),
      latest: z.string().nullable(),
      message: z.string(),
    }),
  ),
  leads: z.array(Lead),
  topLeads: z.array(Lead),
  profiles: z.array(Profile),
  kits: z.array(Kit),
  video: z.object({ onScreen: z.array(z.string()), narration: z.string() }),
  citiesWithoutFeed: z.array(
    City.extend({ links: z.array(z.object({ label: z.string(), url: z.string() })) }),
  ),
});
type ResultT = z.infer<typeof Result>;
const Watch = z.object({
  watch: z
    .object({
      enabled: z.boolean(),
      schedule: z.enum(['morning', 'all_day']),
      lastRunAt: z.string().nullable(),
      lastMessage: z.string(),
      lastResult: Result.extend({
        newCount: z.number().optional(),
        leads: z.array(Lead.extend({ isNew: z.boolean().optional() })),
      })
        .nullable()
        .catch(null),
    })
    .nullable(),
});

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString('en-US') : 'Not listed');
const lines = (v: string) =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cc-btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function PermitJobSearch() {
  const { api } = useApi();
  const { orgId } = useSession();
  const [trade, setTrade] = useState<Trade>('grading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [cities, setCities] = useState('Dallas, Austin, Carrollton, Plano, Frisco');
  const [homeCity, setHomeCity] = useState('Carrollton');
  const [days, setDays] = useState(30);
  const [minValue, setMinValue] = useState(0);
  const [rule, setRule] = useState('');
  const [stages, setStages] = useState<string[]>([]);
  const [skip, setSkip] = useState('');
  const [skipPublic, setSkipPublic] = useState(true);
  const [earlyOnly, setEarlyOnly] = useState(true);
  const [company, setCompany] = useState('');
  const [yourName, setYourName] = useState('');
  const [booking, setBooking] = useState('');
  const [feeds, setFeeds] = useState('');
  const [openKit, setOpenKit] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: orgKey(orgId, 'permit-jobs', 'catalog'),
    queryFn: () => api.get('/v1/permit-leads/catalog', { schema: Catalog }),
    staleTime: 300000,
  });
  const body = () => ({
    trade,
    projectTypes: projects,
    cities: lines(cities).slice(0, 40),
    homeCity,
    days,
    minValue,
    rule,
    stages,
    exclude: lines(skip).slice(0, 50),
    skipPublicOwners: skipPublic,
    earlyOnly,
    company,
    yourName,
    bookingLink: booking.trim(),
    customFeeds: feeds
      .split('\n')
      .map((l) => l.split('|').map((s) => s.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1])
      .slice(0, 10)
      .map(([city, url]) => ({ city: city!, url: url! })),
  });
  const qc = useQueryClient();
  const [schedule, setSchedule] = useState<'morning' | 'all_day'>('morning');
  const watch = useQuery({
    queryKey: orgKey(orgId, 'permit-jobs', 'watch'),
    queryFn: () => api.get('/v1/permit-leads/watch', { schema: Watch }),
  });
  const saveWatch = useMutation({
    mutationFn: (enabled: boolean) =>
      api.put('/v1/permit-leads/watch', { enabled, schedule, search: body() }, { schema: Watch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKey(orgId, 'permit-jobs', 'watch') }),
  });
  const runNow = useMutation({
    mutationFn: () => api.post('/v1/permit-leads/watch/run', {}, { schema: Watch }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orgKey(orgId, 'permit-jobs', 'watch') }),
  });
  // When the app is opened (or the laptop wakes and the page is shown again), run the saved check
  // if its last run is more than 3 hours old.
  const autoRan = useRef(0);
  const savedWatch = watch.data?.watch;
  useEffect(() => {
    const maybeRun = () => {
      if (document.visibilityState !== 'visible' || !savedWatch?.enabled || runNow.isPending)
        return;
      const last = savedWatch.lastRunAt ? Date.parse(savedWatch.lastRunAt) : 0;
      const nowMs = Date.now();
      if (nowMs - last < 3 * 3_600_000 || nowMs - autoRan.current < 3 * 3_600_000) return;
      autoRan.current = nowMs;
      runNow.mutate();
    };
    maybeRun();
    document.addEventListener('visibilitychange', maybeRun);
    return () => document.removeEventListener('visibilitychange', maybeRun);
  }, [savedWatch, runNow]);
  const search = useMutation({
    mutationFn: () => api.post('/v1/permit-leads/search', body(), { schema: Result }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOpenKit(null);
    search.mutate();
  };
  const saved = watch.data?.watch ?? null;
  const r:
    | (ResultT & { newCount?: number; leads: (ResultT['leads'][number] & { isNew?: boolean })[] })
    | undefined = search.data ?? saved?.lastResult ?? undefined;

  return (
    <div className="cc-work-board">
      <section className="web-card" aria-labelledby="permit-jobs-heading">
        <h1 id="permit-jobs-heading">Permit Job Search — Texas</h1>
        <p className="web-muted">
          Find construction opportunities from official city permits and planning-stage signals.
          Pick your trade and Texas cities. Each result links to its public source; contractor and
          trade availability must be verified before outreach. Some cities have no supported feed.
          Saved searches run through the existing server worker.
        </p>
        <form className="cc-work-board__form" onSubmit={submit}>
          <label>
            Your trade
            <select value={trade} onChange={(e) => setTrade(e.target.value as Trade)}>
              {Object.entries(TRADES).map(([id, l]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Project types (leave all off for every type)</legend>
            {Object.entries(PROJECTS).map(([id, l]) => (
              <label key={id} className="web-small">
                <input
                  type="checkbox"
                  checked={projects.includes(id as Project)}
                  onChange={(e) =>
                    setProjects((cur) =>
                      e.target.checked ? [...cur, id as Project] : cur.filter((x) => x !== id),
                    )
                  }
                />{' '}
                {l}
              </label>
            ))}
          </fieldset>
          <label>
            Texas cities (comma or one per line — any Texas city works)
            <textarea rows={3} value={cities} onChange={(e) => setCities(e.target.value)} />
          </label>
          <p className="web-small">
            Quick pick:{' '}
            {Object.entries(METRO_PICKS).map(([label, list]) => (
              <button
                key={label}
                type="button"
                className="cc-btn"
                onClick={() => setCities(list.join(', '))}
              >
                {label}
              </button>
            ))}
          </p>
          <label>
            Your home base city (ranks nearby jobs first)
            <input
              list="tx-cities"
              value={homeCity}
              onChange={(e) => setHomeCity(e.target.value)}
              maxLength={60}
            />
            <datalist id="tx-cities">
              {catalog.data?.cities.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </label>
          <label>
            Permits from the last
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 14, 30, 60, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum listed project value (USD)
            <input type="number" min={0} max={50000000000} step={10000} value={minValue}
              onChange={(e) => setMinValue(Math.max(0, Number(e.target.value) || 0))} />
          </label>
          <label>
            Plain-English rules (limited, safe parser)
            <input value={rule} onChange={(e) => setRule(e.target.value)} maxLength={300}
              placeholder="Only commercial projects over $1 million" />
            <span className="web-muted web-small">
              Understands project type and minimum value. Select cities and trade separately;
              unsupported words are ignored and the applied filters are shown with results.
            </span>
          </label>
          <fieldset>
            <legend>Project stages (leave all unchecked for every stage)</legend>
            {(['planning', 'application', 'permitted', 'completed', 'unknown'] as const).map((stage) => (
              <label key={stage} className="web-small">
                <input type="checkbox" checked={stages.includes(stage)}
                  onChange={(e) => setStages((current) =>
                    e.target.checked ? [...current, stage] : current.filter((s) => s !== stage))} />{' '}
                {stage.charAt(0).toUpperCase() + stage.slice(1)}
              </label>
            ))}
          </fieldset>
          <label>
            Skip these builders or owners (comma or one per line)
            <textarea
              rows={2}
              value={skip}
              onChange={(e) => setSkip(e.target.value)}
              placeholder="Taylor Morrison, D.R. Horton"
            />
          </label>
          <label className="web-small">
            <input
              type="checkbox"
              checked={skipPublic}
              onChange={(e) => setSkipPublic(e.target.checked)}
            />{' '}
            Skip cities, counties, school districts and state agencies
          </label>
          <label className="web-small">
            <input
              type="checkbox"
              checked={earlyOnly}
              onChange={(e) => setEarlyOnly(e.target.checked)}
            />{' '}
            Early-stage jobs only (new construction, not finished)
          </label>
          <label>
            Your company name (used in emails)
            <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={120} />
          </label>
          <label>
            Your name (used in emails)
            <input value={yourName} onChange={(e) => setYourName(e.target.value)} maxLength={80} />
          </label>
          <label>
            Calendar booking link (optional, https)
            <input
              type="url"
              value={booking}
              onChange={(e) => setBooking(e.target.value)}
              placeholder="https://"
            />
          </label>
          <details>
            <summary>Add another city&apos;s open-data permit feed</summary>
            <p className="web-muted web-small">
              Many Texas cities publish permits on an open-data site. Open the city&apos;s permit
              dataset, choose API, and copy the link that ends in{' '}
              <code>/resource/xxxx-xxxx.json</code>. One per line as
              <code> City | link</code>.
            </p>
            <textarea
              rows={3}
              value={feeds}
              onChange={(e) => setFeeds(e.target.value)}
              placeholder="Fort Worth | https://data.example.gov/resource/abcd-1234.json"
            />
          </details>
          <button className="cc-btn cc-btn--primary" type="submit" disabled={search.isPending}>
            {search.isPending ? 'Reading Texas permits…' : 'Find permit jobs'}
          </button>
        </form>
        {catalog.data && (
          <p className="web-muted web-small">
            Live city feeds now: {catalog.data.liveSources.map((s) => s.name).join(' · ')}. Every
            other Texas city gets official portal links and can be added with its open-data feed.
          </p>
        )}
      </section>

      <section className="web-card" aria-labelledby="permit-watch-heading">
        <h2 id="permit-watch-heading">Daily automatic check</h2>
        <p className="web-muted web-small">
          Save the search above and Field Pro runs it for you on its own server, even when the app
          is closed. Every morning at about 6:10 am Texas time it pulls new permits, ranks them and
          writes the outreach. It also runs every time the server starts or wakes up, if the last
          check is more than 3 hours old. Pick all day to also check every two hours, around the
          clock.
        </p>
        <label>
          How often
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as 'morning' | 'all_day')}
          >
            <option value="morning">Every morning</option>
            <option value="all_day">Every morning and every 2 hours (24/7)</option>
          </select>
        </label>
        <p>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={saveWatch.isPending}
            onClick={() => saveWatch.mutate(true)}
          >
            {saved?.enabled ? 'Update the daily check with this search' : 'Turn on the daily check'}
          </button>{' '}
          {saved?.enabled && (
            <>
              <button
                type="button"
                className="cc-btn"
                disabled={runNow.isPending}
                onClick={() => runNow.mutate()}
              >
                {runNow.isPending ? 'Checking permits…' : 'Run the check now'}
              </button>{' '}
              <button
                type="button"
                className="cc-btn"
                disabled={saveWatch.isPending}
                onClick={() => saveWatch.mutate(false)}
              >
                Turn off
              </button>
            </>
          )}
        </p>
        {saved && (
          <p className="web-small" aria-live="polite">
            Status:{' '}
            {saved.enabled
              ? `On (${saved.schedule === 'all_day' ? 'every morning and every 2 hours' : 'every morning'})`
              : 'Off'}
            . Last check:{' '}
            {saved.lastRunAt ? new Date(saved.lastRunAt).toLocaleString('en-US') : 'not run yet'}.
            {saved.lastMessage ? ` ${saved.lastMessage}` : ''}
          </p>
        )}
        {saveWatch.error && (
          <ErrorNotice error={saveWatch.error} title="Could not save the daily check" />
        )}
        {runNow.error && <ErrorNotice error={runNow.error} title="The check did not finish" />}
        {!search.data && saved?.lastResult && (
          <p className="web-muted web-small">
            Showing the results from the last automatic check below.
          </p>
        )}
      </section>

      {search.error && (
        <ErrorNotice
          error={search.error}
          title="Permit search failed"
          onRetry={() => search.mutate()}
        />
      )}

      {r && (
        <>
          <section className="web-card" aria-live="polite">
            <h2>Results</h2>
            <div className="cc-work-board__cards">
              <article className="web-card">
                <strong>{money(r.summary.totalValue)}</strong>
                <p className="web-muted web-small">Permit value that fits you</p>
              </article>
              <article className="web-card">
                <strong>{r.summary.qualified}</strong>
                <p className="web-muted web-small">
                  Qualified jobs out of {r.summary.checked} checked
                </p>
              </article>
              <article className="web-card">
                <strong>{r.summary.builders}</strong>
                <p className="web-muted web-small">Builders to contact</p>
              </article>
              <article className="web-card">
                <strong>{r.summary.possibleTradeOpenings ?? 0}</strong>
                <p className="web-muted web-small">Contractor listed, trade permit not observed</p>
              </article>
              <article className="web-card">
                <strong>{r.summary.planningSignals ?? 0}</strong>
                <p className="web-muted web-small">Planning-stage records</p>
              </article>
              <article className="web-card">
                <strong>{r.summary.gradeA}</strong>
                <p className="web-muted web-small">Grade A jobs</p>
              </article>
            </div>
            {r.appliedFilters && (
              <p className="web-muted web-small">
                Applied: {r.appliedFilters.ruleInterpretation.join(' · ') || 'manual search fields'}
                {r.appliedFilters.minimumValue > 0 ? ' · Minimum ' + money(r.appliedFilters.minimumValue) : ''}
                {r.appliedFilters.stages.length ? ' · Stages ' + r.appliedFilters.stages.join(', ') : ''}.
                {' '}{r.appliedFilters.note}
              </p>
            )}
            {Object.keys(r.summary.excluded).length > 0 && (
              <p className="web-muted web-small">
                Cut:{' '}
                {Object.entries(r.summary.excluded)
                  .map(([k, n]) => `${k} (${n})`)
                  .join(' · ')}
              </p>
            )}
            {r.summary.skippedCompanies.length > 0 && (
              <p className="web-muted web-small">
                Builders cut from the list: {r.summary.skippedCompanies.join(', ')}
              </p>
            )}
            <ul className="web-small">
              {r.feeds.map((f) => (
                <li key={f.id}>
                  <strong>{f.name}:</strong>{' '}
                  {f.status === 'ok' ? `${f.count} permits, latest ${date(f.latest)}` : f.status}.{' '}
                  {f.message}
                </li>
              ))}
            </ul>
          </section>

          {r.citiesWithoutFeed.length > 0 && (
            <section className="web-card">
              <h2>Cities without a live feed yet</h2>
              <p className="web-muted web-small">
                These cities do not publish an open permit feed Field Pro can read yet. Use the
                official links, or add their open-data feed above.
              </p>
              {r.citiesWithoutFeed.map((c) => (
                <div key={c.name}>
                  <strong>
                    {c.name}
                    {c.county ? ` (${c.county} County)` : ''}
                  </strong>
                  <ul className="web-small">
                    {c.links.map((l) => (
                      <li key={l.url}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer">
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          <section className="web-card">
            <h2>Top jobs to call first</h2>
            {r.topLeads.length === 0 && (
              <p className="web-muted">
                No jobs fit these filters. Widen the days, project types or cities.
              </p>
            )}
            <div className="cc-work-board__cards">
              {r.topLeads.map((p, i) => {
                const key = p.source + ':' + p.permitNumber;
                const kit = r.kits.find((k) => k.forKey === key);
                return (
                  <article className="web-card" key={key}>
                    <small className="cc-work-board__source">
                      {'isNew' in p && p.isNew ? 'NEW · ' : ''}#{i + 1} · Grade {p.grade} · Score{' '}
                      {p.score} · {p.distanceLabel}
                    </small>
                    <strong>
                      {p.address}, {p.city}
                    </strong>
                    <p className="web-small">{p.description || 'No description on the permit'}</p>
                    <p className="web-muted web-small">
                      {p.value > 0 ? money(p.value) : 'Value not listed'} · Permit {p.permitNumber}{' '}
                      · {p.status || 'Status not listed'} · Updated {date(p.appliedAt ?? p.issuedAt)}
                      {p.stage ? ' · Stage: ' + p.stage : ''}
                    </p>
                    <p className="web-muted web-small">
                      Builder: {p.contractor || 'Not named on permit — look up the owner'}
                      {p.contractorPhone ? ` · ${p.contractorPhone}` : ''}
                    </p>
                    {p.tradeEvidence && p.tradeEvidence !== 'not_applicable' && (
                      <p className="web-small">
                        Trade permit check: {p.tradeEvidence === 'recorded'
                          ? 'Trade-specific permit observed in the returned records'
                          : p.tradeEvidence === 'not_observed'
                            ? 'No trade-specific permit observed in the returned records — not proof a subcontractor is available'
                            : 'Insufficient address data to compare trade permits'}
                      </p>
                    )}
                    <p className="web-muted web-small">Why: {p.reasons.join(' · ')}</p>
                    <a
                      className="cc-work-board__link"
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open city record
                    </a>
                    {kit && (
                      <button
                        type="button"
                        className="cc-btn"
                        onClick={() => setOpenKit(openKit === key ? null : key)}
                      >
                        {openKit === key ? 'Hide contact draft' : 'Contact contractor · Generate draft'}
                      </button>
                    )}
                    {kit && openKit === key && (

                      <div>
                        <h3>What they will need</h3>
                        <ul className="web-small">
                          {kit.materials.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                        <h3>Call opener</h3>
                        <p className="web-small">
                          {kit.callOpener} <Copy text={kit.callOpener} />
                        </p>
                        <h3>Emails (review and copy; no messages sent automatically)</h3>
                        {kit.emails.map((em) => (
                          <div key={em.label}>
                            <p className="web-small">
                              <strong>{em.label}:</strong> {em.subject}{' '}
                              <Copy text={`Subject: ${em.subject}\n\n${em.body}`} />
                            </p>
                            <pre className="web-small" style={{ whiteSpace: 'pre-wrap' }}>
                              {em.body}
                            </pre>
                          </div>
                        ))}
                        <h3>Follow-up plan</h3>
                        <ul className="web-small">
                          {kit.followUps.map((f) => (
                            <li key={f.day}>
                              Day {f.day} ({f.channel}): {f.message}
                            </li>
                          ))}
                        </ul>
                        <h3>One-page pitch</h3>
                        {kit.pitchDeck.map((s) => (
                          <div key={s.title}>
                            <strong className="web-small">{s.title}</strong>
                            <ul className="web-small">
                              {s.points.map((pt) => (
                                <li key={pt}>{pt}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <p className="web-muted web-small">
              To send these from your own inbox every day, open{' '}
              <a href="/bidding">Bidding → Outreach</a>. Nothing is sent from this page.
            </p>
          </section>

          <section className="web-card">
            <h2>Builder profiles</h2>
            {r.profiles.length === 0 && (
              <p className="web-muted">No builders are named on the matching permits.</p>
            )}
            <div className="cc-work-board__cards">
              {r.profiles.slice(0, 40).map((b) => (
                <article className="web-card" key={b.key}>
                  <small className="cc-work-board__source">
                    Grade {b.grade} · {b.intent}
                  </small>
                  <strong>{b.name}</strong>
                  <p className="web-muted web-small">
                    {b.permitCount} permits · {money(b.totalValue)} · {b.cities.join(', ')} · latest{' '}
                    {date(b.latestPermitAt)}
                    {b.phone ? ` · ${b.phone}` : ''}
                  </p>
                  <ul className="web-small">
                    {b.permits.slice(0, 5).map((p) => (
                      <li key={p.permitNumber}>
                        {p.address}, {p.city} — {p.value > 0 ? money(p.value) : 'value not listed'}
                      </li>
                    ))}
                  </ul>
                  <a
                    className="cc-work-board__link"
                    href="https://comptroller.texas.gov/taxes/franchise/account-status/search"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Find owners and officers (Texas Comptroller)
                  </a>
                </article>
              ))}
            </div>
          </section>

          <section className="web-card">
            <h2>30–45 second video script</h2>
            <ol className="web-small">
              {r.video.onScreen.map((t) => (
                <li key={t}>On screen: {t}</li>
              ))}
            </ol>
            <p>
              {r.video.narration} <Copy text={r.video.narration} />
            </p>
          </section>

          {r.leads.length > r.topLeads.length && (
            <section className="web-card">
              <h2>All qualified jobs ({r.leads.length})</h2>
              <div style={{ overflowX: 'auto' }}>
                <table className="web-small">
                  <thead>
                    <tr>
                      <th>Grade</th>
                      <th>Score</th>
                      <th>Address</th>
                      <th>City</th>
                      <th>Value</th>
                      <th>Builder</th>
                      <th>Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.leads.map((p) => (
                      <tr key={p.source + p.permitNumber}>
                        <td>{p.grade}</td>
                        <td>{p.score}</td>
                        <td>
                          <a href={p.url} target="_blank" rel="noopener noreferrer">
                            {p.address}
                          </a>
                        </td>
                        <td>{p.city}</td>
                        <td>{p.value > 0 ? money(p.value) : '—'}</td>
                        <td>{p.contractor || '—'}</td>
                        <td>{date(p.issuedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
