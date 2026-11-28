'use client';

// Land management (builder operations): communities → phases → lots → houses, readable at
// every level. The house detail assembles the real linked records: lot/phase/community,
// the House Studio plan spec, the sales contract with its selection sheet, job cost,
// schedule, drawings, and warranty history. Land contracts are paid in progress draws with
// approvals; SWPPP inspections record observations (not a compliance guarantee).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, money, parseDollarsToMinor, prettyStatus } from './shared';

const Community = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  county: z.string().nullable(),
  status: z.string(),
  notes: z.string().nullable(),
  lotCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Phase = z.object({
  id: z.string(),
  communityId: z.string(),
  name: z.string(),
  status: z.string(),
  plannedLotCount: z.number().nullable(),
  notes: z.string().nullable(),
  lotCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const Lot = z.object({
  id: z.string(),
  communityId: z.string(),
  phaseId: z.string().nullable(),
  lotNumber: z.string(),
  block: z.string().nullable(),
  status: z.string(),
  priceMinor: z.number().nullable(),
  currency: z.string(),
  widthFt: z.number().nullable(),
  depthFt: z.number().nullable(),
  releasedOn: z.string().nullable(),
  contractId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const House = z.object({
  id: z.string(),
  lotId: z.string(),
  planName: z.string().nullable(),
  studioHouseId: z.string().nullable(),
  contractId: z.string().nullable(),
  jobId: z.string().nullable(),
  status: z.string(),
  addressLine: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const CommunityList = z.object({ items: z.array(Community) });
const CommunityDetail = z.object({
  community: Community,
  phases: z.array(Phase),
  lots: z.array(Lot),
  houses: z.array(House),
  landContracts: z.array(
    z.object({
      id: z.string(),
      vendorName: z.string(),
      scope: z.string(),
      contractMinor: z.number(),
      status: z.string(),
      paidMinor: z.number(),
    }),
  ),
  swpppInspections: z.array(
    z.object({
      id: z.string(),
      scheduledOn: z.string(),
      status: z.string(),
      findings: z.string().nullable(),
    }),
  ),
});
const HouseDetail = z.object({
  house: House,
  lot: Lot,
  phase: Phase.nullable(),
  community: Community,
  plan: z
    .object({
      studioHouseId: z.string(),
      name: z.string(),
      bedrooms: z.number().nullable(),
      bathrooms: z.number().nullable(),
      stories: z.number().nullable(),
      garage: z.string().nullable(),
      lengthFt: z.number().nullable(),
      widthFt: z.number().nullable(),
      roofPitch: z.number().nullable(),
    })
    .nullable(),
  contract: z
    .object({
      id: z.string(),
      status: z.string(),
      buyerName: z.string(),
      basePriceMinor: z.number().nullable(),
      selectionsTotalMinor: z.number().nullable(),
      selections: z.array(
        z.object({ name: z.string(), category: z.string(), priceMinor: z.number().nullable() }),
      ),
    })
    .nullable(),
  jobCost: z
    .object({
      jobId: z.string(),
      budgetMinor: z.number(),
      actualMinor: z.number(),
      varianceMinor: z.number(),
    })
    .nullable(),
  schedule: z.array(
    z.object({
      id: z.string().optional(),
      title: z.string(),
      startsOn: z.string().nullable(),
      endsOn: z.string().nullable(),
      status: z.string(),
      costCode: z.string().nullable().optional(),
      assigneeOrgId: z.string().nullable().optional(),
      assigneeDisplayName: z.string().nullable().optional(),
    }),
  ),
  draws: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        status: z.string(),
        contractMinor: z.number(),
        requestedMinor: z.number(),
        currency: z.string(),
      }),
    )
    .default([]),
  progressBilling: z
    .array(
      z.object({
        id: z.string(),
        number: z.number(),
        status: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        currentDueMinor: z.number().nullable(),
        currency: z.string(),
      }),
    )
    .default([]),
  purchaseOrders: z
    .array(
      z.object({
        id: z.string(),
        supplierName: z.string(),
        status: z.string(),
        totalMinor: z.number().nullable(),
        currency: z.string(),
        reference: z.string().nullable(),
      }),
    )
    .default([]),
  requisitions: z
    .array(
      z.object({
        id: z.string(),
        status: z.string(),
        costCode: z.string().nullable(),
        supplierName: z.string().nullable(),
        neededBy: z.string().nullable(),
        convertedOrderId: z.string().nullable(),
      }),
    )
    .default([]),
  assignments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string(),
        title: z.string(),
        partnerDisplayName: z.string(),
        status: z.string(),
        emailState: z.string(),
        mirroredJobId: z.string().nullable(),
        createdAt: z.string(),
      }),
    )
    .default([]),
  estimate: z
    .object({
      id: z.string(),
      number: z.string(),
      status: z.string(),
      totalMinor: z.number().nullable(),
      currency: z.string(),
    })
    .nullable()
    .default(null),
  documents: z.array(
    z.object({ id: z.string(), title: z.string(), kind: z.string(), createdAt: z.string() }),
  ),
  warrantyTickets: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      category: z.string(),
      createdAt: z.string(),
    }),
  ),
});
const LandContract = z.object({
  id: z.string(),
  communityId: z.string().nullable(),
  vendorName: z.string(),
  scope: z.string(),
  contractMinor: z.number(),
  currency: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ProgressPay = z.object({
  id: z.string(),
  landContractId: z.string(),
  number: z.number(),
  status: z.string(),
  requestedMinor: z.number(),
  approvedMinor: z.number().nullable(),
  currency: z.string(),
  note: z.string().nullable(),
  decidedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const ProgressPayList = z.object({ items: z.array(ProgressPay) });
const Swppp = z.object({
  id: z.string(),
  communityId: z.string().nullable(),
  jobId: z.string().nullable(),
  scheduledOn: z.string(),
  inspectorName: z.string().nullable(),
  status: z.string(),
  findings: z.string().nullable(),
  correctiveActionDueOn: z.string().nullable(),
  photoMediaIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const SwpppList = z.object({ items: z.array(Swppp) });
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const JobsList = z.object({ items: z.array(Job) });
const StudioHouse = z.object({ id: z.string(), name: z.string() });
const StudioList = z.object({ items: z.array(StudioHouse) }).passthrough();
const SalesContract = z.object({
  id: z.string(),
  planName: z.string().nullable(),
  lotLabel: z.string().nullable(),
  status: z.string(),
});
const SalesContractList = z.object({ items: z.array(SalesContract) }).passthrough();
const Template = z.object({ id: z.string(), name: z.string(), active: z.boolean() });
const TemplateList = z.object({ items: z.array(Template) }).passthrough();
const Connection = z.object({
  partnerOrgId: z.string(),
  partnerDisplayName: z.string(),
  status: z.string(),
});
const ConnectionList = z.object({ items: z.array(Connection) }).passthrough();
const StartBuildResult = z.object({
  houseId: z.string(),
  jobId: z.string(),
  jobNumber: z.string(),
  created: z.boolean(),
  budgetLinesCreated: z.number(),
  budgetLinesSkipped: z.number(),
  scheduleTasksCreated: z.number(),
  estimatedValueMinor: z.number().nullable(),
  note: z.string(),
});
const AssignBuildResult = z.object({
  id: z.string(),
  title: z.string(),
  partnerDisplayName: z.string(),
  status: z.string(),
  emailState: z.string(),
  emailNote: z.string().nullable(),
});
const StudioEstimateSnapshot = z.object({
  estimateId: z.string(),
  number: z.string(),
  revisionNumber: z.number(),
  totalMinor: z.number(),
  basis: z.string(),
});

const LOT_STATUSES = ['held', 'released', 'available', 'reserved', 'under_contract', 'sold', 'closed'];
const HOUSE_STATUSES = ['planned', 'under_construction', 'complete', 'sold', 'closed'];
const PHASE_STATUSES = ['planned', 'developing', 'released', 'complete'];
const SWPPP_STATUSES = ['scheduled', 'completed', 'corrective_action', 'cancelled'];

export function LandManagementView() {
  return (
    <RouteGate routeId="landManagement">
      <LandManagementContent />
    </RouteGate>
  );
}

function LandManagementContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('land_management:write');
  const [communityId, setCommunityId] = useState('');
  const [houseId, setHouseId] = useState('');
  const [error, setError] = useState('');

  const communities = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'communities'),
    queryFn: () => api.get('/v1/land-management/communities', { schema: CommunityList }),
  });
  const detail = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'community', communityId),
    queryFn: () => api.get(`/v1/land-management/communities/${communityId}`, { schema: CommunityDetail }),
    enabled: Boolean(communityId),
  });
  const houseDetail = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'house', houseId),
    queryFn: () => api.get(`/v1/land-management/houses/${houseId}`, { schema: HouseDetail }),
    enabled: Boolean(houseId),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const studios = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'studios'),
    queryFn: () => api.get('/v1/studio-houses', { schema: StudioList }),
  });
  const salesContracts = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'sales-contracts'),
    queryFn: () => api.get('/v1/home-sales/contracts', { schema: SalesContractList }),
  });
  const swppp = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'swppp'),
    queryFn: () => api.get('/v1/land-management/swppp-inspections', { schema: SwpppList }),
  });
  const templates = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'templates'),
    queryFn: () => api.get('/v1/estimate-templates', { schema: TemplateList }),
  });
  const connections = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'connections'),
    queryFn: () => api.get('/v1/network/connections', { schema: ConnectionList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'land') });

  const [cName, setCName] = useState('');
  const [cCity, setCCity] = useState('');
  const [cCounty, setCCounty] = useState('');
  const createCommunity = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/land-management/communities',
        { name: cName.trim(), city: cCity.trim() || null, county: cCounty.trim() || null },
        { schema: Community },
      ),
    onSuccess: (c) => {
      setCName('');
      setCCity('');
      setCCounty('');
      setError('');
      setCommunityId(c.id);
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [phaseName, setPhaseName] = useState('');
  const [phaseCount, setPhaseCount] = useState('');
  const createPhase = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/land-management/communities/${communityId}/phases`,
        { name: phaseName.trim(), plannedLotCount: phaseCount ? Number(phaseCount) : null },
        { schema: Phase },
      ),
    onSuccess: () => {
      setPhaseName('');
      setPhaseCount('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updatePhase = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/land-management/phases/${input.id}`, { status: input.status }, { schema: Phase }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [lotNumber, setLotNumber] = useState('');
  const [lotPhase, setLotPhase] = useState('');
  const [lotBlock, setLotBlock] = useState('');
  const [lotPrice, setLotPrice] = useState('');
  const [lotWidth, setLotWidth] = useState('');
  const [lotDepth, setLotDepth] = useState('');
  const createLot = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/land-management/communities/${communityId}/lots`,
        {
          lotNumber: lotNumber.trim(),
          phaseId: lotPhase || null,
          block: lotBlock.trim() || null,
          priceMinor: parseDollarsToMinor(lotPrice),
          widthFt: lotWidth ? Number(lotWidth) : null,
          depthFt: lotDepth ? Number(lotDepth) : null,
        },
        { schema: Lot },
      ),
    onSuccess: () => {
      setLotNumber('');
      setLotBlock('');
      setLotPrice('');
      setLotWidth('');
      setLotDepth('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateLot = useMutation({
    mutationFn: (input: { id: string; status?: string; priceMinor?: number | null }) =>
      api.patch(`/v1/land-management/lots/${input.id}`, { status: input.status, priceMinor: input.priceMinor }, { schema: Lot }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [houseLotId, setHouseLotId] = useState('');
  const [housePlan, setHousePlan] = useState('');
  const [houseStudio, setHouseStudio] = useState('');
  const [houseContract, setHouseContract] = useState('');
  const [houseJob, setHouseJob] = useState('');
  const [houseAddress, setHouseAddress] = useState('');
  const createHouse = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/land-management/lots/${houseLotId}/house`,
        {
          planName: housePlan.trim() || null,
          studioHouseId: houseStudio || null,
          contractId: houseContract || null,
          jobId: houseJob || null,
          addressLine: houseAddress.trim() || null,
        },
        { schema: House },
      ),
    onSuccess: (h) => {
      setHousePlan('');
      setHouseAddress('');
      setError('');
      setHouseId(h.id);
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const updateHouse = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/land-management/houses/${input.id}`, { status: input.status }, { schema: House }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [lcVendor, setLcVendor] = useState('');
  const [lcScope, setLcScope] = useState('');
  const [lcAmt, setLcAmt] = useState('');
  const createLandContract = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/land-management/contracts',
        {
          vendorName: lcVendor.trim(),
          scope: lcScope.trim(),
          contractMinor: parseDollarsToMinor(lcAmt) ?? 0,
          communityId: communityId || null,
        },
        { schema: LandContract },
      ),
    onSuccess: () => {
      setLcVendor('');
      setLcScope('');
      setLcAmt('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [ppContractId, setPpContractId] = useState('');
  const [ppAmt, setPpAmt] = useState('');
  const progressPays = useQuery({
    queryKey: orgKey(session.orgId, 'land', 'progress-pays', ppContractId),
    queryFn: () =>
      api.get(`/v1/land-management/contracts/${ppContractId}/progress-pays`, { schema: ProgressPayList }),
    enabled: Boolean(ppContractId),
  });
  const createProgressPay = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/land-management/contracts/${ppContractId}/progress-pays`,
        { requestedMinor: parseDollarsToMinor(ppAmt) ?? 0 },
        { schema: ProgressPay },
      ),
    onSuccess: () => {
      setPpAmt('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });
  const decideProgressPay = useMutation({
    mutationFn: (input: { id: string; decision: string }) =>
      api.post(`/v1/land-management/progress-pays/${input.id}/decide`, { decision: input.decision }, { schema: ProgressPay }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [swDate, setSwDate] = useState('');
  const [swInspector, setSwInspector] = useState('');
  const createSwppp = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/land-management/swppp-inspections',
        { scheduledOn: swDate, inspectorName: swInspector.trim() || null, communityId: communityId || null },
        { schema: Swppp },
      ),
    onSuccess: () => {
      setSwDate('');
      setSwInspector('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });
  const updateSwppp = useMutation({
    mutationFn: (input: { id: string; status: string }) =>
      api.patch(`/v1/land-management/swppp-inspections/${input.id}`, { status: input.status }, { schema: Swppp }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitCommunity = (event: FormEvent) => {
    event.preventDefault();
    if (!cName.trim()) {
      setError('Enter a community name.');
      return;
    }
    setError('');
    createCommunity.mutate();
  };

  // ---------------------------------------------------------- start build + assign build
  const [notice, setNotice] = useState('');
  const [sbSource, setSbSource] = useState<'studio_estimate' | 'template' | 'none'>('studio_estimate');
  const [sbTemplate, setSbTemplate] = useState('');
  const [sbStart, setSbStart] = useState('');
  const [sbTitle, setSbTitle] = useState('');
  const startBuild = useMutation({
    mutationFn: (id: string) =>
      api.post(
        `/v1/land-management/houses/${id}/start-build`,
        {
          budgetSource: sbSource,
          templateId: sbTemplate || null,
          startDate: sbStart || null,
          title: sbTitle.trim() || null,
        },
        { schema: StartBuildResult },
      ),
    onSuccess: (r) => {
      setError('');
      setNotice(
        r.created
          ? `Build started: job ${r.jobNumber} created with ${r.budgetLinesCreated} budget line(s)` +
              `${r.budgetLinesSkipped ? ` (${r.budgetLinesSkipped} unpriced skipped)` : ''} and ${r.scheduleTasksCreated} schedule task(s). ${r.note}`
          : `This house already has job ${r.jobNumber} — nothing was duplicated.`,
      );
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [abPartner, setAbPartner] = useState('');
  const [abTitle, setAbTitle] = useState('');
  const [abDue, setAbDue] = useState('');
  const assignHouseBuild = useMutation({
    mutationFn: (id: string) =>
      api.post(
        `/v1/land-management/houses/${id}/assign-build`,
        { partnerOrgId: abPartner, title: abTitle.trim() || null, dueOn: abDue || null },
        { schema: AssignBuildResult },
      ),
    onSuccess: (r) => {
      setError('');
      setNotice(
        `Build assigned to ${r.partnerDisplayName}. They see it in Field Pro right away and can accept it there; accepting creates their job for this build.` +
          (r.emailState === 'not_connected' ? ' Email is not connected yet, so no email was sent.' : ''),
      );
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [phasePartner, setPhasePartner] = useState<Record<string, string>>({});
  const assignPhaseBuild = useMutation({
    mutationFn: (input: { id: string; partnerOrgId: string }) =>
      api.post(
        `/v1/land-management/phases/${input.id}/assign-build`,
        { partnerOrgId: input.partnerOrgId },
        { schema: AssignBuildResult },
      ),
    onSuccess: (r) => {
      setError('');
      setNotice(
        `Phase assigned to ${r.partnerDisplayName}. They see it in Field Pro right away; accepting creates their job for this phase.` +
          (r.emailState === 'not_connected' ? ' Email is not connected yet, so no email was sent.' : ''),
      );
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const snapshotEstimate = useMutation({
    mutationFn: (studioHouseId: string) =>
      api.post(`/v1/studio-houses/${studioHouseId}/estimate`, {}, { schema: StudioEstimateSnapshot }),
    onSuccess: (r) => {
      setError('');
      setNotice(
        `Estimate ${r.number} revision ${r.revisionNumber} saved from the House Studio plan: ${money(r.totalMinor)}. ${r.basis}`,
      );
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const activeConnections = (connections.data?.items ?? []).filter((c) => c.status === 'active');
  const activeTemplates = (templates.data?.items ?? []).filter((t) => t.active);

  const houseForLot = (lotId: string) => detail.data?.houses.find((h) => h.lotId === lotId);

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Land Management"
        description="Your developments in full: communities, phases, lots, and the houses on them — each readable in detail with its plan, contract, selections, costs, schedule, documents, and warranty history."
      />
      {error && <p className="web-error" role="alert">{error}</p>}
      {notice && <p className="web-card" role="status">{notice}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="community-create-title">
          <h2 id="community-create-title">New community</h2>
          <form className="cc-work-board__form" onSubmit={submitCommunity}>
            <label>Name<input value={cName} onChange={(e) => setCName(e.target.value)} /></label>
            <label>City<input value={cCity} onChange={(e) => setCCity(e.target.value)} /></label>
            <label>County<input value={cCounty} onChange={(e) => setCCounty(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createCommunity.isPending}>Create community</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="community-pick-title">
        <h2 id="community-pick-title">Community</h2>
        {communities.isError && <ErrorNotice error={communities.error} title="Could not load communities" />}
        <label>
          Choose a community
          <select value={communityId} onChange={(e) => { setCommunityId(e.target.value); setHouseId(''); }}>
            <option value="">Choose a community…</option>
            {(communities.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.lotCount} lots)</option>
            ))}
          </select>
        </label>
        {communities.data && communities.data.items.length === 0 && (
          <p className="web-muted">No communities yet — create one above.</p>
        )}
      </section>

      {communityId && detail.data && (
        <>
          <section className="web-card" aria-labelledby="phases-title">
            <h2 id="phases-title">Phases — {detail.data.community.name}</h2>
            {canWrite && (
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!phaseName.trim()) {
                    setError('Enter a phase name.');
                    return;
                  }
                  setError('');
                  createPhase.mutate();
                }}
              >
                <label>Phase name<input value={phaseName} onChange={(e) => setPhaseName(e.target.value)} placeholder="e.g. Phase 1" /></label>
                <label>Planned lots<input inputMode="numeric" value={phaseCount} onChange={(e) => setPhaseCount(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={createPhase.isPending}>Add phase</button>
              </form>
            )}
            {detail.data.phases.length === 0 && <p className="web-muted">No phases yet.</p>}
            {detail.data.phases.map((p) => (
              <div key={p.id} className="cc-detail-row">
                <div>
                  <strong>{p.name}</strong> — {prettyStatus(p.status)} · {p.lotCount} lots
                  {p.plannedLotCount !== null ? ` of ${p.plannedLotCount} planned` : ''}
                  {session.check('assignment:write') && (
                    <form
                      className="cc-work-board__form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const partnerOrgId = phasePartner[p.id] ?? '';
                        if (!partnerOrgId) {
                          setError('Pick a connected company to assign this phase to.');
                          return;
                        }
                        setError('');
                        assignPhaseBuild.mutate({ id: p.id, partnerOrgId });
                      }}
                    >
                      <label>
                        Assign this phase to
                        <select
                          value={phasePartner[p.id] ?? ''}
                          onChange={(e) => setPhasePartner((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        >
                          <option value="">Choose a connected company…</option>
                          {activeConnections.map((c) => (
                            <option key={c.partnerOrgId} value={c.partnerOrgId}>{c.partnerDisplayName}</option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className="cc-btn" disabled={assignPhaseBuild.isPending}>
                        Assign build
                      </button>
                    </form>
                  )}
                </div>
                {canWrite && (
                  <select
                    aria-label={`Status for ${p.name}`}
                    value={p.status}
                    onChange={(e) => updatePhase.mutate({ id: p.id, status: e.target.value })}
                  >
                    {PHASE_STATUSES.map((s) => (
                      <option key={s} value={s}>{prettyStatus(s)}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </section>

          <section className="web-card" aria-labelledby="lots-title">
            <h2 id="lots-title">Lots</h2>
            {canWrite && (
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!lotNumber.trim()) {
                    setError('Enter a lot number.');
                    return;
                  }
                  setError('');
                  createLot.mutate();
                }}
              >
                <label>Lot number<input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} /></label>
                <label>
                  Phase
                  <select value={lotPhase} onChange={(e) => setLotPhase(e.target.value)}>
                    <option value="">No phase</option>
                    {detail.data.phases.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label>Block<input value={lotBlock} onChange={(e) => setLotBlock(e.target.value)} /></label>
                <label>Price ($, optional)<input inputMode="decimal" value={lotPrice} onChange={(e) => setLotPrice(e.target.value)} /></label>
                <label>Width (ft)<input inputMode="decimal" value={lotWidth} onChange={(e) => setLotWidth(e.target.value)} /></label>
                <label>Depth (ft)<input inputMode="decimal" value={lotDepth} onChange={(e) => setLotDepth(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={createLot.isPending}>Add lot</button>
              </form>
            )}
            {detail.data.lots.length === 0 && <p className="web-muted">No lots yet.</p>}
            {detail.data.lots.length > 0 && (
              <div className="cc-table-wrap">
                <table>
                  <thead><tr><th>Lot</th><th>Block</th><th>Status</th><th>Price</th><th>Size</th><th>Released</th><th>House</th></tr></thead>
                  <tbody>
                    {detail.data.lots.map((l) => {
                      const house = houseForLot(l.id);
                      return (
                        <tr key={l.id}>
                          <td>{l.lotNumber}</td>
                          <td>{l.block ?? '—'}</td>
                          <td>
                            {canWrite ? (
                              <select
                                aria-label={`Status for lot ${l.lotNumber}`}
                                value={l.status}
                                onChange={(e) => updateLot.mutate({ id: l.id, status: e.target.value })}
                              >
                                {LOT_STATUSES.map((s) => (
                                  <option key={s} value={s}>{prettyStatus(s)}</option>
                                ))}
                              </select>
                            ) : (
                              prettyStatus(l.status)
                            )}
                          </td>
                          <td>{money(l.priceMinor, l.currency)}</td>
                          <td>{l.widthFt && l.depthFt ? `${l.widthFt} × ${l.depthFt} ft` : '—'}</td>
                          <td>{l.releasedOn ?? '—'}</td>
                          <td>
                            {house ? (
                              <button type="button" className="cc-btn" onClick={() => setHouseId(house.id)}>
                                {house.planName ?? 'House'} ({prettyStatus(house.status)})
                              </button>
                            ) : (
                              <span className="web-muted">None</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {canWrite && (
            <section className="web-card" aria-labelledby="house-create-title">
              <h2 id="house-create-title">Place a house on a lot</h2>
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!houseLotId) {
                    setError('Pick a lot for the house.');
                    return;
                  }
                  setError('');
                  createHouse.mutate();
                }}
              >
                <label>
                  Lot
                  <select value={houseLotId} onChange={(e) => setHouseLotId(e.target.value)}>
                    <option value="">Choose a lot…</option>
                    {detail.data.lots.filter((l) => !houseForLot(l.id)).map((l) => (
                      <option key={l.id} value={l.id}>Lot {l.lotNumber}</option>
                    ))}
                  </select>
                </label>
                <label>Plan name<input value={housePlan} onChange={(e) => setHousePlan(e.target.value)} /></label>
                <label>
                  House Studio house
                  <select value={houseStudio} onChange={(e) => setHouseStudio(e.target.value)}>
                    <option value="">Not linked</option>
                    {(studios.data?.items ?? []).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Sales contract
                  <select value={houseContract} onChange={(e) => setHouseContract(e.target.value)}>
                    <option value="">Not linked</option>
                    {(salesContracts.data?.items ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.planName ?? 'Contract'}{c.lotLabel ? ` · Lot ${c.lotLabel}` : ''}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Construction job
                  <select value={houseJob} onChange={(e) => setHouseJob(e.target.value)}>
                    <option value="">Not linked</option>
                    {(jobs.data?.items ?? []).map((j) => (
                      <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                    ))}
                  </select>
                </label>
                <label>Address<input value={houseAddress} onChange={(e) => setHouseAddress(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={createHouse.isPending}>Place house</button>
              </form>
            </section>
          )}

          <section className="web-card" aria-labelledby="land-contracts-title">
            <h2 id="land-contracts-title">Land development contracts</h2>
            {canWrite && (
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!lcVendor.trim() || !lcScope.trim() || parseDollarsToMinor(lcAmt) === null) {
                    setError('Enter the vendor, scope, and contract amount.');
                    return;
                  }
                  setError('');
                  createLandContract.mutate();
                }}
              >
                <label>Vendor<input value={lcVendor} onChange={(e) => setLcVendor(e.target.value)} /></label>
                <label>Scope<input value={lcScope} onChange={(e) => setLcScope(e.target.value)} /></label>
                <label>Contract amount ($)<input inputMode="decimal" value={lcAmt} onChange={(e) => setLcAmt(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={createLandContract.isPending}>Create contract</button>
              </form>
            )}
            {detail.data.landContracts.length === 0 && <p className="web-muted">No land contracts for this community.</p>}
            {detail.data.landContracts.map((c) => (
              <div key={c.id} className="cc-detail-row">
                <div>
                  <strong>{c.vendorName}</strong> — {c.scope} · {money(c.contractMinor)} · Paid {money(c.paidMinor)} · {prettyStatus(c.status)}
                </div>
                <button type="button" className="cc-btn" onClick={() => setPpContractId(ppContractId === c.id ? '' : c.id)}>
                  Progress pay
                </button>
              </div>
            ))}
            {ppContractId && (
              <>
                {canWrite && (
                  <form
                    className="cc-work-board__form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (parseDollarsToMinor(ppAmt) === null) {
                        setError('Enter the amount requested.');
                        return;
                      }
                      setError('');
                      createProgressPay.mutate();
                    }}
                  >
                    <label>Amount requested ($)<input inputMode="decimal" value={ppAmt} onChange={(e) => setPpAmt(e.target.value)} /></label>
                    <button type="submit" className="cc-btn cc-btn--primary" disabled={createProgressPay.isPending}>Request progress pay</button>
                  </form>
                )}
                {progressPays.data && progressPays.data.items.length === 0 && <p className="web-muted">No progress pays yet.</p>}
                {progressPays.data && progressPays.data.items.length > 0 && (
                  <div className="cc-table-wrap">
                    <table>
                      <thead><tr><th>#</th><th>Status</th><th>Requested</th><th>Approved</th><th>Paid</th>{canWrite && <th>Actions</th>}</tr></thead>
                      <tbody>
                        {progressPays.data.items.map((p) => (
                          <tr key={p.id}>
                            <td>{p.number}</td>
                            <td>{prettyStatus(p.status)}</td>
                            <td>{money(p.requestedMinor, p.currency)}</td>
                            <td>{money(p.approvedMinor, p.currency)}</td>
                            <td>{dateOnly(p.paidAt)}</td>
                            {canWrite && (
                              <td>
                                {p.status === 'requested' && (
                                  <>
                                    <button type="button" className="cc-btn" onClick={() => decideProgressPay.mutate({ id: p.id, decision: 'approve' })}>Approve</button>{' '}
                                    <button type="button" className="cc-btn" onClick={() => decideProgressPay.mutate({ id: p.id, decision: 'reject' })}>Reject</button>
                                  </>
                                )}
                                {p.status === 'approved' && (
                                  <button type="button" className="cc-btn" onClick={() => decideProgressPay.mutate({ id: p.id, decision: 'mark_paid' })}>Mark paid</button>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {houseId && houseDetail.data && (
        <section className="web-card" aria-labelledby="house-detail-title">
          <h2 id="house-detail-title">
            House — Lot {houseDetail.data.lot.lotNumber}, {houseDetail.data.community.name}
          </h2>
          <p className="web-muted">
            {houseDetail.data.house.planName ?? 'No plan name'} · {prettyStatus(houseDetail.data.house.status)}
            {houseDetail.data.house.addressLine ? ` · ${houseDetail.data.house.addressLine}` : ''}
            {houseDetail.data.phase ? ` · ${houseDetail.data.phase.name}` : ''}
          </p>
          {canWrite && (
            <label>
              House status
              <select
                value={houseDetail.data.house.status}
                onChange={(e) => updateHouse.mutate({ id: houseDetail.data.house.id, status: e.target.value })}
              >
                {HOUSE_STATUSES.map((s) => (
                  <option key={s} value={s}>{prettyStatus(s)}</option>
                ))}
              </select>
            </label>
          )}

          {canWrite && !houseDetail.data.house.jobId && (
            <>
              <h3>Start build</h3>
              <p className="web-muted">
                Create the construction job for this house in one step. Budget lines come from the
                House Studio estimate or a template; the schedule comes from the template.
              </p>
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (sbSource === 'template' && !sbTemplate) {
                    setError('Pick a template to seed the budget from.');
                    return;
                  }
                  if (sbTemplate && !sbStart) {
                    setError('Pick a start date for the template schedule.');
                    return;
                  }
                  setError('');
                  startBuild.mutate(houseDetail.data.house.id);
                }}
              >
                <label>
                  Budget from
                  <select value={sbSource} onChange={(e) => setSbSource(e.target.value as typeof sbSource)}>
                    <option value="studio_estimate">House Studio estimate</option>
                    <option value="template">Template</option>
                    <option value="none">No seeded budget</option>
                  </select>
                </label>
                <label>
                  Template (schedule{sbSource === 'template' ? ' + budget' : ''})
                  <select value={sbTemplate} onChange={(e) => setSbTemplate(e.target.value)}>
                    <option value="">No template</option>
                    {activeTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                <label>Start date<input type="date" value={sbStart} onChange={(e) => setSbStart(e.target.value)} /></label>
                <label>Job title (optional)<input value={sbTitle} onChange={(e) => setSbTitle(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={startBuild.isPending}>
                  Start build
                </button>
              </form>
            </>
          )}

          {session.check('assignment:write') && (
            <>
              <h3>Assign this build</h3>
              <p className="web-muted">
                Hand the whole house build to a connected contracting company. The assignment carries
                a snapshot of the plan, budget, and schedule; when they accept, a job for this build
                is created in their account.
              </p>
              <form
                className="cc-work-board__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!abPartner) {
                    setError('Pick a connected company to assign this build to.');
                    return;
                  }
                  setError('');
                  assignHouseBuild.mutate(houseDetail.data.house.id);
                }}
              >
                <label>
                  Company
                  <select value={abPartner} onChange={(e) => setAbPartner(e.target.value)}>
                    <option value="">Choose a connected company…</option>
                    {activeConnections.map((c) => (
                      <option key={c.partnerOrgId} value={c.partnerOrgId}>{c.partnerDisplayName}</option>
                    ))}
                  </select>
                </label>
                {activeConnections.length === 0 && (
                  <p className="web-muted">No connected companies yet — connect in the Network first.</p>
                )}
                <label>Title (optional)<input value={abTitle} onChange={(e) => setAbTitle(e.target.value)} /></label>
                <label>Due date (optional)<input type="date" value={abDue} onChange={(e) => setAbDue(e.target.value)} /></label>
                <button type="submit" className="cc-btn cc-btn--primary" disabled={assignHouseBuild.isPending}>
                  Assign build
                </button>
              </form>
            </>
          )}

          <h3>Plan</h3>
          {houseDetail.data.plan ? (
            <p>
              {houseDetail.data.plan.name}: {houseDetail.data.plan.bedrooms ?? '—'} bed ·{' '}
              {houseDetail.data.plan.bathrooms ?? '—'} bath · {houseDetail.data.plan.stories ?? '—'} stories ·{' '}
              {houseDetail.data.plan.lengthFt ?? '—'} × {houseDetail.data.plan.widthFt ?? '—'} ft · garage{' '}
              {houseDetail.data.plan.garage ?? '—'} · roof pitch {houseDetail.data.plan.roofPitch ?? '—'}.{' '}
              <a href="/build">Open in House Builder (3D)</a>
            </p>
          ) : (
            <p className="web-muted">No House Studio plan linked.</p>
          )}

          <h3>Estimate</h3>
          {houseDetail.data.estimate ? (
            <p>
              {houseDetail.data.estimate.number} — {prettyStatus(houseDetail.data.estimate.status)} ·{' '}
              {houseDetail.data.estimate.totalMinor === null
                ? 'No total yet'
                : money(houseDetail.data.estimate.totalMinor, houseDetail.data.estimate.currency)}{' '}
              (House Studio planning estimate — NAHB survey model, not a bid)
            </p>
          ) : (
            <p className="web-muted">No estimate saved for this plan yet.</p>
          )}
          {canWrite && houseDetail.data.plan && (
            <button
              type="button"
              className="cc-btn"
              disabled={snapshotEstimate.isPending}
              onClick={() => snapshotEstimate.mutate(houseDetail.data.plan!.studioHouseId)}
            >
              Snapshot estimate from plan
            </button>
          )}

          <h3>Contract & selections</h3>
          {houseDetail.data.contract ? (
            <>
              <p>
                Buyer: {houseDetail.data.contract.buyerName} · {prettyStatus(houseDetail.data.contract.status)} · Base:{' '}
                {money(houseDetail.data.contract.basePriceMinor)} · Selections total:{' '}
                {money(houseDetail.data.contract.selectionsTotalMinor)}
              </p>
              {houseDetail.data.contract.selections.length > 0 && (
                <div className="cc-table-wrap">
                  <table>
                    <thead><tr><th>Selection</th><th>Category</th><th>Price</th></tr></thead>
                    <tbody>
                      {houseDetail.data.contract.selections.map((s, i) => (
                        <tr key={i}>
                          <td>{s.name}</td>
                          <td>{prettyStatus(s.category)}</td>
                          <td>{s.priceMinor === null ? 'Price on request' : money(s.priceMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="web-muted">No sales contract linked.</p>
          )}

          <h3>Job cost</h3>
          {houseDetail.data.jobCost ? (
            <p>
              Budget {money(houseDetail.data.jobCost.budgetMinor)} · Actual {money(houseDetail.data.jobCost.actualMinor)} ·
              Remaining {money(houseDetail.data.jobCost.varianceMinor)} — <a href="/job-cost">Open Job Cost</a>
            </p>
          ) : (
            <p className="web-muted">No construction job linked.</p>
          )}

          <h3>Schedule</h3>
          {houseDetail.data.schedule.length === 0 && <p className="web-muted">No schedule tasks on the linked job.</p>}
          {houseDetail.data.schedule.map((t, i) => (
            <p key={t.id ?? i}>
              {t.title} — {t.startsOn ?? '—'} to {t.endsOn ?? '—'} ({prettyStatus(t.status)})
              {t.costCode ? ` · ${t.costCode}` : ''}
              {t.assigneeDisplayName ? ` · Assigned to ${t.assigneeDisplayName}` : ''}
            </p>
          ))}

          <h3>Draws & progress billing</h3>
          {houseDetail.data.draws.length === 0 && houseDetail.data.progressBilling.length === 0 && (
            <p className="web-muted">No draws or progress-billing applications on the linked job.</p>
          )}
          {houseDetail.data.draws.map((d) => (
            <p key={d.id}>
              Draw {d.number} — {prettyStatus(d.status)} · Requested {money(d.requestedMinor, d.currency)} of{' '}
              {money(d.contractMinor, d.currency)}
            </p>
          ))}
          {houseDetail.data.progressBilling.map((b) => (
            <p key={b.id}>
              Progress billing {b.number} — {prettyStatus(b.status)} · {b.periodStart} to {b.periodEnd}
              {b.currentDueMinor !== null ? ` · Due ${money(b.currentDueMinor, b.currency)}` : ''}
            </p>
          ))}

          <h3>Purchase orders & requisitions</h3>
          {houseDetail.data.purchaseOrders.length === 0 && houseDetail.data.requisitions.length === 0 && (
            <p className="web-muted">No purchase orders or requisitions on the linked job.</p>
          )}
          {houseDetail.data.purchaseOrders.map((po) => (
            <p key={po.id}>
              {po.supplierName} — {prettyStatus(po.status)}
              {po.totalMinor !== null ? ` · ${money(po.totalMinor, po.currency)}` : ''}
              {po.reference ? ` · ${po.reference}` : ''}
            </p>
          ))}
          {houseDetail.data.requisitions.map((r) => (
            <p key={r.id}>
              Requisition — {prettyStatus(r.status)}
              {r.costCode ? ` · ${r.costCode}` : ''}
              {r.supplierName ? ` · ${r.supplierName}` : ''}
              {r.neededBy ? ` · Needed by ${r.neededBy}` : ''}
              {r.convertedOrderId ? ' · Converted to PO' : ''}
            </p>
          ))}

          <h3>Assignments</h3>
          {houseDetail.data.assignments.length === 0 && (
            <p className="web-muted">No assignments made for this house or its job.</p>
          )}
          {houseDetail.data.assignments.map((a) => (
            <p key={a.id}>
              {a.title} — {prettyStatus(a.kind)} to {a.partnerDisplayName} · {prettyStatus(a.status)} ·{' '}
              {dateOnly(a.createdAt)}
              {a.emailState === 'not_connected' ? ' · Email not connected yet' : ''}
              {a.mirroredJobId ? ' · Contractor job created' : ''}
            </p>
          ))}

          <h3>Documents</h3>
          {houseDetail.data.documents.length === 0 && <p className="web-muted">No drawings on the linked job.</p>}
          {houseDetail.data.documents.map((d) => (
            <p key={d.id}>{d.title} ({d.kind}) — {dateOnly(d.createdAt)}</p>
          ))}

          <h3>Warranty history</h3>
          {houseDetail.data.warrantyTickets.length === 0 && <p className="web-muted">No warranty tickets on the linked job.</p>}
          {houseDetail.data.warrantyTickets.map((t) => (
            <p key={t.id}>{t.title} — {prettyStatus(t.status)} ({dateOnly(t.createdAt)})</p>
          ))}
        </section>
      )}

      <section className="web-card" aria-labelledby="swppp-title">
        <h2 id="swppp-title">SWPPP / stormwater inspections</h2>
        <p className="web-muted">Scheduled field checks with findings — records of what was observed, not a compliance guarantee.</p>
        {canWrite && (
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!swDate) {
                setError('Pick a date for the inspection.');
                return;
              }
              setError('');
              createSwppp.mutate();
            }}
          >
            <label>Date<input type="date" value={swDate} onChange={(e) => setSwDate(e.target.value)} /></label>
            <label>Inspector<input value={swInspector} onChange={(e) => setSwInspector(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createSwppp.isPending}>Schedule inspection</button>
          </form>
        )}
        {swppp.isError && <ErrorNotice error={swppp.error} title="Could not load inspections" />}
        {swppp.data && swppp.data.items.length === 0 && <p className="web-muted">No SWPPP inspections yet.</p>}
        {swppp.data && swppp.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Inspector</th><th>Status</th><th>Findings</th><th>Corrective due</th>{canWrite && <th>Move to</th>}</tr></thead>
              <tbody>
                {swppp.data.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.scheduledOn}</td>
                    <td>{s.inspectorName ?? '—'}</td>
                    <td>{prettyStatus(s.status)}</td>
                    <td>{s.findings ?? '—'}</td>
                    <td>{s.correctiveActionDueOn ?? '—'}</td>
                    {canWrite && (
                      <td>
                        <select
                          aria-label={`Status for inspection ${s.scheduledOn}`}
                          value={s.status}
                          onChange={(e) => updateSwppp.mutate({ id: s.id, status: e.target.value })}
                        >
                          {SWPPP_STATUSES.map((x) => (
                            <option key={x} value={x}>{prettyStatus(x)}</option>
                          ))}
                        </select>
                      </td>
                    )}
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
