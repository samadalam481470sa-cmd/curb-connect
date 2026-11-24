'use client';

// House Builder workspace (HB-001..003): footprint + room program -> schematic floor plan ->
// deterministic material takeoff -> priced estimate using the referenced price book, with live
// cheapest-first lookups and retailer links per material. Planning estimate only: no MEP, labor,
// permits or engineering, and the page says so.
import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { RouteGate } from '../../components/RouteGate';
import { AccountDraftStatus, useAccountDraft } from '../../lib/accountDrafts';
import { useApi, useSession } from '../../lib/session';
import { MaterialLookup, OfferList, SupplierLinks } from '../command/MaterialLookup';
import { Kpi, money, money0, num, NumberField, Panel, SelectField } from '../command/Panel';
import { FloorPlan } from './FloorPlan';
import type {
  HouseBriefResponse,
  SiteContextResponse,
  StudioDeal,
  StudioHouse,
  StudioHouseSettings,
  StudioLot,
} from '@fieldline/contracts';
import { StudioHouseSchema } from '@fieldline/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { HouseStudio } from './HouseStudio';
import { LandFeasibility } from './LandFeasibility';
import { AiHouseBrief } from './AiHouseBrief';
import {
  DEFAULT_STUDIO_COSTS,
  type PhaseId,
  type StudioCostSettings,
  studioEstimate,
} from './studioCost';
import { DEFAULT_DEAL, DEFAULT_LOT, ON_HAND_MATERIAL } from './groundUp';
import { StudioWorkbench, useMaterialIndexes } from './StudioWorkbench';
import {
  STUDIO_HOUSES_KEY,
  problemText,
  type CurrentHouse,
  type HouseSnapshot,
} from './StudioHouses';
import { floorPlanSvg, takeoffCsv, designManifest } from './exports';
import { fetchLivePrices } from './live';
import { PRICE_BOOK, type LivePriceResponse, type MaterialId } from './prices';
import {
  computeTakeoff,
  DEFAULT_SPEC,
  priceTakeoff,
  type BuildSpec,
  type PriceOverride,
  type TakeoffGroup,
} from './takeoff';

const DRAFT_KEY = 'fieldpro.build.draft.v1';

interface Costs {
  taxPercent: number;
  deliveryFee: number;
  contingencyPercent: number;
  laborPerSqFt: number;
  mepPerSqFt: number;
}

const DEFAULT_COSTS: Costs = {
  taxPercent: 8.25,
  deliveryFee: 0,
  contingencyPercent: 10,
  laborPerSqFt: 0,
  mepPerSqFt: 0,
};

interface Draft {
  spec: BuildSpec;
  costs: Costs;
  location: string;
  overrides: Partial<Record<MaterialId, PriceOverride>>;
  /** Opt-in: the supplier provider may bill one query per catalog material per daily scan. */
  autoRefreshAll: boolean;
  /** House Studio installed-cost settings (escalation, regional factor). */
  studio?: StudioCostSettings;
  /** House Studio workbench: stock on hand, lot, deal, view, and the saved house being edited. */
  onHand?: Partial<Record<MaterialId, number>>;
  lot?: StudioLot | null;
  deal?: StudioDeal;
  realLife?: boolean;
  autoEscalation?: boolean;
  budgetCents?: number | null;
  house?: CurrentHouse | null;
  brief?: string;
  source?: HouseSnapshot['source'];
}

const clampNum = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

const GROUP_ORDER: readonly TakeoffGroup[] = [
  'Sitework',
  'Foundation',
  'Framing',
  'Roof',
  'Envelope',
  'Openings',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Interior',
  'Finishes',
  'Hardware',
  'Exterior',
];

const BASIS_LABEL = {
  listing: 'listed price',
  typical: 'typical retail',
  live: 'live price',
  manual: 'your price',
} as const;

export function BuildEstimatorView() {
  return (
    <RouteGate routeId="build">
      <BuildWorkspace />
    </RouteGate>
  );
}

