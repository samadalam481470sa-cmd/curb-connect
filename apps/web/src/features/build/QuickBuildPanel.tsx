'use client';

// Quick build: type a size and get the whole house — every job by trade with its cost, the tools
// and equipment each phase needs (with your own prices or a live listing), your own companies and
// the builders and trades mapped near the lot to call, and "make it cheaper" options priced by the
// same cost model. Area pricing is the national NAHB average times the regional factor you set.
import {
  AreaFactorResponseSchema,
  stateFips,
  type InvoiceClient,
  InvoiceClientListSchema,
  type NearbyCompany,
  type NearbyTrade,
  NearbyTradesResponseSchema,
  type StudioLot,
} from '@fieldline/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../lib/session';
import { fetchLivePrices } from './live';
import { EQUIPMENT_BY_PHASE, applyAllSmart, jobsForSpec, savingOptions, specFromSquareFeet } from './quickBuild';
import { PHASES, type PhaseId, type StudioCostSettings } from './studioCost';
import type { MaterialId } from './prices';
import type { BuildSpec, PriceOverride } from './takeoff';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

const TRADE_LABEL: Record<NearbyTrade, string> = {
  builder: 'Builders',
  carpenter: 'Carpenters',
  roofer: 'Roofers',
  plumber: 'Plumbers',
  electrician: 'Electricians',
  hvac: 'HVAC',
  concrete: 'Concrete',
  drywall: 'Drywall',
  painter: 'Painters',
  flooring: 'Flooring',
  insulation: 'Insulation',
  landscaper: 'Landscapers',
  excavation: 'Excavation',
  hardware_store: 'Hardware stores',
  lumber_yard: 'Lumber yards',
  equipment_rental: 'Equipment rental',
};

export interface QuickBuildProps {
  spec: BuildSpec;
  onSpec: (next: BuildSpec) => void;
  studioCosts: StudioCostSettings;
  onStudioCosts: (next: StudioCostSettings) => void;
  overrides: Partial<Record<MaterialId, PriceOverride>>;
  lot: StudioLot | null;
  location: string;
}

