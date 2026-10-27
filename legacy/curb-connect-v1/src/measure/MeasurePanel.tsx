import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { curbProfiles, type CurbProfileId } from "../estimate/concrete";
import { commonPitches, pitchMultiplier } from "../estimate/roofing";
import { formatCurrency, makeId } from "../projectUtils";
import type { ServiceType } from "../types";
import { addBasemaps, MAP_MAX_ZOOM, type BasemapSetup } from "./basemaps";
import {
  geocodeAddress,
  geocoderName,
  suggestAddresses,
  zoomForPrecision,
  type GeocodeResult,
  type GeocodeSuggestion
} from "./geocoder";
import { findSnapTarget, type LatLng } from "./geometry";
import {
  curbTakeoff,
  defaultCurbTakeoff,
  defaultRoofTakeoff,
  isShapeComplete,
  measureShape,
  roofTakeoff,
  type MeasuredShape,
  type ShapeKind
} from "./takeoff";
import { areaUnitLabels, formatArea, formatLength, lengthUnitLabels, type AreaUnit, type LengthUnit } from "./units";

export interface EstimatePrefill {
  service: ServiceType;
  quantity: string;
  contractAmount: string;
  notes: string;
  location: string;
}

interface MeasurePanelProps {
  onCreateProject: (prefill: EstimatePrefill) => void;
}

type Trade = "curb" | "roof";

const SNAP_TOLERANCE_PX = 14;
const LOUPE_ZOOM_BOOST = 3;
// Must match .loupe width/height in styles.css (160px + 3px borders).
const LOUPE_SIZE = 166;
const LOUPE_GAP = 24;
const DEFAULT_CENTER: L.LatLngExpression = [32.7767, -96.797];
const SUGGEST_DELAY_MS = 250;

