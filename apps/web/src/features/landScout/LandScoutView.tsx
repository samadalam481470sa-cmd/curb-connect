'use client';

// Land Scout: describe the land you want (form, or plain English parsed by your Qwen model
// for your review), search live Texas county CAD parcels, and get them ranked 0-100 with a
// per-factor breakdown. Unknown data is shown as unknown — never invented. Dallas CAD data
// in the live layer is appraisal-year 2019; each parcel shows its vintage.
import {
  BuyBoxSchema,
  LAND_COUNTY_LABELS,
  LAND_USE_LABELS,
  type BuyBox,
  type LandCounty,
  type LandReport,
  type LandSearchResponse,
  type LandUseType,
  type RankedParcel,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { orgKey, useApi, useSession } from '../../lib/session';
import { NumberField, Panel, SelectField } from '../command/Panel';

const USE_OPTIONS = (Object.keys(LAND_USE_LABELS) as LandUseType[]).map((value) => ({
  value,
  label: LAND_USE_LABELS[value],
}));

const DEFAULT_BOX: BuyBox = BuyBoxSchema.parse({
  useType: 'industrial',
  acresMin: 20,
  acresMax: 100,
  maxHighwayMiles: 1,
  needsPower: true,
  counties: ['collin', 'dallas'],
  maxPricePerAcre: 50000,
});

const money = (n: number | null) =>
  n === null ? 'Not published' : `$${Math.round(n).toLocaleString('en-US')}`;
const miles = (n: number | null) => (n === null ? 'Unknown' : `${n.toFixed(1)} mi`);

export function LandScoutView() {
  return (
    <RouteGate routeId="landScout">
      <LandScoutContent />
    </RouteGate>
  );
}

function LandScoutContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const [box, setBox] = useState<BuyBox>(DEFAULT_BOX);
  const [plainText, setPlainText] = useState('');
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [results, setResults] = useState<LandSearchResponse | null>(null);
  const [report, setReport] = useState<LandReport | null>(null);
  const [saveName, setSaveName] = useState('');
  const [importCounty, setImportCounty] = useState<LandCounty>('dallas');
  const [importCsv, setImportCsv] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);

  const status = useQuery({
    queryKey: orgKey(session.orgId, 'land-scout', 'status'),
    queryFn: ({ signal }) => endpoints.landScoutStatus(signal),
    retry: false,
  });
  const saved = useQuery({
    queryKey: orgKey(session.orgId, 'land-scout', 'buy-boxes'),
    queryFn: ({ signal }) => endpoints.landScoutBuyBoxes(signal),
    retry: false,
  });

  const set = <K extends keyof BuyBox>(key: K, value: BuyBox[K]) =>
    setBox((prev) => ({ ...prev, [key]: value }));
  const nullableNum = (v: number) => (v > 0 ? v : null);

  const parse = useMutation({
    mutationFn: () => endpoints.landScoutParse({ text: plainText.trim() }),
    onSuccess: (data) => {
      setBox(data.buyBox);
      setParseNote(
        `Parsed by ${data.model} (${data.source === 'home' ? 'home AI server' : 'open model'}). Review the filters below before searching.${data.notes ? ` Not mapped: ${data.notes}` : ''}`,
      );
    },
  });

  const search = useMutation({
    mutationFn: () => endpoints.landScoutSearch({ buyBox: box, limit: 20 }),
    onSuccess: (data) => {
      setResults(data);
      setReport(null);
    },
  });

  const openReport = useMutation({
    mutationFn: (r: RankedParcel) =>
      endpoints.landScoutReport(r.parcel.county, r.parcel.parcelId, box),
    onSuccess: (data) => setReport(data),
  });

  const saveBox = useMutation({
    mutationFn: () => endpoints.landScoutSaveBuyBox({ name: saveName.trim(), buyBox: box }),
    onSuccess: () => {
      setSaveName('');
      void queryClient.invalidateQueries({
        queryKey: orgKey(session.orgId, 'land-scout', 'buy-boxes'),
      });
    },
  });

  const deleteBox = useMutation({
    mutationFn: (id: string) => endpoints.landScoutDeleteBuyBox(id),
    onSuccess: () =>
      void queryClient.invalidateQueries({
        queryKey: orgKey(session.orgId, 'land-scout', 'buy-boxes'),
      }),
  });

  const importParcels = useMutation({
    mutationFn: () => endpoints.landScoutImport({ county: importCounty, csv: importCsv }),
    onSuccess: (data) =>
      setImportResult(
        `Imported ${data.imported} parcel(s), skipped ${data.skipped}.${data.errors.length ? ` First issues: ${data.errors.slice(0, 3).join('; ')}` : ''} Imported parcels join your next search, labeled as imports.`,
      ),
  });

  const toggleCounty = (county: LandCounty, on: boolean) =>
    setBox((prev) => ({
      ...prev,
      counties: on
        ? [...new Set([...prev.counties, county])]
        : prev.counties.filter((c) => c !== county),
    }));

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <PageHeader
        title="Land Scout"
        description="Describe the land you want. Land Scout searches live Collin and Dallas county appraisal-district parcels, scores them against your buy box, and ranks where to spend your time first. Unknown data stays unknown."
      />
      {status.data ? (
        <Panel title="Data sources">
          <p className="web-muted web-small">{status.data.aiDetail}</p>
          <ul className="web-small">
            {status.data.sources.map((s) => (
              <li key={s.id}>
                <strong>{s.name}</strong> — {s.status === 'ok' ? 'live' : s.status}: {s.detail}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {status.error ? <ErrorNotice error={status.error} /> : null}

      <Panel title="Describe it in plain English (optional)">
        {status.data && !status.data.aiParsing ? (
          <p className="web-muted web-small">
            AI parsing is not connected, so this box is off. The manual form below works fully.
          </p>
        ) : (
          <>
            <label className="cc-field">
              <span>Your buy box in plain English</span>
              <textarea
                className="cc-input"
                rows={3}
                value={plainText}
                placeholder="Large industrial site 50+ acres near a highway with 3-phase power in Dallas County under $50k/acre"
                onChange={(e) => setPlainText(e.currentTarget.value)}
              />
            </label>
            <button
              type="button"
              className="cc-btn"
              disabled={plainText.trim().length < 3 || parse.isPending}
              onClick={() => parse.mutate()}
            >
              {parse.isPending ? 'Parsing…' : 'Parse with my Qwen model'}
            </button>
            {parseNote ? <p className="web-muted web-small">{parseNote}</p> : null}
            {parse.error ? <ErrorNotice error={parse.error} /> : null}
          </>
        )}
      </Panel>

      <Panel title="Buy box">
        <div className="cc-grid" style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <SelectField label="Use type" value={box.useType} options={USE_OPTIONS} onChange={(v) => set('useType', v)} />
          <NumberField label="Min acres" value={box.acresMin ?? 0} min={0} onChange={(n) => set('acresMin', nullableNum(n))} />
          <NumberField label="Max acres" value={box.acresMax ?? 0} min={0} onChange={(n) => set('acresMax', nullableNum(n))} />
          <NumberField label="Max highway distance" suffix="mi" value={box.maxHighwayMiles ?? 0} min={0} step={0.5} onChange={(n) => set('maxHighwayMiles', nullableNum(n))} />
          <NumberField label="Max price" suffix="$/acre" value={box.maxPricePerAcre ?? 0} min={0} step={1000} onChange={(n) => set('maxPricePerAcre', nullableNum(n))} />
          <label className="cc-field">
            <span>Zoning / use words (matched to appraisal use)</span>
            <input
              className="cc-input"
              value={box.zoning ?? ''}
              placeholder="e.g. industrial"
              onChange={(e) => set('zoning', e.currentTarget.value.trim() || null)}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
          {(Object.keys(LAND_COUNTY_LABELS) as LandCounty[]).map((c) => (
            <label key={c} className="web-small">
              <input
                type="checkbox"
                checked={box.counties.includes(c)}
                onChange={(e) => toggleCounty(c, e.currentTarget.checked)}
              />{' '}
              {LAND_COUNTY_LABELS[c]}
            </label>
          ))}
          <label className="web-small">
            <input type="checkbox" checked={box.needsPower} onChange={(e) => set('needsPower', e.currentTarget.checked)} /> Needs power (substation scored)
          </label>
          <label className="web-small">
            <input type="checkbox" checked={box.needsWater} onChange={(e) => set('needsWater', e.currentTarget.checked)} /> Needs water (confirm with city)
          </label>
          <label className="web-small">
            <input type="checkbox" checked={box.needsSewer} onChange={(e) => set('needsSewer', e.currentTarget.checked)} /> Needs sewer (confirm with city)
          </label>
        </div>
        <p className="web-muted web-small">
          Scoring: appraisal use 30% · size 25% · infrastructure 25% · price 20%. CAD data
          carries appraisal use, not city zoning — confirm zoning with the city. Factors with
          no data are excluded, never zero-filled.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cc-btn"
            disabled={box.counties.length === 0 || search.isPending}
            onClick={() => search.mutate()}
          >
            {search.isPending ? 'Searching county data…' : 'Search parcels'}
          </button>
          <input
            className="cc-input"
            style={{ maxWidth: 220 }}
            value={saveName}
            placeholder="Name to save this buy box"
            onChange={(e) => setSaveName(e.currentTarget.value)}
          />
          <button
            type="button"
            className="cc-btn cc-btn--sm"
            disabled={!saveName.trim() || saveBox.isPending}
            onClick={() => saveBox.mutate()}
          >
            Save buy box
          </button>
        </div>
        {search.error ? <ErrorNotice error={search.error} /> : null}
        {saved.data && saved.data.items.length > 0 ? (
          <ul className="web-small">
            {saved.data.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => setBox(item.buyBox)}>
                  Load
                </button>{' '}
                {item.name}{' '}
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => deleteBox.mutate(item.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      {results ? (
        <Panel title={`Ranked parcels — top ${results.results.length} of ${results.candidatesConsidered} candidates`}>
          {results.results.length === 0 ? (
            <p className="web-muted web-small">
              No parcels matched. Widen the acreage range or counties and search again.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="cc-table">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>Parcel</th>
                    <th>Owner</th>
                    <th>Acres</th>
                    <th>Use</th>
                    <th>$/acre (CAD)</th>
                    <th>Highway</th>
                    <th>Substation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r) => (
                    <tr key={`${r.parcel.county}:${r.parcel.parcelId}`}>
                      <td>
                        <strong>{r.score.total ?? '—'}</strong>
                        <div className="web-muted web-small">{r.score.factorsKnown}/4 factors</div>
                      </td>
                      <td>
                        {r.parcel.situsAddress ?? r.parcel.parcelId}
                        <div className="web-muted web-small">
                          {LAND_COUNTY_LABELS[r.parcel.county]} · #{r.parcel.parcelId}
                          {r.parcel.origin === 'import' ? ' · imported' : ''}
                        </div>
                      </td>
                      <td>{r.parcel.ownerName ?? 'Not published'}</td>
                      <td>{r.parcel.acres ?? '—'}</td>
                      <td>{r.parcel.appraisalUse ?? '—'}</td>
                      <td>
                        {r.parcel.landValue !== null && r.parcel.acres
                          ? money(r.parcel.landValue / r.parcel.acres)
                          : 'Not published'}
                      </td>
                      <td>{miles(r.parcel.highwayMiles)}{r.parcel.highwayName ? ` (${r.parcel.highwayName})` : ''}</td>
                      <td>{miles(r.parcel.substationMiles)}{r.parcel.substationKv ? ` (${r.parcel.substationKv} kV)` : ''}</td>
                      <td>
                        <button type="button" className="cc-btn cc-btn--sm" onClick={() => openReport.mutate(r)}>
                          Report
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="web-muted web-small">
            Searched {new Date(results.searchedAt).toLocaleString()}. Sources:{' '}
            {results.sources.map((s) => `${s.name} (${s.status})`).join(' · ')}
          </p>
        </Panel>
      ) : null}

      {openReport.error ? <ErrorNotice error={openReport.error} /> : null}
      {report ? (
        <Panel title="Due-diligence report" actions={
          <button type="button" className="cc-btn cc-btn--sm" onClick={() => window.print()}>
            Print / save PDF
          </button>
        }>
          <p>
            <strong>{report.parcel.situsAddress ?? `Parcel ${report.parcel.parcelId}`}</strong>{' '}
            ({LAND_COUNTY_LABELS[report.parcel.county]} #{report.parcel.parcelId})
          </p>
          <ul className="web-small">
            <li>Owner: {report.parcel.ownerName ?? 'Not published'} — {report.parcel.ownerMailing ?? 'mailing not published'}</li>
            <li>Acres: {report.parcel.acres ?? 'Not published'} · Appraisal use: {report.parcel.appraisalUse ?? 'Not published'}</li>
            <li>CAD land value: {money(report.parcel.landValue)} · Market value: {money(report.parcel.marketValue)}</li>
            <li>Highway: {miles(report.parcel.highwayMiles)}{report.parcel.highwayName ? ` (${report.parcel.highwayName})` : ''} · Substation: {miles(report.parcel.substationMiles)}{report.parcel.substationKv ? ` (${report.parcel.substationKv} kV)` : ''}</li>
            <li>FEMA flood zone: {report.floodZone ?? 'Not returned'}{report.floodSpecialHazard ? ' (Special Flood Hazard Area)' : ''}</li>
            <li>Terrain: {report.terrainSummary ?? 'Not checked'}</li>
            <li>Score: {report.score.total ?? 'Not enough data'} ({report.score.factorsKnown}/4 factors) — use {report.score.use.score ?? '—'}, size {report.score.size.score ?? '—'}, infrastructure {report.score.infrastructure.score ?? '—'}, price {report.score.price.score ?? '—'}</li>
            <li>Source: {report.parcel.source}{report.parcel.vintage ? ` · ${report.parcel.vintage}` : ''}</li>
          </ul>
          <p className="web-small"><strong>Red flags & checks</strong></p>
          <ul className="web-small">
            {report.redFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          {report.ownerIsEntity ? (
            <p className="web-small">
              The owner looks like a company — look up its registered agent via{' '}
              <a href={report.sosLookupUrl} target="_blank" rel="noopener noreferrer">Texas SOSDirect</a>.
              Outreach stays draft-only; nothing is sent from here.
            </p>
          ) : null}
          {report.parcel.lat !== null && report.parcel.lon !== null ? (
            <p className="web-small">
              <a
                href={`https://www.openstreetmap.org/?mlat=${report.parcel.lat}&mlon=${report.parcel.lon}#map=15/${report.parcel.lat}/${report.parcel.lon}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on map
              </a>
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Import a fresher CAD export (CSV)">
        <p className="web-muted web-small">
          The live Dallas layer is appraisal-year 2019. Download a current DCAD (or CCAD) export
          and import it here — imported parcels join searches, labeled as imports, and win over
          live rows with the same parcel id. Columns are matched by name: parcel_id (or
          prop_id/acct), owner_name, owner_mailing, situs_address, city, zip, acres,
          appraisal_use, land_value, market_value, value_year, lat, lon.
        </p>
        <SelectField
          label="County"
          value={importCounty}
          options={(Object.keys(LAND_COUNTY_LABELS) as LandCounty[]).map((value) => ({
            value,
            label: LAND_COUNTY_LABELS[value],
          }))}
          onChange={setImportCounty}
        />
        <label className="cc-field">
          <span>CSV contents</span>
          <textarea
            className="cc-input"
            rows={5}
            value={importCsv}
            placeholder="parcel_id,owner_name,acres,land_value,lat,lon&#10;..."
            onChange={(e) => setImportCsv(e.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="cc-btn"
          disabled={importCsv.trim().length < 10 || importParcels.isPending}
          onClick={() => importParcels.mutate()}
        >
          {importParcels.isPending ? 'Importing…' : 'Import parcels'}
        </button>
        {importResult ? <p className="web-muted web-small">{importResult}</p> : null}
        {importParcels.error ? <ErrorNotice error={importParcels.error} /> : null}
      </Panel>
    </div>
  );
}
