'use client';

// Trade Finder (blueprint gap 6): search opted-in directory companies
// (published data only) and your own vendor records by trade, city, ZIP
// (exact or 3-digit area — an approximation, labeled), availability, and
// license/insurance status. "Request connection" uses the existing network
// connection flow. Your vendor records are private to your company.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { prettyStatus } from '../builderOps/shared';

const Result = z.object({
  source: z.string(),
  id: z.string(),
  name: z.string(),
  trades: z.array(z.string()),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  serviceAreaLabel: z.string().nullable(),
  availability: z.string().nullable(),
  availabilityNote: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  licenseStatus: z.string(),
  insuranceExpiresOn: z.string().nullable(),
  insuranceStatus: z.string(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  connectionStatus: z.string().nullable(),
});
type ResultT = z.infer<typeof Result>;
const SearchResponse = z.object({
  items: z.array(Result),
  directoryCount: z.number(),
  vendorCount: z.number(),
});
const Profile = z.object({
  trades: z.array(z.string()),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  availability: z.string().nullable(),
  availabilityNote: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  insuranceExpiresOn: z.string().nullable(),
  qualificationsNote: z.string().nullable(),
  directoryOptIn: z.boolean(),
  revision: z.number(),
});
const Vendor = z.object({
  id: z.string(),
  name: z.string(),
  trade: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  serviceCities: z.array(z.string()),
  serviceZips: z.array(z.string()),
  availability: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  licenseStatus: z.string(),
  insuranceExpiresOn: z.string().nullable(),
  insuranceStatus: z.string(),
  revision: z.number(),
});

const list = (s: string) => s.split(',').map((p) => p.trim()).filter(Boolean);
const statusLabel = (s: string) =>
  s === 'not_on_file' ? 'not on file' : s === 'expiring_soon' ? 'expiring soon' : s;

export function TradeFinderView() {
  return (
    <RouteGate routeId="tradeFinder">
      <Content />
    </RouteGate>
  );
}

function Content() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const canConnect = session.check('network:connect').allowed;
  const canListing = session.check('network:listing_update').allowed;
  const canVendorWrite = session.check('vendor:write').allowed;

  const [trade, setTrade] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [zipArea, setZipArea] = useState(false);
  const [availability, setAvailability] = useState('');
  const [qualifiedOnly, setQualifiedOnly] = useState(false);
  const [applied, setApplied] = useState({ trade: '', city: '', zip: '', zipArea: false, availability: '', qualifiedOnly: false });

  const params = new URLSearchParams();
  if (applied.trade) params.set('trade', applied.trade);
  if (applied.city) params.set('city', applied.city);
  if (applied.zip) params.set('zip', applied.zip);
  if (applied.zipArea) params.set('zipArea', 'true');
  if (applied.availability) params.set('availability', applied.availability);
  if (applied.qualifiedOnly) params.set('qualifiedOnly', 'true');

  const search = useQuery({
    queryKey: orgKey(session.orgId, 'trade-finder', 'search', params.toString()),
    queryFn: () => api.get(`/v1/trade-finder/search?${params.toString()}`, { schema: SearchResponse }),
  });
  const profile = useQuery({
    queryKey: orgKey(session.orgId, 'trade-finder', 'profile'),
    queryFn: () => api.get('/v1/trade-finder/profile', { schema: Profile }),
  });
  const vendors = useQuery({
    queryKey: orgKey(session.orgId, 'trade-finder', 'vendors'),
    queryFn: () => api.get('/v1/trade-finder/vendors', { schema: z.object({ items: z.array(Vendor) }) }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'trade-finder') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  const connect = useMutation({
    mutationFn: (r: ResultT) =>
      api.post('/v1/network/connections', { partnerOrgId: r.id, scopes: ['invoices'] }, { schema: z.object({ id: z.string() }) }),
    onSuccess: (_d, r) => { setError(''); setNote(`Connection request sent to ${r.name}.`); refresh(); },
    onError,
  });

  // --- profile form (seeded from loaded profile when editing)
  const [pTrades, setPTrades] = useState('');
  const [pCities, setPCities] = useState('');
  const [pZips, setPZips] = useState('');
  const [pAvailability, setPAvailability] = useState('');
  const [pLicense, setPLicense] = useState('');
  const [pLicenseExp, setPLicenseExp] = useState('');
  const [pInsuranceExp, setPInsuranceExp] = useState('');
  const saveProfile = useMutation({
    mutationFn: () =>
      api.put(
        '/v1/trade-finder/profile',
        {
          trades: list(pTrades),
          serviceCities: list(pCities),
          serviceZips: list(pZips),
          availability: pAvailability || null,
          licenseNumber: pLicense.trim() || null,
          licenseExpiresOn: pLicenseExp || null,
          insuranceExpiresOn: pInsuranceExp || null,
        },
        { schema: Profile },
      ),
    onSuccess: () => { setError(''); setNote('Directory profile saved.'); refresh(); },
    onError,
  });

  // --- vendor form
  const [vName, setVName] = useState('');
  const [vTrade, setVTrade] = useState('');
  const [vContact, setVContact] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vCities, setVCities] = useState('');
  const [vZips, setVZips] = useState('');
  const [vLicenseExp, setVLicenseExp] = useState('');
  const [vInsuranceExp, setVInsuranceExp] = useState('');
  const createVendor = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/trade-finder/vendors',
        {
          name: vName.trim(),
          trade: vTrade.trim() || null,
          contactName: vContact.trim() || null,
          contactPhone: vPhone.trim() || null,
          serviceCities: list(vCities),
          serviceZips: list(vZips),
          licenseExpiresOn: vLicenseExp || null,
          insuranceExpiresOn: vInsuranceExp || null,
        },
        { schema: Vendor },
      ),
    onSuccess: () => { setVName(''); setVTrade(''); setError(''); refresh(); },
    onError,
  });

  return (
    <div>
      <PageHeader title="Trade Finder" description="Find directory companies and your own vendors by trade, area, availability, and qualifications." />
      {error ? <ErrorNotice error={error} /> : null}
      {note ? <p role="status">{note}</p> : null}

      <section className="cc-panel">
        <h3>Search</h3>
        <div className="cc-grid">
          <input aria-label="Trade" placeholder="Trade (e.g. Roofing)" value={trade} onChange={(e) => setTrade(e.target.value)} />
          <input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <input aria-label="ZIP" placeholder="ZIP (5 digits)" value={zip} onChange={(e) => setZip(e.target.value)} />
          <label>
            <input type="checkbox" checked={zipArea} onChange={(e) => setZipArea(e.target.checked)} /> ZIP area (same first 3 digits — approximate)
          </label>
          <select aria-label="Availability" value={availability} onChange={(e) => setAvailability(e.target.value)}>
            <option value="">Any availability</option>
            <option value="available">Available</option>
            <option value="busy">Busy</option>
            <option value="not_taking_work">Not taking work</option>
          </select>
          <label>
            <input type="checkbox" checked={qualifiedOnly} onChange={(e) => setQualifiedOnly(e.target.checked)} /> License + insurance on file &amp; unexpired
          </label>
          <button type="button" className="cc-btn" onClick={() => setApplied({ trade, city, zip, zipArea, availability, qualifiedOnly })}>
            Search
          </button>
        </div>
        <p className="web-small">
          {search.data ? `${search.data.directoryCount} directory compan${search.data.directoryCount === 1 ? 'y' : 'ies'} · ${search.data.vendorCount} of your vendors` : 'Loading…'}
        </p>
        <ul>
          {(search.data?.items ?? []).map((r) => (
            <li key={`${r.source}-${r.id}`}>
              <strong>{r.name}</strong> ({r.source === 'directory' ? 'directory' : 'your vendor'})
              {r.trades.length ? ` · ${r.trades.join(', ')}` : ''}
              {r.serviceCities.length ? ` · ${r.serviceCities.join(', ')}` : r.serviceAreaLabel ? ` · ${r.serviceAreaLabel}` : ''}
              {r.serviceZips.length ? ` · ZIPs ${r.serviceZips.join(', ')}` : ''}
              {r.availability ? ` · ${prettyStatus(r.availability)}` : ''}
              <div className="web-small">
                License: {statusLabel(r.licenseStatus)}{r.licenseExpiresOn ? ` (exp ${r.licenseExpiresOn})` : ''} ·
                Insurance: {statusLabel(r.insuranceStatus)}{r.insuranceExpiresOn ? ` (exp ${r.insuranceExpiresOn})` : ''}
                {r.contactName ? ` · ${r.contactName}` : ''}{r.contactPhone ? ` · ${r.contactPhone}` : ''}
              </div>
              {r.source === 'directory' ? (
                r.connectionStatus ? (
                  <span className="web-small">Connection: {prettyStatus(r.connectionStatus)}</span>
                ) : canConnect ? (
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => connect.mutate(r)}>Request connection</button>
                ) : null
              ) : null}
            </li>
          ))}
          {(search.data?.items ?? []).length === 0 ? <li>No matches. Directory companies only appear after they opt in and publish a profile.</li> : null}
        </ul>
      </section>

      <section className="cc-panel">
        <h3>Your directory profile</h3>
        {profile.data ? (
          <p className="web-small">
            Directory listing: <strong>{profile.data.directoryOptIn ? 'ON (visible to other companies)' : 'OFF'}</strong> —
            toggle it in Network settings. Trades: {profile.data.trades.join(', ') || 'none set'} · Cities:{' '}
            {profile.data.serviceCities.join(', ') || 'none set'} · ZIPs: {profile.data.serviceZips.join(', ') || 'none set'}
          </p>
        ) : <p>Loading…</p>}
        {canListing ? (
          <div className="cc-grid">
            <input aria-label="Your trades comma separated" placeholder="Trades (comma separated)" value={pTrades} onChange={(e) => setPTrades(e.target.value)} />
            <input aria-label="Your service cities" placeholder="Service cities (comma separated)" value={pCities} onChange={(e) => setPCities(e.target.value)} />
            <input aria-label="Your service ZIPs" placeholder="Service ZIPs (comma separated)" value={pZips} onChange={(e) => setPZips(e.target.value)} />
            <select aria-label="Your availability" value={pAvailability} onChange={(e) => setPAvailability(e.target.value)}>
              <option value="">Availability not set</option>
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="not_taking_work">Not taking work</option>
            </select>
            <input aria-label="License number" placeholder="License #" value={pLicense} onChange={(e) => setPLicense(e.target.value)} />
            <input type="date" aria-label="License expires" value={pLicenseExp} onChange={(e) => setPLicenseExp(e.target.value)} />
            <input type="date" aria-label="Insurance expires" value={pInsuranceExp} onChange={(e) => setPInsuranceExp(e.target.value)} />
            <button type="button" className="cc-btn cc-btn--sm" onClick={() => saveProfile.mutate()}>Save profile</button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Your vendors (private)</h3>
        <ul>
          {(vendors.data?.items ?? []).map((v) => (
            <li key={v.id}>
              <strong>{v.name}</strong>{v.trade ? ` · ${v.trade}` : ''}
              {v.serviceCities.length ? ` · ${v.serviceCities.join(', ')}` : ''}
              {' · '}license {statusLabel(v.licenseStatus)} · insurance {statusLabel(v.insuranceStatus)}
            </li>
          ))}
          {(vendors.data?.items ?? []).length === 0 ? <li>No vendor records yet.</li> : null}
        </ul>
        {canVendorWrite ? (
          <div className="cc-grid">
            <input aria-label="Vendor name" placeholder="Vendor name" value={vName} onChange={(e) => setVName(e.target.value)} />
            <input aria-label="Vendor trade" placeholder="Trade" value={vTrade} onChange={(e) => setVTrade(e.target.value)} />
            <input aria-label="Vendor contact" placeholder="Contact name" value={vContact} onChange={(e) => setVContact(e.target.value)} />
            <input aria-label="Vendor phone" placeholder="Phone" value={vPhone} onChange={(e) => setVPhone(e.target.value)} />
            <input aria-label="Vendor cities" placeholder="Cities (comma separated)" value={vCities} onChange={(e) => setVCities(e.target.value)} />
            <input aria-label="Vendor ZIPs" placeholder="ZIPs (comma separated)" value={vZips} onChange={(e) => setVZips(e.target.value)} />
            <input type="date" aria-label="Vendor license expires" value={vLicenseExp} onChange={(e) => setVLicenseExp(e.target.value)} />
            <input type="date" aria-label="Vendor insurance expires" value={vInsuranceExp} onChange={(e) => setVInsuranceExp(e.target.value)} />
            <button type="button" className="cc-btn cc-btn--sm" disabled={!vName.trim()} onClick={() => createVendor.mutate()}>Add vendor</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
