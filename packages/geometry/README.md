# @fieldline/geometry — calculation specification (geometry)

Pure, deterministic geometry for roof facets, curb segments, image calibration and units. No I/O,
no clock, no randomness. `GEOMETRY_VERSION` (1.0.0), `TOPOLOGY_VERSION` and `CALIBRATION_VERSION`
are stored with every geometry revision; bump them on any algorithm or validation-rule change.
Requirement ids (RF-0xx, CV-0xx, CP-0xx) refer to the blueprint pages.

## Numeric model and determinism

- float64 throughout. `+ - * /` and `Math.sqrt` are correctly rounded, so results from them are
  bit-identical in every JS engine. Trigonometric functions (projection, arc sampling, pitch
  degrees, angle thresholds) may differ by about 1 ulp between engines.
- Sums of many terms use Neumaier compensated summation in caller order (`neumaierSum`).
- Shoelace area is computed relative to the first vertex to limit cancellation at large coordinates.
- Persisted values are never rounded by this package. Display rounding (`roundHalfAwayFromZero`,
  `formatQuantity`) rounds half away from zero on the shortest decimal form of the double, so
  1.005 becomes 1.01.

## Units (PLT-019, CP-051)

Canonical storage: meters, m², m³. Conversions happen only at input and display boundaries.

| unit           | SI value (exact by definition) |
| -------------- | ------------------------------ |
| ft             | 0.3048 m                       |
| in             | 0.0254 m                       |
| yd             | 0.9144 m                       |
| ft²            | 0.09290304 m²                  |
| yd²            | 0.83612736 m²                  |
| in²            | 0.00064516 m²                  |
| roofing square | 100 ft² = 9.290304 m²          |
| ft³            | 0.028316846592 m³              |
| yd³            | 0.764554857984 m³              |

`convert(v, from, to) = v * SI(from) / SI(to)`. Converting between dimensions throws
`dimension_mismatch`. A round trip unit → SI → unit is exact to a relative error of 1e-12 (tested).
Display decimals: m 3, ft 2, in 2, ft² 1, m² 2, squares 2, yd³ 2, m³ 3.

## Projection (RF-023, RF-025)

A lon/lat ring is projected to a local tangent plane (East-North-Up) on the WGS84 ellipsoid
(a = 6378137, f = 1/298.257223563). The steps are geodetic → ECEF → ENU about one origin (by
default the mean vertex); the up component is dropped. For extents under 1 km the planar
distortion is below 1e-7 relative.

## Polygons (RF-023 S, RF-025)

Rings are open (closure implied) and counter-clockwise is canonical.

- signed area `A = ½ Σ cross(p0, pi, pi+1)`
- perimeter: the sum of edge lengths
- centroid: the area-weighted triangle-fan formula (zero area throws)
- `normalizeWinding` reverses a clockwise ring and keeps vertex 0

`validatePolygon` returns typed issues and never throws:

- `non_finite_coordinate`
- `unclosed` (only in `closed: true` mode)
- `too_few_vertices` (< 3)
- `duplicate_vertex`
- `zero_area` (|A| ≤ 1e-9 m²)
- `self_intersection` (crossings, touches or fold-backs between edges)

Default length tolerance: 1e-6 m. `polygonsOverlap` reports a shared interior: a proper edge
crossing, a vertex strictly inside the other polygon, or mutually contained interior points.
Shared edges or vertices alone do not count as overlap.

## Pitch (RF-027)

Pitch is stored as rise/run (`r = rise/run`, run > 0, rise ≥ 0).

- slope factor `k = sqrt(1 + r²)`
- sloped area `= plan area × k`
- degrees `= atan(r)`
- rise per 12 `= 12r`
- true edge length `= plan length × sqrt(1 + (r·cosθ)²)`, where θ is the plan angle between the
  edge and the facet's downslope direction:
  - level edges (eave, ridge) keep their plan length
  - rakes get `× k`
  - a 45° hip or valley between equal pitches gets `× sqrt(1 + r²/2)`; at 6/12 a 10√2 ft hip is
    exactly 15 ft

Each facet keeps its own pitch. A predominant pitch never replaces per-facet values.

## Roof topology (RF-024, RF-025, RF-028)

`analyzeRoof({ facets, edgeLabels?, excludedStructureIds?, options? })`

1. **Snapping:** vertices are visited in facet order, then vertex order. A vertex joins the first
   existing node within `snapTolerance` (default 0.01 m). The node keeps the first vertex's id and
   position, so the result is deterministic and positions are not averaged. Consecutive vertices
   that collapse onto one node raise `collapsed_vertex` (a warning).
2. **Facet validation:** polygon issues raise errors. Facets are normalized to CCW. Other checks:
   `duplicate_facet_id`, `duplicate_facet` (same node set) and `overlapping_facets`.
3. **Edge graph:** each physical edge is stored once, under `edgeKey(a, b)` (its sorted node ids),
   with the ids of every adjacent facet. The graph checks also catch:
   - `t_junction`: a node lies on another edge's interior
   - `non_manifold_edge`: more than 2 facets share an edge
