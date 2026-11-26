'use client';

// Home sales (builder operations): the prospect pipeline with buyer AND agent dual
// tracking, appointment booking, and sales contracts. Contract selections live in the
// Design Center. Email campaigns stay gated on the mailer — nothing here sends email.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateTime, money, parseDollarsToMinor, prettyStatus } from './shared';

const Prospect = z.object({
  id: z.string(),
  buyerName: z.string(),
  buyerEmail: z.string().nullable(),
  buyerPhone: z.string().nullable(),
  agentName: z.string().nullable(),
  agentEmail: z.string().nullable(),
  agentPhone: z.string().nullable(),
  agentBrokerage: z.string().nullable(),
  stage: z.string(),
  communityName: z.string().nullable(),
  budgetMinor: z.number().nullable(),
  currency: z.string(),
  notes: z.string().nullable(),
  customerId: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Appointment = z.object({
  id: z.string(),
  prospectId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  location: z.string().nullable(),
  note: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Selection = z.object({
  id: z.string(),
  contractId: z.string(),
  optionId: z.string(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const Contract = z.object({
  id: z.string(),
  prospectId: z.string(),
  status: z.string(),
  communityName: z.string().nullable(),
  lotLabel: z.string().nullable(),
  planName: z.string().nullable(),
  basePriceMinor: z.number().nullable(),
  currency: z.string(),
  studioHouseId: z.string().nullable(),
  jobId: z.string().nullable(),
  signedOn: z.string().nullable(),
  selections: z.array(Selection),
  totalMinor: z.number().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ProspectList = z.object({ items: z.array(Prospect) });
const ProspectDetail = z.object({
  prospect: Prospect,
  appointments: z.array(Appointment),
  contracts: z.array(Contract),
});
const ContractList = z.object({ items: z.array(Contract) });

const STAGES = ['new', 'contacted', 'appointment', 'contract', 'closed', 'lost'];
const CONTRACT_STATUSES = ['draft', 'signed', 'in_design', 'under_construction', 'closed', 'cancelled'];
const APPT_STATUSES = ['booked', 'completed', 'cancelled', 'no_show'];

export function HomeSalesView() {
  return (
    <RouteGate routeId="homeSales">
      <HomeSalesContent />
    </RouteGate>
  );
}

function HomeSalesContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('sales:write');
  const [stageFilter, setStageFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'home-sales', 'prospects', stageFilter),
    queryFn: () =>
      api.get(`/v1/home-sales/prospects${stageFilter ? `?stage=${stageFilter}` : ''}`, { schema: ProspectList }),
  });
  const detail = useQuery({
    queryKey: orgKey(session.orgId, 'home-sales', 'prospect', openId),
    queryFn: () => api.get(`/v1/home-sales/prospects/${openId}`, { schema: ProspectDetail }),
    enabled: Boolean(openId),
  });
  const contracts = useQuery({
    queryKey: orgKey(session.orgId, 'home-sales', 'contracts'),
    queryFn: () => api.get('/v1/home-sales/contracts', { schema: ContractList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'home-sales') });

  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentEmail, setAgentEmail] = useState('');
  const [agentPhone, setAgentPhone] = useState('');
  const [agentBrokerage, setAgentBrokerage] = useState('');
  const [communityName, setCommunityName] = useState('');
  const [budget, setBudget] = useState('');
  const [notes, setNotes] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/home-sales/prospects',
        {
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim() || null,
          buyerPhone: buyerPhone.trim() || null,
          agentName: agentName.trim() || null,
          agentEmail: agentEmail.trim() || null,
          agentPhone: agentPhone.trim() || null,
          agentBrokerage: agentBrokerage.trim() || null,
          communityName: communityName.trim() || null,
          budgetMinor: parseDollarsToMinor(budget),
          notes: notes.trim() || null,
        },
        { schema: Prospect },
      ),
    onSuccess: () => {
      setBuyerName('');
      setBuyerEmail('');
      setBuyerPhone('');
      setAgentName('');
      setAgentEmail('');
      setAgentPhone('');
      setAgentBrokerage('');
      setCommunityName('');
      setBudget('');
      setNotes('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateProspect = useMutation({
    mutationFn: (input: { id: string; stage: string }) =>
      api.patch(`/v1/home-sales/prospects/${input.id}`, { stage: input.stage }, { schema: Prospect }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [apptStart, setApptStart] = useState('');
  const [apptEnd, setApptEnd] = useState('');
  const [apptLocation, setApptLocation] = useState('');
  const createAppt = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/home-sales/prospects/${openId}/appointments`,
        {
          startsAt: new Date(apptStart).toISOString(),
          endsAt: new Date(apptEnd).toISOString(),
          location: apptLocation.trim() || null,
        },
        { schema: Appointment },
      ),
    onSuccess: () => {
      setApptStart('');
      setApptEnd('');
      setApptLocation('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateAppt = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/home-sales/appointments/${input.id}`, { status: input.status }, { schema: Appointment }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [contractCommunity, setContractCommunity] = useState('');
  const [contractLot, setContractLot] = useState('');
  const [contractPlan, setContractPlan] = useState('');
  const [contractBase, setContractBase] = useState('');
  const createContract = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/home-sales/contracts',
        {
          prospectId: openId,
          communityName: contractCommunity.trim() || null,
          lotLabel: contractLot.trim() || null,
          planName: contractPlan.trim() || null,
          basePriceMinor: parseDollarsToMinor(contractBase),
        },
        { schema: Contract },
      ),
    onSuccess: () => {
      setContractCommunity('');
      setContractLot('');
      setContractPlan('');
      setContractBase('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateContract = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/home-sales/contracts/${input.id}`, { status: input.status }, { schema: Contract }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!buyerName.trim()) {
      setError('Enter the buyer name.');
      return;
    }
    setError('');
    create.mutate();
  };

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Home Sales"
        description="Your prospect pipeline: track the homebuyer and their real estate agent together, book appointments, and start sales contracts. Priced selections are managed in the Design Center."
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="prospect-create-title">
          <h2 id="prospect-create-title">Add a prospect</h2>
          <form className="cc-work-board__form" onSubmit={submit}>
            <label>Buyer name<input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></label>
            <label>Buyer email<input value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} /></label>
            <label>Buyer phone<input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} /></label>
            <label>Agent name<input value={agentName} onChange={(e) => setAgentName(e.target.value)} /></label>
            <label>Agent email<input value={agentEmail} onChange={(e) => setAgentEmail(e.target.value)} /></label>
            <label>Agent phone<input value={agentPhone} onChange={(e) => setAgentPhone(e.target.value)} /></label>
            <label>Agent brokerage<input value={agentBrokerage} onChange={(e) => setAgentBrokerage(e.target.value)} /></label>
            <label>Community<input value={communityName} onChange={(e) => setCommunityName(e.target.value)} /></label>
            <label>Budget ($, optional)<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            <label>Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>Add prospect</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="prospect-list-title">
        <h2 id="prospect-list-title">Prospects</h2>
        <label>
          Stage
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{prettyStatus(s)}</option>
            ))}
          </select>
        </label>
        {list.isError && <ErrorNotice error={list.error} title="Could not load prospects" />}
        {list.isPending && <p className="web-muted">Loading…</p>}
        {list.data && list.data.items.length === 0 && <p className="web-muted">No prospects yet.</p>}
        {list.data && list.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Buyer</th><th>Agent</th><th>Community</th><th>Budget</th><th>Stage</th><th></th></tr></thead>
              <tbody>
                {list.data.items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.buyerName}</td>
                    <td>{p.agentName ?? '—'}</td>
                    <td>{p.communityName ?? '—'}</td>
                    <td>{money(p.budgetMinor, p.currency)}</td>
                    <td>
                      {canWrite ? (
                        <select
                          aria-label={`Stage for ${p.buyerName}`}
                          value={p.stage}
                          onChange={(e) => updateProspect.mutate({ id: p.id, stage: e.target.value })}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{prettyStatus(s)}</option>
                          ))}
                        </select>
                      ) : (
                        prettyStatus(p.stage)
                      )}
                    </td>
                    <td>
                      <button type="button" className="cc-btn" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                        {openId === p.id ? 'Close' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openId && detail.data && (
        <section className="web-card" aria-labelledby="prospect-detail-title">
          <h2 id="prospect-detail-title">{detail.data.prospect.buyerName}</h2>
          <p className="web-muted">
            Buyer: {detail.data.prospect.buyerEmail ?? '—'} · {detail.data.prospect.buyerPhone ?? '—'}
            {detail.data.prospect.agentName
              ? ` · Agent: ${detail.data.prospect.agentName}${detail.data.prospect.agentBrokerage ? ` (${detail.data.prospect.agentBrokerage})` : ''} · ${detail.data.prospect.agentEmail ?? '—'} · ${detail.data.prospect.agentPhone ?? '—'}`
              : ' · No agent'}
          </p>
          {detail.data.prospect.notes && <p>{detail.data.prospect.notes}</p>}

          <h3>Appointments</h3>
          {detail.data.appointments.length === 0 && <p className="web-muted">No appointments yet.</p>}
          {detail.data.appointments.map((a) => (
            <div key={a.id} className="cc-detail-row">
              <div>
                {dateTime(a.startsAt)} – {dateTime(a.endsAt)}
                {a.location ? ` · ${a.location}` : ''} · {prettyStatus(a.status)}
              </div>
              {canWrite && (
                <select
                  aria-label="Appointment status"
                  value={a.status}
                  onChange={(e) => updateAppt.mutate({ id: a.id, status: e.target.value })}
                >
                  {APPT_STATUSES.map((s) => (
                    <option key={s} value={s}>{prettyStatus(s)}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          {canWrite && (
            <form
              className="cc-work-board__form"
              onSubmit={(e) => {
                e.preventDefault();
                if (!apptStart || !apptEnd) {
                  setError('Pick a start and end time.');
                  return;
                }
                setError('');
                createAppt.mutate();
              }}
            >
              <label>Starts<input type="datetime-local" value={apptStart} onChange={(e) => setApptStart(e.target.value)} /></label>
              <label>Ends<input type="datetime-local" value={apptEnd} onChange={(e) => setApptEnd(e.target.value)} /></label>
              <label>Location<input value={apptLocation} onChange={(e) => setApptLocation(e.target.value)} /></label>
              <button type="submit" className="cc-btn cc-btn--primary" disabled={createAppt.isPending}>Book appointment</button>
            </form>
          )}

          <h3>Contracts</h3>
          {detail.data.contracts.length === 0 && <p className="web-muted">No contracts yet.</p>}
          {detail.data.contracts.map((c) => (
            <div key={c.id} className="cc-detail-row">
              <div>
                <strong>{c.planName ?? 'Unnamed plan'}</strong>
                {c.lotLabel ? ` · Lot ${c.lotLabel}` : ''} · {prettyStatus(c.status)} · Total:{' '}
                {money(c.totalMinor, c.currency)} ({c.selections.length} selections)
              </div>
              {canWrite && (
                <select
                  aria-label="Contract status"
                  value={c.status}
                  onChange={(e) => updateContract.mutate({ id: c.id, status: e.target.value })}
                >
                  {CONTRACT_STATUSES.map((s) => (
                    <option key={s} value={s}>{prettyStatus(s)}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
          {canWrite && (
            <form
              className="cc-work-board__form"
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                createContract.mutate();
              }}
            >
              <label>Community<input value={contractCommunity} onChange={(e) => setContractCommunity(e.target.value)} /></label>
              <label>Lot<input value={contractLot} onChange={(e) => setContractLot(e.target.value)} /></label>
              <label>Plan name<input value={contractPlan} onChange={(e) => setContractPlan(e.target.value)} /></label>
              <label>Base price ($, optional)<input inputMode="decimal" value={contractBase} onChange={(e) => setContractBase(e.target.value)} /></label>
              <button type="submit" className="cc-btn cc-btn--primary" disabled={createContract.isPending}>Start contract</button>
            </form>
          )}
          <p className="web-muted">Add priced selections to a contract in the Design Center.</p>
        </section>
      )}

      <section className="web-card" aria-labelledby="contract-list-title">
        <h2 id="contract-list-title">All contracts</h2>
        {contracts.isError && <ErrorNotice error={contracts.error} title="Could not load contracts" />}
        {contracts.data && contracts.data.items.length === 0 && <p className="web-muted">No contracts yet.</p>}
        {contracts.data && contracts.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Lot</th><th>Status</th><th>Base</th><th>Selections</th><th>Total</th></tr></thead>
              <tbody>
                {contracts.data.items.map((c) => (
                  <tr key={c.id}>
                    <td>{c.planName ?? '—'}</td>
                    <td>{c.lotLabel ?? '—'}</td>
                    <td>{prettyStatus(c.status)}</td>
                    <td>{money(c.basePriceMinor, c.currency)}</td>
                    <td>{c.selections.length}</td>
                    <td>{money(c.totalMinor, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