function toNumber(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function toCents(value: string): number {
  return Math.round(toNumber(value) * 100);
}

function toLatLng(point: L.LatLng): LatLng {
  return { lat: point.lat, lng: point.lng };
}

function shapeStyle(kind: ShapeKind, active: boolean): L.PathOptions {
  return {
    color: active ? "#f97316" : kind === "line" ? "#2563eb" : "#16a34a",
    weight: active ? 4 : 3,
    fillOpacity: kind === "area" ? 0.18 : 0,
    dashArray: active ? "6 6" : undefined
  };
}

function MeasurePanel({ onCreateProject }: MeasurePanelProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const loupeContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const loupeMapRef = useRef<L.Map | null>(null);
  const drawingLayerRef = useRef<L.LayerGroup | null>(null);

  const [trade, setTrade] = useState<Trade>("curb");
  const [drawKind, setDrawKind] = useState<ShapeKind>("line");
  const [shapes, setShapes] = useState<MeasuredShape[]>([]);
  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);
  const [lengthUnit, setLengthUnit] = useState<LengthUnit>("ft");
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("sqft");
  const [loupeOn, setLoupeOn] = useState(true);
  const [loupePosition, setLoupePosition] = useState<{ x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [siteLabel, setSiteLabel] = useState("");
  const [basemap, setBasemap] = useState<BasemapSetup | null>(null);
  const [siteMarker, setSiteMarker] = useState<LatLng | null>(null);

  const [curbProfile, setCurbProfile] = useState<CurbProfileId | "custom">(defaultCurbTakeoff.profileId);
  const [customCrossSection, setCustomCrossSection] = useState(String(defaultCurbTakeoff.customCrossSectionSqIn));
  const [slabThickness, setSlabThickness] = useState(String(defaultCurbTakeoff.slabThicknessIn));
  const [sawCutLf, setSawCutLf] = useState("0");
  const [concretePrice, setConcretePrice] = useState(String(defaultCurbTakeoff.pricing.concreteCentsPerCy / 100));
  const [curbLaborPrice, setCurbLaborPrice] = useState(String(defaultCurbTakeoff.pricing.curbLaborCentsPerLf / 100));
  const [slabLaborPrice, setSlabLaborPrice] = useState(String(defaultCurbTakeoff.pricing.slabLaborCentsPerSqFt / 100));
  const [sawCutPrice, setSawCutPrice] = useState(String(defaultCurbTakeoff.pricing.sawCutCentsPerLf / 100));
  const [concreteWaste, setConcreteWaste] = useState(String(defaultCurbTakeoff.pricing.wastePercent));

  const [roofWaste, setRoofWaste] = useState(String(defaultRoofTakeoff.options.wastePercent));
  const [ridgeLf, setRidgeLf] = useState("0");
  const [hipLf, setHipLf] = useState("0");
  const [eaveLf, setEaveLf] = useState("0");
  const [rakeLf, setRakeLf] = useState("0");
  const [defaultPitch, setDefaultPitch] = useState(6);

  // Refs let the Leaflet event handlers (bound once) read the latest React state.
  const shapesRef = useRef(shapes);
  const draftRef = useRef(draftPoints);
  const loupeOnRef = useRef(loupeOn);
  const drawKindRef = useRef(drawKind);
  useEffect(() => {
    shapesRef.current = shapes;
    draftRef.current = draftPoints;
    loupeOnRef.current = loupeOn;
    drawKindRef.current = drawKind;
  }, [shapes, draftPoints, loupeOn, drawKind]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = L.map(mapContainerRef.current, { center: DEFAULT_CENTER, zoom: 18, maxZoom: MAP_MAX_ZOOM });
    let disposed = false;
    void addBasemaps(map).then((setup) => {
      if (!disposed) {
        setBasemap(setup);
      }
    });
    L.control.scale({ imperial: true, metric: true }).addTo(map);
    drawingLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    function snappedPoint(event: L.LeafletMouseEvent): LatLng {
      const candidates = [...shapesRef.current.flatMap((shape) => shape.points), ...draftRef.current].map((point) => {
        const screen = map.latLngToContainerPoint(point);
        return { x: screen.x, y: screen.y, point };
      });
      const target = findSnapTarget(event.containerPoint, candidates, SNAP_TOLERANCE_PX);
      return target ? target.point : toLatLng(event.latlng);
    }

    map.on("click", (event: L.LeafletMouseEvent) => {
      const point = snappedPoint(event);
      const draft = draftRef.current;
      // Clicking back on the first corner closes an area; the ring is implicit, so don't repeat the point.
      if (drawKindRef.current === "area" && draft.length >= 3 && draft[0] === point) {
        return;
      }
      setDraftPoints((current) => [...current, point]);
    });

    map.on("mousemove", (event: L.LeafletMouseEvent) => {
      if (!loupeOnRef.current) {
        return;
      }
      // Keep the loupe beside the cursor, flipping it when it would leave the map frame.
      const size = map.getSize();
      const { x, y } = event.containerPoint;
      setLoupePosition({
        x: x + LOUPE_GAP + LOUPE_SIZE > size.x ? x - LOUPE_GAP - LOUPE_SIZE : x + LOUPE_GAP,
        y: y - LOUPE_GAP - LOUPE_SIZE < 0 ? y + LOUPE_GAP : y - LOUPE_GAP - LOUPE_SIZE
      });
      loupeMapRef.current?.setView(snappedPoint(event), Math.min(map.getZoom() + LOUPE_ZOOM_BOOST, 24), {
        animate: false
      });
    });
    map.on("mouseout", () => setLoupePosition(null));

    return () => {
      disposed = true;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // The loupe is a second, non-interactive map that follows the cursor at a higher zoom.
  useEffect(() => {
    if (!loupeOn || !basemap || !loupeContainerRef.current || loupeMapRef.current) {
      return;
    }
    const loupe = L.map(loupeContainerRef.current, {
      center: mapRef.current?.getCenter() ?? DEFAULT_CENTER,
      zoom: (mapRef.current?.getZoom() ?? 18) + LOUPE_ZOOM_BOOST,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false
    });
    basemap.loupeLayer().addTo(loupe);
    loupeMapRef.current = loupe;
    return () => {
      loupe.remove();
      loupeMapRef.current = null;
    };
  }, [loupeOn, basemap]);

  // Redraw finished shapes, the in-progress shape, and vertex handles.
  useEffect(() => {
    const layer = drawingLayerRef.current;
    if (!layer) {
      return;
    }
    layer.clearLayers();

    for (const shape of shapes) {
      const latLngs = shape.points.map((point) => L.latLng(point.lat, point.lng));
      const path =
        shape.kind === "line" ? L.polyline(latLngs, shapeStyle("line", false)) : L.polygon(latLngs, shapeStyle("area", false));
      path.bindTooltip(shape.label, { sticky: true }).addTo(layer);
    }

    if (draftPoints.length > 0) {
      const latLngs = draftPoints.map((point) => L.latLng(point.lat, point.lng));
      if (drawKind === "area" && draftPoints.length >= 3) {
        L.polygon(latLngs, shapeStyle("area", true)).addTo(layer);
      } else {
        L.polyline(latLngs, shapeStyle(drawKind, true)).addTo(layer);
      }
    }

    for (const point of [...shapes.flatMap((shape) => shape.points), ...draftPoints]) {
      L.circleMarker([point.lat, point.lng], { radius: 4, color: "#0f172a", weight: 1, fillColor: "#fff", fillOpacity: 1 })
        .addTo(layer);
    }

    if (siteMarker) {
      L.circleMarker([siteMarker.lat, siteMarker.lng], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#ef4444",
        fillOpacity: 1,
        interactive: false
      }).addTo(layer);
    }
  }, [shapes, draftPoints, drawKind, siteMarker]);

  const draftMeasurement = useMemo(() => measureShape({ kind: drawKind, points: draftPoints }), [drawKind, draftPoints]);

  function finishShape() {
    if (!isShapeComplete({ kind: drawKind, points: draftPoints })) {
      return;
    }
    const count = shapes.filter((shape) => shape.kind === drawKind).length + 1;
    setShapes((current) => [
      ...current,
      {
        id: makeId("shape"),
        kind: drawKind,
        label: drawKind === "line" ? `Run ${count}` : trade === "roof" ? `Facet ${count}` : `Area ${count}`,
        points: draftPoints,
        pitchRise: defaultPitch
      }
    ]);
    setDraftPoints([]);
  }

  function updateShape(id: string, changes: Partial<MeasuredShape>) {
    setShapes((current) => current.map((shape) => (shape.id === id ? { ...shape, ...changes } : shape)));
  }

  // Type-ahead: fetch suggestions shortly after typing stops, cancelling stale requests.
  const skipSuggestRef = useRef(false);
  useEffect(() => {
    if (skipSuggestRef.current) {
      skipSuggestRef.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const center = mapRef.current?.getCenter();
      suggestAddresses(searchQuery, center ? { lat: center.lat, lng: center.lng } : undefined, controller.signal)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, SUGGEST_DELAY_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  async function runSearch(text: string, suggestionKey = "") {
    if (!text.trim()) {
      return;
    }
    setSuggestions([]);
    setSearchMessage("Searching…");
    try {
      const center = mapRef.current?.getCenter();
      const results = await geocodeAddress(text, suggestionKey, center ? { lat: center.lat, lng: center.lng } : undefined);
      if (results.length === 0) {
        setSearchResults([]);
        setSearchMessage("No matches. Add the city, state or country, e.g. 2400 Trinity Mills Rd, Carrollton TX.");
        return;
      }
      goToResult(results[0]);
      // Keep other close matches available in case the first one is the wrong place.
      setSearchResults(results.slice(1));
      setSearchMessage("");
    } catch (error) {
      setSearchResults([]);
      setSearchMessage(error instanceof Error ? error.message : "Search failed.");
    }
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(searchQuery);
  }

  function pickSuggestion(suggestion: GeocodeSuggestion) {
    skipSuggestRef.current = true;
    setSearchQuery(suggestion.text);
    void runSearch(suggestion.text, suggestion.key);
  }

  function goToResult(result: GeocodeResult) {
    mapRef.current?.flyTo([result.lat, result.lng], zoomForPrecision(result.precision), { duration: 1.2 });
    setSiteLabel(result.label);
    setSiteMarker({ lat: result.lat, lng: result.lng });
  }

  const curbEstimate = useMemo(
    () =>
      curbTakeoff({
        shapes,
        profileId: curbProfile,
        customCrossSectionSqIn: toNumber(customCrossSection),
        slabThicknessIn: toNumber(slabThickness),
        sawCutLf: toNumber(sawCutLf),
        pricing: {
          ...defaultCurbTakeoff.pricing,
          wastePercent: Math.min(toNumber(concreteWaste), 100),
          concreteCentsPerCy: toCents(concretePrice),
          curbLaborCentsPerLf: toCents(curbLaborPrice),
          slabLaborCentsPerSqFt: toCents(slabLaborPrice),
          sawCutCentsPerLf: toCents(sawCutPrice)
        }
      }),
    [shapes, curbProfile, customCrossSection, slabThickness, sawCutLf, concretePrice, curbLaborPrice, slabLaborPrice, sawCutPrice, concreteWaste]
  );

  const roofEstimate = useMemo(
    () =>
      roofTakeoff({
        shapes,
        edges: { ridgeLf: toNumber(ridgeLf), hipLf: toNumber(hipLf), eaveLf: toNumber(eaveLf), rakeLf: toNumber(rakeLf) },
        options: { ...defaultRoofTakeoff.options, wastePercent: Math.min(toNumber(roofWaste), 100) }
      }),
    [shapes, ridgeLf, hipLf, eaveLf, rakeLf, roofWaste]
  );

  function createProjectFromEstimate() {
    if (trade === "curb") {
      const parts = [
        curbEstimate.curbLinearFeet > 0 ? `${Math.round(curbEstimate.curbLinearFeet)} LF curb` : "",
        curbEstimate.slabAreaSqFt > 0 ? `${Math.round(curbEstimate.slabAreaSqFt)} sq ft flatwork` : "",
        curbEstimate.sawCutLinearFeet > 0 ? `${Math.round(curbEstimate.sawCutLinearFeet)} LF saw-cut` : ""
      ].filter(Boolean);
      onCreateProject({
        service: curbEstimate.slabAreaSqFt > 0 && curbEstimate.curbLinearFeet === 0 ? "Sidewalk tie-in" : "Standard curb",
        quantity: parts.join(", "),
        contractAmount: String(Math.round(curbEstimate.totalCents / 100)),
        notes: `Map take-off: order ${curbEstimate.orderCubicYards.toFixed(2)} CY concrete (${curbEstimate.netCubicYards.toFixed(2)} CY net).`,
        location: siteLabel
      });
    } else {
      onCreateProject({
        service: "Other",
        quantity: `${roofEstimate.squaresWithWaste.toFixed(1)} squares, ${roofEstimate.shingleBundles} bundles`,
        contractAmount: "",
        notes: `Roof take-off: ${Math.round(roofEstimate.surfaceAreaSqFt)} sq ft surface, ${roofEstimate.ridgeCapBundles} ridge cap bundles, ${roofEstimate.underlaymentRolls} underlayment rolls, ${roofEstimate.starterBundles} starter bundles, ${roofEstimate.dripEdgePieces} drip edge pieces.`,
        location: siteLabel
      });
    }
  }

  const hasMeasurements = shapes.some(isShapeComplete);

  return (
    <section className="card measure-section" aria-label="Measure and estimate">
      <div className="section-heading spread">
        <div>
          <p className="eyebrow">Measure &amp; estimate</p>
          <h2>Measure curb runs, flatwork, and roofs from the map</h2>
        </div>
        <div className="segmented" role="group" aria-label="Trade">
          <button className={trade === "curb" ? "active" : ""} type="button" onClick={() => setTrade("curb")}>
            Curb &amp; concrete
          </button>
          <button className={trade === "roof" ? "active" : ""} type="button" onClick={() => { setTrade("roof"); setDrawKind("area"); }}>
            Roofing
          </button>
        </div>
      </div>

      <form className="measure-search" onSubmit={handleSearch} role="search">
        <div className="search-box">
          <input
            aria-label="Search any address worldwide"
            aria-autocomplete="list"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSuggestions([]);
              }
            }}
            placeholder="Search any house or address worldwide"
          />
          {suggestions.length > 0 ? (
            <ul className="search-results suggestions" role="listbox">
              {suggestions.map((suggestion) => (
                <li key={suggestion.key || suggestion.text} role="option" aria-selected="false">
                  <button type="button" onClick={() => pickSuggestion(suggestion)}>
                    {suggestion.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button type="submit">Search</button>
      </form>
      {searchMessage ? <p className="empty-state compact">{searchMessage}</p> : null}
      {siteLabel ? (
        <p className="search-site">
          <strong>Showing:</strong> {siteLabel}
          <small> · {geocoderName} geocoder</small>
        </p>
      ) : null}
      {searchResults.length > 0 ? (
        <details className="search-alternates">
          <summary>Not the right place? {searchResults.length} other match{searchResults.length === 1 ? "" : "es"}</summary>
          <ul className="search-results">
            {searchResults.map((result) => (
              <li key={`${result.lat},${result.lng}`}>
                <button type="button" onClick={() => goToResult(result)}>
                  {result.label}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="measure-layout">
        <div className="map-frame">
          <div ref={mapContainerRef} className="measure-map" />
          {loupeOn ? (
            <div
              className="loupe"
              aria-hidden="true"
              style={
                loupePosition
                  ? { left: loupePosition.x, top: loupePosition.y, visibility: "visible" }
                  : { visibility: "hidden" }
              }
            >
              <div ref={loupeContainerRef} className="loupe-map" />
              <span className="loupe-crosshair" />
            </div>
          ) : null}
          <div className="map-toolbar" role="toolbar" aria-label="Drawing tools">
            <button className={drawKind === "line" ? "active" : ""} type="button" onClick={() => setDrawKind("line")} disabled={trade === "roof"}>
              Line
            </button>
            <button className={drawKind === "area" ? "active" : ""} type="button" onClick={() => setDrawKind("area")}>
              Area
            </button>
            <button type="button" onClick={() => setDraftPoints((current) => current.slice(0, -1))} disabled={draftPoints.length === 0}>
              Undo point
            </button>
            <button type="button" onClick={finishShape} disabled={!isShapeComplete({ kind: drawKind, points: draftPoints })}>
              Finish shape
            </button>
            <button type="button" onClick={() => setLoupeOn((current) => !current)} aria-pressed={loupeOn}>
              Magnifier
            </button>
          </div>
        </div>

        <aside className="measure-side">
          <div className="two-column">
            <label>
              Length unit
              <select value={lengthUnit} onChange={(event) => setLengthUnit(event.target.value as LengthUnit)}>
                {(Object.keys(lengthUnitLabels) as LengthUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {lengthUnitLabels[unit]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Area unit
              <select value={areaUnit} onChange={(event) => setAreaUnit(event.target.value as AreaUnit)}>
                {(Object.keys(areaUnitLabels) as AreaUnit[]).map((unit) => (
                  <option key={unit} value={unit}>
                    {areaUnitLabels[unit]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="measure-live" aria-live="polite">
            <strong>Drawing {drawKind === "line" ? "a line" : "an area"}</strong>
            <span>
              {draftPoints.length} point{draftPoints.length === 1 ? "" : "s"} · {drawKind === "line" ? "Length" : "Perimeter"}{" "}
              {formatLength(draftMeasurement.lengthFt * 0.3048, lengthUnit)}
              {drawKind === "area" ? ` · Area ${formatArea(draftMeasurement.areaSqFt / 10.7639104, areaUnit)}` : ""}
            </span>
            {draftMeasurement.invalid ? <span className="form-error">Edges cross. Undo the last point.</span> : null}
            <small>Click the map to add points. Points snap to nearby corners.</small>
          </div>

          <ul className="shape-list">
            {shapes.map((shape) => {
              const measurement = measureShape(shape);
              return (
                <li key={shape.id}>
                  <input
                    aria-label="Shape name"
                    value={shape.label}
                    onChange={(event) => updateShape(shape.id, { label: event.target.value })}
                  />
                  <span>
                    {shape.kind === "line"
                      ? formatLength(measurement.lengthFt * 0.3048, lengthUnit)
                      : formatArea(measurement.areaSqFt / 10.7639104, areaUnit)}
                    {measurement.invalid ? " (edges cross, excluded)" : ""}
                  </span>
                  {trade === "roof" && shape.kind === "area" ? (
                    <select
                      aria-label={`Pitch for ${shape.label}`}
                      value={shape.pitchRise}
                      onChange={(event) => updateShape(shape.id, { pitchRise: Number(event.target.value) })}
                    >
                      {commonPitches.map((rise) => (
                        <option key={rise} value={rise}>
                          {rise}/12 (×{pitchMultiplier(rise).toFixed(3)})
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" onClick={() => setShapes((current) => current.filter((item) => item.id !== shape.id))}>
                    Remove
                  </button>
                </li>
              );
            })}
            {shapes.length === 0 ? <li className="empty-state compact">No finished shapes yet.</li> : null}
          </ul>

          {trade === "curb" ? (
            <div className="estimate-inputs">
              <label>
                Curb profile
                <select value={curbProfile} onChange={(event) => setCurbProfile(event.target.value as CurbProfileId | "custom")}>
                  {(Object.keys(curbProfiles) as CurbProfileId[]).map((id) => (
                    <option key={id} value={id}>
                      {curbProfiles[id].label}
                    </option>
                  ))}
                  <option value="custom">Custom cross-section</option>
                </select>
              </label>
              {curbProfile === "custom" ? (
                <label>
                  Cross-section (sq in)
                  <input type="number" min="0" value={customCrossSection} onChange={(event) => setCustomCrossSection(event.target.value)} />
                </label>
              ) : null}
              <div className="three-column">
                <label>
                  Slab thickness (in)
                  <input type="number" min="0" step="0.5" value={slabThickness} onChange={(event) => setSlabThickness(event.target.value)} />
                </label>
                <label>
                  Saw-cut (LF)
                  <input type="number" min="0" value={sawCutLf} onChange={(event) => setSawCutLf(event.target.value)} />
                </label>
                <label>
                  Waste %
                  <input type="number" min="0" max="100" value={concreteWaste} onChange={(event) => setConcreteWaste(event.target.value)} />
                </label>
              </div>
              <div className="two-column">
                <label>
                  Concrete $/CY
                  <input type="number" min="0" value={concretePrice} onChange={(event) => setConcretePrice(event.target.value)} />
                </label>
                <label>
                  Curb labor $/LF
                  <input type="number" min="0" step="0.25" value={curbLaborPrice} onChange={(event) => setCurbLaborPrice(event.target.value)} />
                </label>
                <label>
                  Slab labor $/sq ft
                  <input type="number" min="0" step="0.25" value={slabLaborPrice} onChange={(event) => setSlabLaborPrice(event.target.value)} />
                </label>
                <label>
                  Saw-cut $/LF
                  <input type="number" min="0" step="0.25" value={sawCutPrice} onChange={(event) => setSawCutPrice(event.target.value)} />
                </label>
              </div>
              <dl className="estimate-summary">
                <div><dt>Curb</dt><dd>{Math.round(curbEstimate.curbLinearFeet).toLocaleString()} LF</dd></div>
                <div><dt>Flatwork</dt><dd>{Math.round(curbEstimate.slabAreaSqFt).toLocaleString()} sq ft</dd></div>
                <div><dt>Concrete (net)</dt><dd>{curbEstimate.netCubicYards.toFixed(2)} CY</dd></div>
                <div><dt>Order</dt><dd>{curbEstimate.orderCubicYards.toFixed(2)} CY</dd></div>
                <div><dt>Material</dt><dd>{formatCurrency(curbEstimate.concreteCents / 100)}</dd></div>
                <div><dt>Labor</dt><dd>{formatCurrency(curbEstimate.laborCents / 100)}</dd></div>
                <div><dt>Saw-cut</dt><dd>{formatCurrency(curbEstimate.sawCutCents / 100)}</dd></div>
                <div className="total"><dt>Estimate</dt><dd>{formatCurrency(curbEstimate.totalCents / 100)}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="estimate-inputs">
              <div className="two-column">
                <label>
                  Pitch for new facets
                  <select value={defaultPitch} onChange={(event) => setDefaultPitch(Number(event.target.value))}>
                    {commonPitches.map((rise) => (
                      <option key={rise} value={rise}>
                        {rise}/12
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Waste %
                  <input type="number" min="0" max="100" value={roofWaste} onChange={(event) => setRoofWaste(event.target.value)} />
                </label>
                <label>
                  Ridge (LF)
                  <input type="number" min="0" value={ridgeLf} onChange={(event) => setRidgeLf(event.target.value)} />
                </label>
                <label>
                  Hips (LF)
                  <input type="number" min="0" value={hipLf} onChange={(event) => setHipLf(event.target.value)} />
                </label>
                <label>
                  Eaves (LF)
                  <input type="number" min="0" value={eaveLf} onChange={(event) => setEaveLf(event.target.value)} />
                </label>
                <label>
                  Rakes (LF)
                  <input type="number" min="0" value={rakeLf} onChange={(event) => setRakeLf(event.target.value)} />
                </label>
              </div>
              <dl className="estimate-summary">
                <div><dt>Footprint</dt><dd>{Math.round(roofEstimate.planAreaSqFt).toLocaleString()} sq ft</dd></div>
                <div><dt>Roof surface</dt><dd>{Math.round(roofEstimate.surfaceAreaSqFt).toLocaleString()} sq ft</dd></div>
                <div><dt>Squares (with waste)</dt><dd>{roofEstimate.squaresWithWaste.toFixed(2)}</dd></div>
                <div><dt>Shingle bundles</dt><dd>{roofEstimate.shingleBundles}</dd></div>
                <div><dt>Ridge cap bundles</dt><dd>{roofEstimate.ridgeCapBundles}</dd></div>
                <div><dt>Underlayment rolls</dt><dd>{roofEstimate.underlaymentRolls}</dd></div>
                <div><dt>Starter bundles</dt><dd>{roofEstimate.starterBundles}</dd></div>
                <div><dt>Drip edge (10 ft)</dt><dd>{roofEstimate.dripEdgePieces}</dd></div>
              </dl>
            </div>
          )}

          <button className="primary-button" type="button" onClick={createProjectFromEstimate} disabled={!hasMeasurements}>
            Create job from this estimate
          </button>
          <small className="measure-disclaimer">
            Measurements from map imagery are estimates. Verify critical dimensions on site before ordering material.
          </small>
        </aside>
      </div>
    </section>
  );
}

export default MeasurePanel;