function BuildWorkspace() {
  const [spec, setSpec] = useState<BuildSpec>(DEFAULT_SPEC);
  // Undo for whole-house changes made from the command bar, quick build, savings and CAD plan.
  const [history, setHistory] = useState<BuildSpec[]>([]);
  const changeHouse = (next: BuildSpec) => {
    setHistory((h) => [...h.slice(-29), spec]);
    setSpec(next);
  };
  const undoHouse = () => {
    const prev = history[history.length - 1];
    if (!prev) return false;
    setHistory((h) => h.slice(0, -1));
    setSpec(prev);
    return true;
  };
  const [costs, setCosts] = useState<Costs>(DEFAULT_COSTS);
  const [location, setLocation] = useState('Dallas, Texas, United States');
  const [overrides, setOverrides] = useState<Partial<Record<MaterialId, PriceOverride>>>({});
  const [floorIndex, setFloorIndex] = useState(0);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<Record<MaterialId, LivePriceResponse | 'loading'>>>({});
  const [openRow, setOpenRow] = useState<MaterialId | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const autoScanAttempt = useRef('');
  const [dailyPriceStatus, setDailyPriceStatus] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });
  const [autoRefreshAll, setAutoRefreshAll] = useState(false);
  const [studioCosts, setStudioCosts] = useState<StudioCostSettings>(DEFAULT_STUDIO_COSTS);
  const [studioStep, setStudioStep] = useState<PhaseId>(16);
  const [onHand, setOnHand] = useState<Partial<Record<MaterialId, number>>>({});
  const [lot, setLot] = useState<StudioLot | null>(null);
  const [deal, setDeal] = useState<StudioDeal>(DEFAULT_DEAL);
  const [realLife, setRealLife] = useState(false);
  const [autoEscalation, setAutoEscalation] = useState(false);
  const [budgetCents, setBudgetCents] = useState<number | null>(null);
  const [surroundings, setSurroundings] = useState<SiteContextResponse | null>(null);
  const [currentHouse, setCurrentHouse] = useState<CurrentHouse | null>(null);
  const [brief, setBrief] = useState('');
  const [houseSource, setHouseSource] = useState<HouseSnapshot['source']>('manual');
  const [autoSaveNote, setAutoSaveNote] = useState<string | null>(null);
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();

  // Restore / persist the working draft in this browser.
  const cloudDraft = useAccountDraft<Draft>({
    key: 'house-builder',
    legacyKey: DRAFT_KEY,
    value: {
      spec,
      costs,
      location,
      overrides,
      autoRefreshAll,
      studio: studioCosts,
      onHand,
      lot,
      deal,
      realLife,
      autoEscalation,
      budgetCents,
      house: currentHouse,
      brief,
      source: houseSource,
    },
    onRestore: (d) => {
      if (d.spec) setSpec({ ...DEFAULT_SPEC, ...d.spec });
      if (d.costs) setCosts({ ...DEFAULT_COSTS, ...d.costs });
      if (typeof d.location === 'string') setLocation(d.location);
      if (d.overrides && typeof d.overrides === 'object') setOverrides(d.overrides);
      if (typeof d.autoRefreshAll === 'boolean') setAutoRefreshAll(d.autoRefreshAll);
      if (d.studio && typeof d.studio === 'object')
        setStudioCosts({ ...DEFAULT_STUDIO_COSTS, ...d.studio });
      if (d.onHand && typeof d.onHand === 'object') setOnHand(d.onHand);
      if (d.lot !== undefined) setLot(d.lot ?? null);
      if (d.deal && typeof d.deal === 'object') setDeal({ ...DEFAULT_DEAL, ...d.deal });
      if (typeof d.realLife === 'boolean') setRealLife(d.realLife);
      if (typeof d.autoEscalation === 'boolean') setAutoEscalation(d.autoEscalation);
      if (d.budgetCents !== undefined) setBudgetCents(d.budgetCents ?? null);
      if (d.house !== undefined) setCurrentHouse(d.house ?? null);
      if (typeof d.brief === 'string') setBrief(d.brief);
      if (d.source) setHouseSource(d.source);
    },
  });
  const loaded = cloudDraft.ready;

  // Typing stays responsive: the heavy recompute follows a deferred copy of the inputs.
  const deferredSpec = useDeferredValue(spec);
  const takeoff = useMemo(() => computeTakeoff(deferredSpec), [deferredSpec]);
  const priced = useMemo(() => priceTakeoff(takeoff.lines, overrides), [takeoff.lines, overrides]);

  // Official price indexes: checked each time the builder opens; optionally drive escalation.
  const indexes = useMaterialIndexes();
  const liveEscalation = indexes.data?.escalation?.percent;
  if (
    autoEscalation &&
    liveEscalation !== undefined &&
    studioCosts.escalationPercent !== liveEscalation
  ) {
    setStudioCosts({ ...studioCosts, escalationPercent: liveEscalation });
  }
  const studioTotal = useMemo(
    () => studioEstimate(takeoff, studioCosts).total,
    [takeoff, studioCosts],
  );
  // The current house, as the Land feasibility tool places and prices it on each lot.
  const landHome = useMemo(
    () => ({
      widthFt: takeoff.layout.footprint.lengthFt,
      depthFt: takeoff.layout.footprint.widthFt,
      buildCost: Math.round(studioTotal),
    }),
    [takeoff.layout.footprint.lengthFt, takeoff.layout.footprint.widthFt, studioTotal],
  );

  // Saved houses: what gets stored, and how an opened house fills the page.
  const houseSpec = (s: BuildSpec): HouseSnapshot['spec'] => ({
    lengthFt: clampNum(s.lengthFt, 20, 120),
    widthFt: clampNum(s.widthFt, 20, 80),
    stories: s.stories === 2 ? 2 : 1,
    bedrooms: Math.round(clampNum(s.bedrooms, 1, 6)),
    bathrooms: Math.round(clampNum(s.bathrooms, 1, 5)),
    garage: s.garage,
    wallHeightFt: s.wallHeightFt,
    roofPitch: clampNum(s.roofPitch, 2, 14),
    overhangFt: clampNum(s.overhangFt, 0, 4),
    wastePercent: clampNum(s.wastePercent, 0, 40),
    studSpacingIn: s.studSpacingIn,
  });
  const cleanOnHand = (map: Partial<Record<MaterialId, number>>) =>
    Object.fromEntries(
      Object.entries(map)
        .filter(([, n]) => typeof n === 'number' && n > 0)
        .slice(0, 400)
        .map(([k, n]) => [k, clampNum(n as number, 0, 1_000_000)]),
    );
  const houseSettings = (): StudioHouseSettings => ({
    location: location.slice(0, 200),
    escalationPercent: clampNum(studioCosts.escalationPercent, -50, 200),
    regionalFactor: clampNum(studioCosts.regionalFactor, 0.5, 2),
    autoEscalation,
    costs: {
      taxPercent: clampNum(costs.taxPercent, 0, 20),
      deliveryFee: clampNum(costs.deliveryFee, 0, 1_000_000),
      contingencyPercent: clampNum(costs.contingencyPercent, 0, 50),
      laborPerSqFt: clampNum(costs.laborPerSqFt, 0, 1000),
      mepPerSqFt: clampNum(costs.mepPerSqFt, 0, 1000),
    },
    priceOverrides: Object.fromEntries(
      Object.entries(overrides)
        .filter(([, o]) => o && Number.isFinite(o.unitPrice))
        .slice(0, 400)
        .map(([k, o]) => [
          k,
          {
            unitPrice: clampNum(o!.unitPrice, 0, 10_000_000),
            seller: o!.seller.slice(0, 80),
            basis: o!.basis,
          },
        ]),
    ),
    onHand: cleanOnHand(onHand),
    lot,
    deal,
    realLifeView: realLife,
    budgetCents,
  });
  const snapshot = (): HouseSnapshot => ({
    spec: houseSpec(spec),
    settings: houseSettings(),
    brief,
    source: houseSource,
  });
  const openHouse = (house: StudioHouse) => {
    setSpec({
      ...DEFAULT_SPEC,
      ...house.spec,
      overhangFt: house.spec.overhangFt ?? DEFAULT_SPEC.overhangFt,
      wastePercent: house.spec.wastePercent ?? DEFAULT_SPEC.wastePercent,
      studSpacingIn: house.spec.studSpacingIn ?? DEFAULT_SPEC.studSpacingIn,
    });
    const st = house.settings;
    if (st.location) setLocation(st.location);
    if (st.costs) setCosts(st.costs);
    setOverrides((st.priceOverrides ?? {}) as Partial<Record<MaterialId, PriceOverride>>);
    setStudioCosts({
      escalationPercent: st.escalationPercent ?? DEFAULT_STUDIO_COSTS.escalationPercent,
      regionalFactor: st.regionalFactor ?? DEFAULT_STUDIO_COSTS.regionalFactor,
    });
    setAutoEscalation(Boolean(st.autoEscalation));
    setOnHand((st.onHand ?? {}) as Partial<Record<MaterialId, number>>);
    setLot(st.lot ?? null);
    setDeal(st.deal ? { ...DEFAULT_DEAL, ...st.deal } : DEFAULT_DEAL);
    setRealLife(Boolean(st.realLifeView));
    setBudgetCents(st.budgetCents ?? null);
    setSurroundings(null);
    setBrief(house.brief);
    setHouseSource(house.source);
    setLive({});
  };
  // Every AI / plan / typed build is saved straight away so it can be managed or deleted.
  const onBriefResult = (
    result: HouseBriefResponse,
    input: { text: string; fileName: string | null },
  ) => {
    const source: HouseSnapshot['source'] =
      result.source === 'ai' ? 'ai' : result.reading === 'pdf_text' ? 'plan' : 'rules';
    const nextOnHand = { ...onHand };
    for (const h of result.onHand ?? []) nextOnHand[ON_HAND_MATERIAL[h.item]] = h.quantity;
    const nextLot: StudioLot | null = result.lot
      ? {
          ...(lot ?? DEFAULT_LOT),
          address: lot?.address || location,
          widthFt: clampNum(result.lot.widthFt, 20, 5000),
          depthFt: clampNum(result.lot.depthFt, 20, 5000),
        }
      : lot;
    const nextBudget = result.budgetCents ?? budgetCents;
    setOnHand(nextOnHand);
    setLot(nextLot);
    setBudgetCents(nextBudget);
    setBrief(input.text);
    setHouseSource(source);
    const label = (input.text || input.fileName || 'house').replace(/\s+/g, ' ').slice(0, 60);
    const prefix = source === 'ai' ? 'AI' : source === 'plan' ? 'Plan' : 'Brief';
    api
      .post(
        '/v1/studio-houses',
        {
          name: `${prefix}: ${label}`,
          source,
          brief: input.text.slice(0, 4000),
          spec: houseSpec({ ...spec, ...result.spec }),
          settings: {
            ...houseSettings(),
            onHand: cleanOnHand(nextOnHand),
            lot: nextLot,
            budgetCents: nextBudget,
          },
        },
        { schema: StudioHouseSchema },
      )
      .then((house) => {
        setCurrentHouse({ id: house.id, name: house.name, revision: house.revision });
        setAutoSaveNote(`Saved to My houses as "${house.name}". Rename, copy or delete it there.`);
        void queryClient.invalidateQueries({ queryKey: STUDIO_HOUSES_KEY });
      })
      .catch((e: unknown) => setAutoSaveNote(`Built, but not saved: ${problemText(e)}`));
  };
  const visibleLines = useMemo(() => {
    const term = materialFilter.trim().toLowerCase();
    if (!term) return priced.lines;
    return priced.lines.filter(
      (line) =>
        PRICE_BOOK[line.material].label.toLowerCase().includes(term) ||
        line.group.toLowerCase().includes(term) ||
        line.material.replaceAll('_', ' ').includes(term),
    );
  }, [materialFilter, priced.lines]);

  const area = takeoff.layout.conditionedAreaSqFt;
  const materials = priced.total;
  const tax = (materials * costs.taxPercent) / 100;
  const contingency = ((materials + tax) * costs.contingencyPercent) / 100;
  const labor = costs.laborPerSqFt * area;
  const mep = costs.mepPerSqFt * area;
  const grand = materials + tax + costs.deliveryFee + contingency + labor + mep;
  const floors = takeoff.layout.floors;
  const safeFloor = Math.min(floorIndex, floors.length - 1);
  const room = [
    ...floors.flatMap((f) => f.rooms),
    ...(takeoff.layout.garage ? [takeoff.layout.garage] : []),
  ].find((r) => r.id === activeRoom);

  const set = <K extends keyof BuildSpec>(key: K, value: BuildSpec[K]) =>
    setSpec((s) => ({ ...s, [key]: value }));
  const setCost = <K extends keyof Costs>(key: K, value: number) =>
    setCosts((c) => ({ ...c, [key]: Math.max(0, value) }));

  async function lookup(id: MaterialId) {
    setOpenRow(id);
    setLive((l) => ({ ...l, [id]: 'loading' }));
    const res = await fetchLivePrices(api, PRICE_BOOK[id].searchQuery, location);
    setLive((l) => ({ ...l, [id]: res }));
    return res;
  }

  async function scanAll() {
    if (scanBusy) return;
    const ids = [...new Set(takeoff.lines.map((line) => line.material))];
    // Shopping providers charge per query. Require affirmative consent for a complete catalog scan.
    if (
      ids.length > 30 &&
      !window.confirm(
        `Scan all ${ids.length} material types? The Home Depot lookup provider may charge per query. ` +
          'This may take a while; keep the tab open until completed.',
      )
    )
      return;
    setScanBusy(true);
    setScanProgress({ done: 0, total: ids.length });
    let checked = 0;
    for (const id of ids) {
      const res = await fetchLivePrices(api, PRICE_BOOK[id].searchQuery, location);
      setLive((current) => ({ ...current, [id]: res }));
      checked += 1;
      setScanProgress({ done: checked, total: ids.length });
      if (!res.live) {
        setDailyPriceStatus(
          res.message ?? 'Home Depot price feed is unavailable; no prices were refreshed.',
        );
        break;
      }
    }
    setDailyPriceStatus(
      checked === ids.length
        ? `Checked ${checked} Home Depot material searches. Review product units and pack sizes before applying prices.`
        : `Checked ${checked} of ${ids.length} Home Depot material searches; the price feed stopped responding.`,
    );
    setScanBusy(false);
  }

  // Refresh once per calendar day when the workspace is opened. The web server needs a configured
  // Home Depot price feed; browser closure cannot guarantee any background refresh.
  useEffect(() => {
    if (!loaded) return;
    // Automatically check only the structural starter book each day. A full 260+ line
    // scan is intentionally opt-in because shopping feeds bill per lookup.
    const ids = [
      ...new Set(
        takeoff.lines
          .filter((line) => autoRefreshAll || !line.provisional)
          .map((line) => line.material),
      ),
    ];
    if (ids.length === 0) return;
    const day = new Date().toISOString().slice(0, 10);
    const signature = day + '|' + location + '|' + ids.join(',');
    if (autoScanAttempt.current === signature) return;
    autoScanAttempt.current = signature;
    let cancelled = false;
    const storageKey = 'fieldpro.house.price-check.v2.' + session.orgId + '.' + session.me.user.id;
    try {
      if (window.localStorage.getItem(storageKey) === signature) {
        queueMicrotask(() => {
          if (!cancelled)
            setDailyPriceStatus('Supplier prices were checked today in this browser.');
        });
        return;
      }
    } catch {
      /* Local storage unavailable; retain in-memory state. */
    }
    void (async () => {
      const first = await fetchLivePrices(api, PRICE_BOOK[ids[0]!].searchQuery, location);
      if (cancelled) return;
      setLive((current) => ({ ...current, [ids[0]!]: first }));
      if (!first.live) {
        setDailyPriceStatus(
          first.message ?? 'No live Home Depot feed is configured; verified Home Depot base prices remain visible.',
        );
        return;
      }
      // Keep requests sequential to avoid hammering a paid provider.
      for (const id of ids.slice(1)) {
        if (cancelled) break;
        const response = await fetchLivePrices(api, PRICE_BOOK[id].searchQuery, location);
        if (cancelled) break;
        setLive((current) => ({ ...current, [id]: response }));
      }
      if (!cancelled) {
        setDailyPriceStatus(
          autoRefreshAll
            ? `Daily Home Depot catalog scan completed (${ids.length} types). Verify product packs and units before ordering.`
            : `Daily core Home Depot material prices checked (${ids.length} types). Enable full daily scans for all trade supplies.`,
        );
        try {
          window.localStorage.setItem(storageKey, signature);
        } catch {
          /* Local storage unavailable; retain in-memory state. */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, loaded, location, takeoff.lines, autoRefreshAll, session.orgId, session.me.user.id]);

  const exportFile = (filename: string, body: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const liveResults = Object.values(live).filter(
    (r): r is LivePriceResponse => !!r && r !== 'loading',
  );
  const liveConfigured = liveResults.some((r) => r.live);
  const liveNotice = liveResults.find((r) => !r.live)?.message;

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">House Builder // Takeoff + Pricing</div>
          <h1 tabIndex={-1} data-route-heading="">
            House Builder
          </h1>
          <p>
            Enter the footprint and room program. The plan, every material quantity and a priced
            estimate update instantly. Home Depot is the base-price source for itemized materials
            when the exact product pack and takeoff unit match. Verified bulk tiers apply by quantity;
            unmatched items stay unpriced until a Home Depot listing or supplier quote is confirmed.
          </p>
        </div>
        <div className="cc-no-print" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="cc-btn" href="/build/projects">
            Saved home projects
          </a>
          <button type="button" className="cc-btn" onClick={() => window.print()}>
            Print estimate
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() =>
              exportFile(
                'fieldpro-floor-plan.svg',
                floorPlanSvg(takeoff, safeFloor),
                'image/svg+xml',
              )
            }
          >
            Export 2D plan
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() =>
              exportFile('fieldpro-supply-takeoff.csv', takeoffCsv(priced.lines), 'text/csv')
            }
          >
            Export supply list
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() =>
              exportFile(
                'fieldpro-design-manifest.json',
                designManifest(spec, takeoff),
                'application/json',
              )
            }
          >
            Export design data
          </button>
          <button
            type="button"
            className="cc-btn"
            onClick={() => {
              setSpec(DEFAULT_SPEC);
              setCosts(DEFAULT_COSTS);
              setStudioCosts(DEFAULT_STUDIO_COSTS);
              setOverrides({});
              setLive({});
              setOnHand({});
              setLot(null);
              setDeal(DEFAULT_DEAL);
              setRealLife(false);
              setSurroundings(null);
              setBudgetCents(null);
              setCurrentHouse(null);
              setBrief('');
              setHouseSource('manual');
              setAutoSaveNote(null);
              setStudioStep(16);
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <AccountDraftStatus
        status={cloudDraft.status}
        message={cloudDraft.message}
        onImport={cloudDraft.importLegacy}
        onReload={cloudDraft.reload}
      />
      <AiHouseBrief
        onSpec={(next) => changeHouse({ ...spec, ...next })}
        onResult={onBriefResult}
        spec={spec}
        costs={studioCosts}
        onCommandSpec={changeHouse}
        onUndo={undoHouse}
      />
      {autoSaveNote && (
        <p className="wb-message wb-message--page" role="status">
          {autoSaveNote}
        </p>
      )}
      <HouseStudio
        spec={deferredSpec}
        takeoff={takeoff}
        projectName={currentHouse?.name ?? `${location.split(',')[0] || 'New'} Residence`}
        costs={studioCosts}
        onCostsChange={(next) => {
          if (next.escalationPercent !== studioCosts.escalationPercent) setAutoEscalation(false);
          setStudioCosts(next);
        }}
        step={studioStep}
        onStepChange={setStudioStep}
        realLife={realLife}
        onRealLifeChange={setRealLife}
        lot={lot}
        surroundings={surroundings}
      />
      <StudioWorkbench
        takeoff={takeoff}
        priced={priced.lines}
        buildCost={studioTotal}
        step={studioStep}
        onStep={setStudioStep}
        onHand={onHand}
        onOnHand={setOnHand}
        overrides={overrides}
        onOverrides={setOverrides}
        studioCosts={studioCosts}
        onStudioCosts={setStudioCosts}
        autoEscalation={autoEscalation}
        onAutoEscalation={setAutoEscalation}
        deal={deal}
        onDeal={setDeal}
        lot={lot}
        onLot={setLot}
        surroundings={surroundings}
        onSurroundings={setSurroundings}
        realLife={realLife}
        onRealLife={setRealLife}
        location={location}
        current={currentHouse}
        onCurrent={setCurrentHouse}
        snapshot={snapshot}
        onOpenHouse={openHouse}
        budgetCents={budgetCents}
        spec={spec}
        onSpec={changeHouse}
        onUndo={undoHouse}
        canUndo={history.length > 0}
      />
      <LandFeasibility lot={lot} home={landHome} homePrice={deal.salePrice} />
      <div className="cc-split">
        <div className="cc-stack">
          <Panel title="Build program" id="program">
            <div className="cc-form-grid">
              <NumberField
                label="Length"
                suffix="ft"
                value={spec.lengthFt}
                min={20}
                max={120}
                onChange={(v) => set('lengthFt', v)}
              />
              <NumberField
                label="Width"
                suffix="ft"
                value={spec.widthFt}
                min={20}
                max={80}
                onChange={(v) => set('widthFt', v)}
              />
              <SelectField
                label="Stories"
                value={spec.stories}
                options={[
                  { value: 1, label: '1 story' },
                  { value: 2, label: '2 stories' },
                ]}
                onChange={(v) => {
                  set('stories', v as 1 | 2);
                  setFloorIndex(0);
                }}
              />
              <NumberField
                label="Bedrooms"
                value={spec.bedrooms}
                min={1}
                max={6}
                onChange={(v) => set('bedrooms', v)}
              />
              <NumberField
                label="Bathrooms"
                value={spec.bathrooms}
                min={1}
                max={5}
                onChange={(v) => set('bathrooms', v)}
              />
              <SelectField
                label="Garage"
                value={spec.garage}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'one_car', label: '1-car (12 × 22)' },
                  { value: 'two_car', label: '2-car (22 × 22)' },
                ]}
                onChange={(v) => set('garage', v)}
              />
              <SelectField
                label="Wall height"
                value={spec.wallHeightFt}
                options={[
                  { value: 8, label: '8 ft' },
                  { value: 9, label: '9 ft' },
                  { value: 10, label: '10 ft' },
                ]}
                onChange={(v) => set('wallHeightFt', v as 8 | 9 | 10)}
              />
              <NumberField
                label="Roof pitch"
                suffix="/12"
                value={spec.roofPitch}
                min={0}
                max={14}
                step={0.5}
                onChange={(v) => set('roofPitch', Math.max(0, Math.min(14, v)))}
              />
              <NumberField
                label="Overhang"
                suffix="ft"
                value={spec.overhangFt}
                min={0}
                max={3}
                step={0.5}
                onChange={(v) => set('overhangFt', v)}
              />
              <SelectField
                label="Stud spacing"
                value={spec.studSpacingIn}
                options={[
                  { value: 16, label: '16 in o.c.' },
                  { value: 24, label: '24 in o.c.' },
                ]}
                onChange={(v) => set('studSpacingIn', v as 16 | 24)}
              />
              <NumberField
                label="Waste"
                suffix="%"
                value={spec.wastePercent}
                min={0}
                max={30}
                onChange={(v) => set('wastePercent', v)}
              />
            </div>
          </Panel>

          <Panel
            title="Schematic floor plan"
            id="plan"
            actions={
              floors.length > 1 ? (
                <span role="tablist" aria-label="Floor" style={{ display: 'inline-flex', gap: 4 }}>
                  {floors.map((f, i) => (
                    <button
                      key={f.level}
                      type="button"
                      role="tab"
                      aria-selected={i === safeFloor}
                      aria-pressed={i === safeFloor}
                      className="cc-iconbtn"
                      onClick={() => setFloorIndex(i)}
                    >
                      F{f.level}
                    </button>
                  ))}
                </span>
              ) : undefined
            }
          >
            <FloorPlan
              layout={takeoff.layout}
              floorIndex={safeFloor}
              activeRoomId={activeRoom}
              onSelect={(id) => setActiveRoom((cur) => (cur === id ? null : id))}
            />
            {takeoff.layout.warnings.length > 0 && (
              <div className="cc-callout" style={{ marginTop: 10 }} role="status">
                <p>{takeoff.layout.warnings.join(' ')}</p>
              </div>
            )}
          </Panel>

          <Panel
            title="Material takeoff + pricing"
            id="materials"
            actions={
              <span className="cc-no-print" style={{ display: 'inline-flex', gap: 6 }}>
                <button
                  type="button"
                  className="cc-btn cc-btn--sm cc-btn--primary"
                  disabled={scanBusy}
                  onClick={scanAll}
                >
                  {scanBusy
                    ? `Scanning ${scanProgress.done}/${scanProgress.total}`
                    : 'Scan entire catalog'}
                </button>
                {liveConfigured && (
                  <span className="web-muted web-small">
                    Review listing units before applying a price.
                  </span>
                )}
              </span>
            }
          >
            <p className="web-muted web-small" style={{ marginBottom: 9 }}>
              {priced.lines.length} line items across {GROUP_ORDER.length} trades, including{' '}
              {priced.lines.filter((line) => line.provisional).length} preliminary allowances
              (fasteners, nails, pipe fittings, fixtures, electrical, HVAC, finishes and sitework).
              Items without a verified Home Depot unit price are excluded from the total. Full-catalog scans
              use the configured Home Depot lookup provider and may be billable.
            </p>
            {dailyPriceStatus && (
              <p className="web-muted web-small" role="status">
                {dailyPriceStatus}
              </p>
            )}
            <label
              className="web-muted web-small"
              style={{ display: 'flex', gap: 8, alignItems: 'start', margin: '8px 0 12px' }}
            >
              <input
                type="checkbox"
                checked={autoRefreshAll}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  if (
                    next &&
                    !window.confirm(
                      'Enable an automatic scan of every material when you open this workspace ' +
                        'once per day? The Home Depot lookup provider may bill hundreds of searches.',
                    )
                  )
                    return;
                  setAutoRefreshAll(next);
                }}
              />
              Daily Home Depot lookup for the entire catalog when opened (opt-in; requires provider
              credentials and may incur substantial usage charges)
            </label>
            <label className="cc-field" style={{ marginBottom: 12 }}>
              <span>Find a supply, trade or fastener</span>
              <input
                className="cc-input"
                type="search"
                value={materialFilter}
                placeholder="e.g. roofing nails, PEX, panel, drywall screws"
                onChange={(event) => setMaterialFilter(event.currentTarget.value)}
              />
            </label>
            {liveNotice && !liveConfigured && (
              <div
                className="cc-callout cc-callout--info"
                style={{ marginBottom: 10 }}
                role="status"
              >
                <p>{liveNotice}</p>
              </div>
            )}
            <div className="cc-table-wrap">
              <table className="cc-table">
                <thead>
                  <tr>
                    <th scope="col">Material</th>
                    <th scope="col" className="cc-num">
                      Qty
                    </th>
                    <th scope="col" className="cc-num">
                      Unit price
                    </th>
                    <th scope="col" className="cc-num">
                      Total
                    </th>
                    <th scope="col" className="cc-no-print">
                      <span className="cc-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {GROUP_ORDER.map((group) => {
                    const rows = visibleLines.filter((l) => l.group === group);
                    if (rows.length === 0) return null;
                    const groupTotal = rows.reduce((s, r) => s + (r.total ?? 0), 0);
                    return (
                      <Fragment key={group}>
                        <tr className="cc-group-row">
                          <td colSpan={3}>{group}</td>
                          <td className="cc-num">{money0(groupTotal)}</td>
                          <td className="cc-no-print" />
                        </tr>
                        {rows.map((line) => {
                          const mat = PRICE_BOOK[line.material];
                          const res = live[line.material];
                          const open = openRow === line.material;
                          return (
                            <Fragment key={line.key}>
                              <tr>
                                <td>
                                  <strong>{mat.label}</strong>
                                  <span className="cc-formula">{line.formula}</span>
                                </td>
                                <td className="cc-num">
                                  {num(line.quantity)} <span className="web-muted">{mat.unit}</span>
                                </td>
                                <td className="cc-num">
                                  {line.unitPrice === null ? (
                                    <span className="cc-chip cc-chip--amber">needs price</span>
                                  ) : (
                                    <>
                                      {money(line.unitPrice)}
                                      <span className="cc-formula">
                                        {line.seller} · {line.basis ? BASIS_LABEL[line.basis] : ''}
                                      </span>
                                    </>
                                  )}
                                </td>
                                <td className="cc-num">
                                  {line.total === null ? '—' : money0(line.total)}
                                </td>
                                <td className="cc-no-print">
                                  <button
                                    type="button"
                                    className="cc-iconbtn"
                                    aria-expanded={open}
                                    aria-label={`Prices and suppliers for ${mat.label}`}
                                    onClick={() => setOpenRow(open ? null : line.material)}
                                  >
                                    {open ? '▴' : '$'}
                                  </button>
                                </td>
                              </tr>
                              {open && (
                                <tr>
                                  <td colSpan={5}>
                                    <PriceDrawer
                                      material={line.material}
                                      result={res}
                                      override={overrides[line.material]}
                                      onLookup={() => void lookup(line.material)}
                                      onSet={(o) =>
                                        setOverrides((cur) => {
                                          const next = { ...cur };
                                          if (o) next[line.material] = o;
                                          else delete next[line.material];
                                          return next;
                                        })
                                      }
                                    />
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="cc-rail" aria-label="Estimate summary">
          <Panel title="Telemetry" id="kpis">
            <div className="cc-kpis">
              <Kpi label="Conditioned" value={num(area, 0)} unit="ft²" accent />
              <Kpi label="Slab" value={num(takeoff.summary.slabAreaSqFt, 0)} unit="ft²" />
              <Kpi label="Concrete" value={num(takeoff.summary.concreteYd3)} unit="yd³" />
              <Kpi label="Roof" value={num(takeoff.summary.roofSquares)} unit="sq" />
              <Kpi
                label="Ext. wall"
                value={num(takeoff.summary.exteriorWallAreaSqFt, 0)}
                unit="ft²"
              />
              <Kpi label="Partitions" value={num(takeoff.summary.interiorWallFt, 0)} unit="LF" />
            </div>
          </Panel>

          <Panel title="Estimate" id="estimate">
            <div className="cc-form-grid" style={{ marginBottom: 10 }}>
              <NumberField
                label="Sales tax"
                suffix="%"
                value={costs.taxPercent}
                step={0.25}
                onChange={(v) => setCost('taxPercent', v)}
              />
              <NumberField
                label="Delivery"
                suffix="$"
                value={costs.deliveryFee}
                step={25}
                onChange={(v) => setCost('deliveryFee', v)}
              />
              <NumberField
                label="Contingency"
                suffix="%"
                value={costs.contingencyPercent}
                onChange={(v) => setCost('contingencyPercent', v)}
              />
              <NumberField
                label="Labor"
                suffix="$/ft²"
                value={costs.laborPerSqFt}
                step={1}
                onChange={(v) => setCost('laborPerSqFt', v)}
              />
              <NumberField
                label="MEP + finishes"
                suffix="$/ft²"
                value={costs.mepPerSqFt}
                step={1}
                onChange={(v) => setCost('mepPerSqFt', v)}
              />
            </div>
            <dl style={{ margin: 0 }}>
              <div className="cc-total">
                <dt>
                  Priced materials subtotal ({priced.lines.length - priced.unpriced} of{' '}
                  {priced.lines.length} lines)
                </dt>
                <dd>{money0(materials)}</dd>
              </div>
              <div className="cc-total">
                <dt>Sales tax</dt>
                <dd>{money0(tax)}</dd>
              </div>
              <div className="cc-total">
                <dt>Delivery</dt>
                <dd>{money0(costs.deliveryFee)}</dd>
              </div>
              <div className="cc-total">
                <dt>Contingency</dt>
                <dd>{money0(contingency)}</dd>
              </div>
              {labor > 0 && (
                <div className="cc-total">
                  <dt>Labor allowance</dt>
                  <dd>{money0(labor)}</dd>
                </div>
              )}
              {mep > 0 && (
                <div className="cc-total">
                  <dt>MEP + finishes allowance</dt>
                  <dd>{money0(mep)}</dd>
                </div>
              )}
              <div className="cc-total cc-total--grand">
                <dt>{priced.unpriced ? 'Incomplete estimate subtotal' : 'Total'}</dt>
                <dd>{money0(grand)}</dd>
              </div>
              <div className="cc-total">
                <dt>Per conditioned ft²</dt>
                <dd>{area > 0 ? money(grand / area) : '—'}</dd>
              </div>
            </dl>
            {priced.unpriced > 0 && (
              <div className="cc-callout" style={{ marginTop: 10 }}>
                <p>
                  {priced.unpriced} line{priced.unpriced === 1 ? ' has' : 's have'} no published
                  reference price and {priced.unpriced === 1 ? 'is' : 'are'} not in the total. Open
                  the line to run a live lookup or enter your supplier&apos;s price.
                </p>
              </div>
            )}
            <div className="cc-callout cc-callout--info" style={{ marginTop: 10 }}>
              <p>
                Planning estimate for a slab-on-grade, wood-framed house. Electrical, plumbing,
                HVAC, fixtures, finishes, hardware and sitework are now enumerated as provisional
                quantities, but most have NO VERIFIED PRICE and are excluded from this subtotal. No
                finished building can be purchased or constructed from this schematic alone. Confirm
                dimensions, systems, soil, code, engineered structure, permits and material
                specifications with qualified professionals before ordering.
              </p>
            </div>
          </Panel>

          <Panel title="Live Home Depot scan" id="live">
            <label className="cc-field" style={{ marginBottom: 10 }}>
              <span>Job location</span>
              <input
                className="cc-input"
                value={location}
                maxLength={120}
                onChange={(e) => setLocation(e.currentTarget.value)}
              />
            </label>
            <MaterialLookup location={location} />
          </Panel>

          {room && (
            <Panel title="Selected space" id="room">
              <div className="cc-kpis">
                <Kpi label={room.name} value={`${room.w}′ × ${room.h}′`} />
                <Kpi label="Area" value={num(room.w * room.h, 0)} unit="ft²" accent />
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function PriceDrawer({
  material,
  result,
  override,
  onLookup,
  onSet,
}: {
  material: MaterialId;
  result: LivePriceResponse | 'loading' | undefined;
  override: PriceOverride | undefined;
  onLookup: () => void;
  onSet: (o: PriceOverride | null) => void;
}) {
  const mat = PRICE_BOOK[material];
  const [manual, setManual] = useState(
    override?.basis === 'manual' ? String(override.unitPrice) : '',
  );
  return (
    <div className="cc-stack" style={{ gap: '0.6rem', padding: '0.3rem 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {mat.range && (
          <span className="cc-chip">
            RANGE {money(mat.range.low)} – {money(mat.range.high)} / {mat.unit}
          </span>
        )}
        {mat.offers.map((o) => (
          <span key={o.sourceUrl + o.price} className="cc-chip cc-chip--purple" title={o.note}>
            {o.sellerName ?? o.supplier.replace('_', ' ').toUpperCase()} {money(o.price)}
          </span>
        ))}
        <span className="web-muted web-small">
          Source:{' '}
          {mat.source.url ? (
            <a href={mat.source.url} target="_blank" rel="noopener noreferrer">
              {mat.source.title}
            </a>
          ) : (
            mat.source.title
          )}{' '}
          ({mat.asOf})
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
        <button
          type="button"
          className="cc-btn cc-btn--sm cc-btn--primary"
          disabled={result === 'loading'}
          onClick={onLookup}
        >
          {result === 'loading' ? 'Scanning…' : 'Find Home Depot price'}
        </button>
        <form
          style={{ display: 'flex', gap: 6, alignItems: 'end' }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(manual);
            if (Number.isFinite(n) && n > 0)
              onSet({ unitPrice: n, seller: 'Your supplier', basis: 'manual' });
          }}
        >
          <label className="cc-field" style={{ width: 130 }}>
            <span>My price / {mat.unit}</span>
            <input
              className="cc-input"
              inputMode="decimal"
              value={manual}
              onChange={(e) => setManual(e.currentTarget.value)}
            />
          </label>
          <button type="submit" className="cc-btn cc-btn--sm">
            Apply
          </button>
        </form>
        {override && (
          <button type="button" className="cc-btn cc-btn--sm" onClick={() => onSet(null)}>
            Back to reference price
          </button>
        )}
      </div>
      {result === 'loading' && <div className="cc-skeleton" style={{ height: 48 }} />}
      {result && result !== 'loading' && (
        <OfferList
          result={result}
          onUse={(o) => onSet({ unitPrice: o.price, seller: o.seller, basis: 'live' })}
        />
      )}
      <SupplierLinks query={mat.searchQuery} />
    </div>
  );
}