export function QuickBuildPanel({ spec, onSpec, studioCosts, onStudioCosts, overrides, lot, location }: QuickBuildProps) {
  const { api } = useApi();
  const [sqft, setSqft] = useState(String(spec.lengthFt * spec.widthFt * spec.stories));
  const [stories, setStories] = useState<'auto' | '1' | '2'>('auto');
  const [beds, setBeds] = useState('');
  const [baths, setBaths] = useState('');
  const [garage, setGarage] = useState<'auto' | BuildSpec['garage']>('auto');
  const [assumed, setAssumed] = useState<string[]>([]);
  const [trade, setTrade] = useState<NearbyTrade | 'all'>('all');
  const [equipPrices, setEquipPrices] = useState<Record<string, string>>({});
  const [equipLive, setEquipLive] = useState<Record<string, string>>({});

  const plan = useMemo(() => jobsForSpec(spec, studioCosts), [spec, studioCosts]);
  const options = useMemo(() => savingOptions(spec, studioCosts, overrides), [spec, studioCosts, overrides]);
  const smart = useMemo(() => applyAllSmart(spec, options, studioCosts, overrides), [spec, options, studioCosts, overrides]);

  const own = useQuery({
    queryKey: ['invoice-clients', 'quick-build'],
    queryFn: () => api.get('/v1/invoice-clients', { schema: InvoiceClientListSchema }),
    staleTime: 60_000,
  });
  const nearby = useMutation({
    mutationFn: (point: { lat: number; lon: number; trade: NearbyTrade | 'all' }) =>
      api.post(
        '/v1/site/trades',
        { lat: point.lat, lon: point.lon, radiusKm: 25, ...(point.trade !== 'all' ? { trade: point.trade } : {}) },
        { schema: NearbyTradesResponseSchema },
      ),
  });

  // Local area factor from construction wages near the lot (BLS), applied once automatically
  // unless the builder already set their own factor.
  const lat = lot?.lat ?? null;
  const lon = lot?.lon ?? null;
  const stateName = lot?.address?.split(',').map((x) => x.trim().replace(/\s+\d{5}(-\d{4})?$/, '')).find((x) => stateFips(x) !== null);
  const area = useQuery({
    queryKey: ['area-factor', lat?.toFixed(2), lon?.toFixed(2)],
    enabled: lat !== null && lon !== null,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: () =>
      api.post('/v1/market/area-factor', { lat: lat!, lon: lon!, ...(stateName ? { state: stateName } : {}) }, { schema: AreaFactorResponseSchema }),
  });
  const applied = useRef<string | null>(null);
  useEffect(() => {
    const f = area.data?.factor;
    const key = `${lat},${lon}`;
    if (f == null || applied.current === key) return;
    applied.current = key;
    if (Math.abs(studioCosts.regionalFactor - 1) < 1e-9) onStudioCosts({ ...studioCosts, regionalFactor: f });
  }, [area.data, lat, lon, studioCosts, onStudioCosts]);

  function build() {
    const n = Number(sqft.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n < 400) return;
    const result = specFromSquareFeet(
      {
        sqft: n,
        ...(stories !== 'auto' ? { stories: Number(stories) as 1 | 2 } : {}),
        ...(beds ? { bedrooms: Number(beds) } : {}),
        ...(baths ? { bathrooms: Number(baths) } : {}),
        ...(garage !== 'auto' ? { garage } : {}),
      },
      spec,
    );
    setAssumed(result.assumed);
    onSpec(result.spec);
  }

  async function checkEquipment(item: string) {
    setEquipLive((m) => ({ ...m, [item]: 'Checking…' }));
    const r = await fetchLivePrices(api, `${item} rental per day`, location);
    const best = r.offers[0];
    setEquipLive((m) => ({
      ...m,
      [item]: r.live && best ? `${best.seller}: $${best.price.toLocaleString('en-US')}` : r.message ?? 'No live listing. Enter your quote.',
    }));
  }

  const companies: NearbyCompany[] = nearby.data?.companies ?? [];
  const shownCompanies = companies.filter((c) => trade === 'all' || c.trade === trade).slice(0, 40);
  const ownCompanies: InvoiceClient[] = own.data?.items ?? [];
  const phases = Array.from(new Set(plan.jobs.map((j) => j.phase))) as PhaseId[];
  const equipTotal = Object.values(equipPrices).reduce((s, v) => s + (Number(v) || 0), 0);

  return (
    <div className="qb">
      <div className="wb-card qb-form">
        <label className="wb-field">
          <span className="wb-label">Square feet</span>
          <input className="wb-input" inputMode="numeric" aria-label="Square feet" value={sqft} onChange={(e) => setSqft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && build()} />
        </label>
        <label className="wb-field">
          <span className="wb-label">Stories</span>
          <select className="wb-input" aria-label="Stories" value={stories} onChange={(e) => setStories(e.target.value as typeof stories)}>
            <option value="auto">Auto</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <label className="wb-field">
          <span className="wb-label">Bedrooms</span>
          <input className="wb-input" inputMode="numeric" aria-label="Bedrooms" placeholder="Auto" value={beds} onChange={(e) => setBeds(e.target.value.replace(/\D/g, '').slice(0, 1))} />
        </label>
        <label className="wb-field">
          <span className="wb-label">Bathrooms</span>
          <input className="wb-input" inputMode="numeric" aria-label="Bathrooms" placeholder="Auto" value={baths} onChange={(e) => setBaths(e.target.value.replace(/\D/g, '').slice(0, 1))} />
        </label>
        <label className="wb-field">
          <span className="wb-label">Garage</span>
          <select className="wb-input" aria-label="Garage" value={garage} onChange={(e) => setGarage(e.target.value as typeof garage)}>
            <option value="auto">Auto</option>
            <option value="none">None</option>
            <option value="one_car">1-car</option>
            <option value="two_car">2-car</option>
          </select>
        </label>
        <button type="button" className="hs-pill is-on" onClick={build}>
          Build whole house
        </button>
      </div>
      {assumed.length > 0 && <p className="wb-muted">Assumed {assumed.join(', ')}. Change any of them above.</p>}

      <div className="wb-sums qb-sums">
        <div>
          <span className="wb-label">Build cost</span>
          <strong>{usd(plan.total)}</strong>
        </div>
        <div>
          <span className="wb-label">Per sq ft</span>
          <strong>{usd(plan.perSqFt)}</strong>
        </div>
        <div>
          <span className="wb-label">Living area</span>
          <strong>{Math.round(plan.areaSqFt).toLocaleString('en-US')} sq ft</strong>
        </div>
        <div>
          <span className="wb-label">Area factor</span>
          <strong>× {studioCosts.regionalFactor.toFixed(2)}</strong>
        </div>
      </div>
      <p className="wb-muted">
        Area prices are the NAHB national average per square foot, raised to today, times your area factor.
        {lat === null || lon === null
          ? ' Find the lot in the Lot tab and the area factor is set from local construction wages.'
          : area.isPending
            ? ' Checking local construction wages…'
            : area.data
              ? ` ${area.data.message}`
              : ' The local wage check did not answer.'}
      </p>
      {area.data?.factor != null && Math.abs(area.data.factor - studioCosts.regionalFactor) > 0.005 && (
        <div className="wb-actions">
          <button type="button" className="hs-pill" onClick={() => onStudioCosts({ ...studioCosts, regionalFactor: area.data!.factor! })}>
            Use local factor × {area.data.factor.toFixed(2)}
            {area.data.areaName ? ` (${area.data.areaName})` : ''}
          </button>
        </div>
      )}

      <h3 className="qb-h">Every job</h3>
      <div className="wb-table-wrap">
        <table className="wb-table">
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">Job</th>
              <th scope="col">Who does it</th>
              <th scope="col">Quantity</th>
              <th scope="col" className="wb-num">Cost</th>
            </tr>
          </thead>
          <tbody>
            {plan.jobs.map((j) => (
              <tr key={j.system}>
                <td>
                  {String(j.phase).padStart(2, '0')} {j.phaseName}
                </td>
                <td>{j.label}</td>
                <td>
                  <button type="button" className="wb-link" onClick={() => setTrade(j.trade)}>
                    {j.tradeLabel}
                  </button>
                </td>
                <td>{j.keyQty}</td>
                <td className="wb-num">{usd(j.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="qb-h">Tools and equipment</h3>
      <p className="wb-muted">
        Enter your rental quote for each item, or check a live listing. Total entered: {usd(equipTotal)}.
      </p>
      <div className="qb-equip">
        {phases.map((p) => (
          <div key={p} className="wb-card">
            <strong>
              {String(p).padStart(2, '0')} {PHASES[p - 1]!.name}
            </strong>
            <ul className="wb-list">
              {EQUIPMENT_BY_PHASE[p].map((item) => (
                <li key={item} className="qb-equip-row">
                  <span>{item}</span>
                  <input
                    className="wb-input qb-price"
                    inputMode="decimal"
                    aria-label={`${item} price`}
                    placeholder="$"
                    value={equipPrices[item] ?? ''}
                    onChange={(e) => setEquipPrices((m) => ({ ...m, [item]: e.target.value.replace(/[^0-9.]/g, '') }))}
                  />
                  <button type="button" className="wb-link" onClick={() => void checkEquipment(item)}>
                    Check price
                  </button>
                  {equipLive[item] && <small className="wb-muted">{equipLive[item]}</small>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h3 className="qb-h">Who to call</h3>
      <div className="wb-actions">
        <button
          type="button"
          className="hs-pill"
          disabled={nearby.isPending || lot?.lat == null || lot?.lon == null}
          onClick={() => lot?.lat != null && lot?.lon != null && nearby.mutate({ lat: lot.lat, lon: lot.lon, trade })}
        >
          {nearby.isPending ? 'Searching…' : trade === 'all' ? 'Find companies near the lot' : `Find ${TRADE_LABEL[trade].toLowerCase()} near the lot`}
        </button>
        <select className="wb-input" aria-label="Trade" value={trade} onChange={(e) => setTrade(e.target.value as typeof trade)}>
          <option value="all">All trades</option>
          {(Object.keys(TRADE_LABEL) as NearbyTrade[]).map((t) => (
            <option key={t} value={t}>
              {TRADE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>
      {(lot?.lat == null || lot?.lon == null) && <p className="wb-muted">Find the lot's address in the Lot tab first, then search near it.</p>}
      {nearby.data && <p className="wb-muted">{nearby.data.message} {nearby.data.attribution}.</p>}
      {nearby.isError && <p className="wb-message">The company search did not answer. Try again in a minute.</p>}
      {shownCompanies.length > 0 && (
        <ul className="wb-list qb-companies">
          {shownCompanies.map((c) => (
            <li key={c.id} className="wb-card">
              <strong>{c.name}</strong> <span className="wb-muted">{TRADE_LABEL[c.trade]} · {c.distanceKm.toFixed(1)} km</span>
              {c.address && <div className="wb-muted">{c.address}</div>}
              <div className="wb-actions">
                {c.phone && (
                  <a className="wb-link" href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`}>
                    Call {c.phone}
                  </a>
                )}
                {c.website && /^https?:\/\//.test(c.website) && (
                  <a className="wb-link" href={c.website} target="_blank" rel="noopener noreferrer">
                    Website
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="qb-h">Your companies</h3>
      {ownCompanies.length === 0 ? (
        <p className="wb-muted">Companies and customers you add in Invoices and Network show up here.</p>
      ) : (
        <ul className="wb-list qb-companies">
          {ownCompanies.slice(0, 30).map((c) => (
            <li key={`${c.kind}-${c.id}`} className="wb-card">
              <strong>{c.name}</strong> <span className="wb-muted">{c.kind === 'company' ? 'Connected company' : 'Customer'}</span>
              {c.party?.phone && (
                <div>
                  <a className="wb-link" href={`tel:${c.party.phone.replace(/[^0-9+]/g, '')}`}>
                    Call {c.party.phone}
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="qb-h">Make it cheaper</h3>
      {options.length === 0 ? (
        <p className="wb-muted">This house is already built lean. No change saves more than $50.</p>
      ) : (
        <>
          {smart.saving >= 50 && (
            <div className="wb-actions">
              <button type="button" className="hs-pill is-on" onClick={() => onSpec(smart.spec)}>
                Apply all design and method savings ({usd(smart.saving)})
              </button>
            </div>
          )}
          <ul className="wb-list">
            {options.map((o) => (
              <li key={o.id} className="wb-card qb-option">
                <div>
                  <strong>{o.title}</strong>{' '}
                  <span className="wb-muted">
                    saves {usd(o.saving)} ({o.savingPercent.toFixed(1)}%) ·{' '}
                    {o.kind === 'program' ? 'client gets less' : o.kind === 'method' ? 'how it is built' : 'same house, smarter'}
                    {o.basis === 'materials' ? ' · materials' : ''}
                  </span>
                  <div className="wb-muted">{o.why}</div>
                </div>
                <button type="button" className="hs-pill" onClick={() => onSpec(o.spec)}>
                  Apply
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