4. **Classification:** for each adjacent facet the engine computes `rise = -r · (n_in · u)`, where
   `n_in` is the inward normal and `u` the unit downslope. Negative means the facet falls away
   from the edge. An edge is _level_ when |d·u| ≤ sin(1°). Rules:
   - boundary edge on a flat facet: `perimeter`
   - level boundary edge, facet rises inward: `eave`
   - level boundary edge, facet falls inward: `flashing` (wall at the high side)
   - boundary edge along the fall line: `rake`
   - any other boundary edge: `unclassified` (oblique)
   - two facets that both fall away: `ridge` if level, else `hip`
   - two facets that both rise: `valley`
   - mixed: `flashing` if level, else `step_flashing`
   - flat-to-flat or flat-to-sloped: `unclassified`
   - an edge is also `unclassified` when a pitch or downslope is missing
5. **Labels:** a manual label overrides the derived type. It is a `label_conflict` error when:
   - ridge, hip or valley is used on a boundary edge or between non-sloping facets
   - eave, rake or perimeter is used on an interior edge
   - a strong derived type (ridge, hip, valley, eave, rake) is contradicted
6. **Lengths:** plan length is the node distance. True length comes from each adjacent facet's
   plane, and the facets must agree within 1e-6 (`edge_length_mismatch`). It is null when a
   needed pitch or direction is unknown.
7. **Areas:** `net = plan − Σ exclusions`. Exclusions must be valid and inside the facet
   (`invalid_exclusion`). `sloped = net × k`, or null when pitch is unknown, which makes every
   total containing that facet null too.
8. **Totals:** for each edge type, the count, plan length and true length, with each edge counted
   once. Area totals are given per structure and for the property (included structures only).

`valid` is true when there are no error-severity issues. Only valid geometry may be priced.

**Golden fixture:** a six-facet L hip roof (see `src/fixtures.ts`). It has 20 ft arms, the
footprint (0,0)-(40,0)-(40,20)-(20,20)-(20,40)-(0,40) and every facet at 6/12.

- facet plan areas: 300, 100, 200, 200, 100 and 300 ft² (1200 total); sloped = plan × √1.25
- eaves: 6 edges, 160 ft
- ridges: 2 edges, 40 ft
- hips: 5 edges, 50√2 ft plan, 75 ft true
- valley: 1 edge, 15 ft true

## Editor command log (RF-023, RR-032)

Commands: `add_vertex`, `move_vertex`, `delete_vertex` (rejected while a facet uses the vertex),
`add_facet`, `delete_facet`, `split_facet` (between two non-adjacent vertices), `merge_facets`
(exactly one shared edge; the first facet's pitch is kept), `relabel_edge` (null clears the
label), `set_pitch`, and `exclude_region`.

The state is a pure function of the command list: `state = replay(commands)`. Undo moves a
cursor back and replays the prefix. Redo re-applies one command. A new command discards the redo
tail. `appliedCommands(history)` is the persisted form. Ids are supplied by the caller, so replay
after a reload reproduces bit-identical totals (tested). Invalid commands throw
`GeometryError('invalid_command')` and leave the history unchanged.

## Curb segments (CV-047, CP-051)

Segment kinds are `straight`, `curved`, `corner` and `return_transition`. Geometry roles are
`saw_cut_path`, `removal_footprint`, `return_transition` and `replacement_area`.

- Length is the piecewise polyline length. A corner is the sum of both legs, never the diagonal.
- Curved curbs must be traced piecewise:
  - a 2-point curved segment is `chord_only_curve`
  - when the design arc is known, a deviation above `maxSagitta` (default 0.01 m) is
    `curve_deviation`
- `arcToPolyline` samples `n = ceil(|sweep| / (2·acos(1 − s/r)))` chords. The sagitta per chord
  is ≤ s (default 5 mm).
- Other validation issues: `too_few_points`, `zero_length`, `self_overlap` and
  `duplicate_linework` (collinear overlap between segments longer than the tolerance). Touching
  end to end and crossing are allowed.
- `curbLengths` throws on any issue, so only valid geometry is measured.

## Calibration (CV-045, RR-032)

- **2-point reference scale:**
  - `m/px = L / |p1 − p2|`
  - relative σ `= hypot(√2·σpx/px, σref/L)`
  - fails with `reference_too_short` (< 20 px or < 0.1 m) or `invalid_input`
  - it is advisory: valid only in the reference plane facing the camera
- **Homography (≥ 4 points, image px → plane m):**
  - normalized DLT (Hartley: centroid at the origin, mean distance √2), least squares with h33 = 1
  - explicit failures:
    - `degenerate_reference`: three collinear points
    - `reference_too_short`
    - `inconsistent_orientation`: crossed points, or points across the horizon
    - `singular`
    - `out_of_plane`: RMS reprojection error > 0.02 m. This needs ≥ 5 points; 4 points fit
      exactly and cannot prove planarity.
- **Measurement:** `measureLength(cal, a, b)` returns `{state:'unknown'}` unless the calibration
  is valid. σ = sqrt(Σ(∂L/∂pixel)²·σpx² + 2·RMS² + σref²), with the Jacobian taken by central
  differences of 0.5 px. A precise length is never returned without a valid calibration.
