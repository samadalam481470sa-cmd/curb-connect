# @fieldline/pricing — calculation specification (quantities and money)

Pure, versioned decimal calculation library shared by both trades: roof takeoff and the curb cost
model. It is built on decimal.js only, with no I/O. `ENGINE_VERSION` (1.0.0) and the per-recipe
formula versions (`ROOF_TAKEOFF_VERSION`, `ROOF_WASTE_VERSION`, `CURB_QUANTITY_VERSION`,
`CURB_RECIPE_VERSION`, `SAW_PRODUCTION_VERSION`) are recorded on every output. Bump them on any
rule, rounding or default change. A rule change never alters a stored, signed result: callers
persist inputs and these versions and replay them.

## Numbers, money and rounding

- `PricingDecimal`: 40 significant digits, ROUND_HALF_UP.
- Inputs are decimal strings (preferred) or finite numbers. `dec()` rejects NaN, Infinity,
  exponent strings and junk.
- Money is `{currency, minor: bigint, amount: "3744.00"}`. Minor digits follow ISO 4217 (USD 2,
  JPY 0). `toJSONSafe` turns bigint into a string.
- **Named rounding stages.** Each stage rounds half-up to the minor unit exactly once and is
  recorded in `Breakdown.rounding`. Values between stages keep full precision. The stages, in
  order: `line_extension`, `surcharge`, `overhead`, `contingency`, `price`, `discount`,
  `minimum_charge`, `tax`.
- Quantities are never rounded except at the pack order stage (see below). Display strings use
  `fmt()` (half-up, 4 dp) and are never fed back into calculations.
- Percentages are fractions: `0.10` means 10%.

## Shared engine: `priceEstimate` (BO-065, CP-052, CP-058)

Each cost line carries:

- quantity, unit and unit rate
- `critical`, category and `taxable`
- `sourceRevision`, `formulaVersion`, `confidence` and the formula text

A quantity or rate is either a decimal or `Bounded {low, base, high, reason}`; null means
unknown or unpriced. This is the one order of operations:

1. line extended = quantity × unit rate (rounded at `line_extension`)
2. surcharges (complexity surcharge) = rate × Σ the targeted lines' extensions
3. direct cost = Σ priced lines + surcharges
4. overhead = direct × overheadRate
5. contingency = (direct + overhead) × contingencyRate
6. cost basis = direct + overhead + contingency
7. price: either markup `basis × (1 + k)` or target gross margin `basis / (1 − m)` with
   0 ≤ m < 1. Supplying both throws `markup_and_margin`.
8. discounts are applied in the listed order. A percent discount applies to the running amount;
   a fixed discount subtracts. The amount never goes below zero.
9. minimum job charge: raise the pre-tax subtotal to the minimum (the adjustment is shown)
10. tax = subtotal × rate (or subtotal × taxable direct ÷ direct when `basis: taxable_share`).
    An exemption with a certificate id makes it 0 and is flagged.
11. total = subtotal + tax

Reported margins:

- gross margin = (subtotal − basis) / subtotal
- markup on cost = (subtotal − basis) / basis

Flags:

- `below_margin_floor` when the realized margin is below `marginFloor` (approval needed)
- `site_verification_required` when (high − low) / base exceeds `uncertaintyThreshold`

**Unknowns:**

- A critical line with an unknown quantity or no approved rate makes the estimate
  `status: 'pending_review'`, `scenarios: null` and never $0.
- A non-critical unresolved line is excluded and flagged `unresolved_optional_line`.

**Scenarios:** low, base and high use every bounded input at its low, base or high value (bounded
assumptions, not probabilities). `firm` is false whenever any input is bounded. `rangeDrivers`
lists each bounded input, ranked by its one-at-a-time direct-cost swing, together with its
reason.

**Golden test (page 060, a synthetic example and not a market quote):**

| line             | quantity | rate | amount |
| ---------------- | -------- | ---- | ------ |
| cutting          | 18 ft    | $20  | $360   |
| mobilization     |          |      | $400   |
| breakout         | 18 ft    | $28  | $504   |
| disposal         |          |      | $220   |
| replacement      | 18 ft    | $95  | $1,710 |
| traffic control  |          |      | $350   |
| permit allowance |          |      | $200   |

Direct cost is $3,744.00. With 10% overhead the cost basis is $4,118.40. At a 25% target margin
the price is $4,118.40 / 0.75 = $5,491.20, before tax. A 25% markup instead gives $5,148.00 (a 20%
gross margin).

## Roof (RF-027, RF-029, RR-034, RR-035)

- slope factor = sqrt(1 + (rise/run)²), in decimal
- sloped area per facet = net plan m² × factor
- ft² = m² / 0.09290304
- squares = ft² / 100
- totals are given per structure and for the property (structures not excluded). Unknown pitch
  makes the affected total null.
- edge lengths in, per type: true meters → lf. A missing key means 0; null means unknown.

**Waste** is a decision table: `WasteRuleSet {ruleVersion, applicability, rules}`. The first
matching rule wins and returns its rate, reason code and rule version. Outside applicability, or
when no rule matches, there is no recommendation and a human value with a reason is required.
`selectWaste` prefers the override but keeps the recommended rate for display.
`EXAMPLE_WASTE_RULES` is synthetic and must be replaced by the organization's validated rules.

**Materials:** one line per material class, in these stages:

1. base quantity:
   - sloped ft² for shingles and underlayment
   - Σ edge types in lf for starter (eave + rake), ridge cap (ridge + hip), drip edge, valley and
     flashing (flashing + step flashing)
   - a count for vents
2. with waste = base × (1 + waste of that class). Waste is applied once and only for its own
   class; count-based lines take no waste.
3. exact packs = with waste ÷ coverage per pack (full precision)
4. order packs = exact packs rounded up. A value within 1e-9 of an integer is treated as that
   integer, which absorbs sqrt noise, so exactly 30 packs stays 30.

Unknown coverage, base or waste gives an unresolved line with a reason. Default brand dimensions
are never substituted. Every line carries formula text such as
`1341.6408 ft2 x (1 + 10.00% waste) = 1475.8049 ft2 / 33.3333 ft2 per bundle = 44.2741 -> order 45`.
`roofCostLines` turns order packs × price, plus labor per square (sloped area, no waste), into
engine lines.

## Curb (CP-051, CP-053, CP-054, CP-055)

A dimension is `known`, `bounded` or `unknown`, and arithmetic propagates the state. Unknown
buried dimensions therefore give an unknown result or scenario bounds, never a guess.

- cut length = Σ validated piecewise segment lengths (from geometry). A corner is its legs.
- saw pass length = cut length × passes
- inch-feet = pass length (ft) × depth (in). A depth of zero is an issue (`zero_depth`) and makes
  depth unknown.
- removal area = removal length (defaults to the cut length) × removal width
- volume ft³ = confirmed cross-section (ft²) × removal length; yd³ = ft³ / 27
- restoration = length, and area = length × width when the width is given

Units convert exactly in decimal (10 ft = 3.048 m; 216 in² = 1.5 ft²).

**Saw production (CP-053):** the rate table carries revision, region, effective date and source.

- setup hours = setupHoursPerSegment × segments. This is separate from productive time.
- productive hours = pass length ÷ the ft/h of the narrowest rule matching depth, reinforcement
  and access
- blade wear = inch-feet × blade cost
- unknown depth or reinforcement evaluates every plausible rule and returns a bounded quantity
  marked low confidence: the fastest rate gives the low bound and the slowest the high bound

**Curb recipe:** each component has:

- a basis: fixed, cut_length_ft, saw_pass_length_ft, inch_feet, removal_area_ft2,
  removal_volume_yd3, restoration_length_ft, restoration_area_ft2 or segment_count
- a price-book item and a `critical` flag
- optional graduated tiers for tiered length pricing: each portion is priced at its tier's rate,
  only the last tier may be unbounded, and the line shows the blended rate

Typical components are mobilization, saw cutting, breakout, hauling and disposal, restoration and
replacement, traffic control, permits and other verified allowances. A minimum trip charge and a
complexity surcharge come from the shared engine policy and surcharges.
