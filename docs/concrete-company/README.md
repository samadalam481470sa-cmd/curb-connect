# Concrete Company — Curb Connect

## Product intent

Concrete Company is an additive, tenant-isolated ready-mix and concrete operations workspace inside Curb Connect. It serves concrete producers, ready-mix fleets, batch plants, dispatch teams, QC staff, maintenance teams, project managers and drivers. It does not replace or migrate existing Curb Connect roofing, curb, bidding, billing, house-builder, plumbing, lawn, CRM or enterprise-construction workflows.

Each subscribing organization has its own plants, drivers, trucks, deliveries, telemetry, quality observations, maintenance records, device keys, alerts and integration connections. The active Curb Connect organization is resolved from the authenticated session; clients never submit an organization ID to select a tenant.

## Navigation and workspace

- Sidebar route: **Concrete Company** at \`/concrete-company\`.
- Phone navigation: a contextual Concrete tab replaces the Jobs slot while inside this workspace; all other destinations remain in the menu.
- Setup: owner/admin activates the workspace and sets the company display name and timezone.
- Areas: Overview; Fleet & Drivers; Dispatch; Quality & Maintenance; Integrations & Hardware; AI Insights.

## Feature map: purpose, inputs and actions

### 1. Executive operations overview

Purpose: give management one current view without inventing live numbers.

Actions:
- Count registered/active trucks, trucks moving from recent GPS, active drivers, open deliveries, open alerts and verified integrations.
- Open fleet, dispatch, quality or integration workspaces.
- Display alerts only when actual source data has been recorded.

### 2. Plants and batch locations

Purpose: maintain the plants that produce concrete and act as dispatch origins.

Data: plant code, name, address, city, region, optional coordinates and active/inactive state.

Actions:
- Create a plant.
- Select a plant when registering a truck or creating a delivery.
- Map a provider plant ID to a stable Curb Connect plant ID in future batching adapters.

### 3. Mixer fleet registry

Purpose: maintain one canonical truck record even when GPS, dispatch and quality data arrive from different vendors.

Data:
- Company truck number, VIN, make/model/year, plate, home plant and status.
- Current driver assignment.
- Telematics provider and provider vehicle ID.
- Latest GPS, heading, speed, last-seen timestamp, engine state/RPM/hours, odometer, fuel percentage, fault codes, drum RPM/direction, water additions and concrete temperature.

Actions:
- Register a truck manually.
- Import/upsert provider trucks by provider + external vehicle ID.
- Assign or unassign a company driver.
- View last known movement and signal freshness.
- Issue a unique device key for a truck-mounted gateway.
- Page through the fleet in bounded pages (200 in the web UI; API limit up to 500).

Movement semantics:
- Moving: latest telemetry is no older than 15 minutes and speed is greater than 2 mph.
- Stopped: latest telemetry is no older than 15 minutes and speed is 2 mph or lower.
- No signal: no last-seen timestamp or older than 15 minutes.
- This is a presentation state, not a claim that a driver is safe or a truck is mechanically available.

### 4. Driver operations

Purpose: give each company a controlled roster and associate driver activity with truck and delivery activity.

Data: employee/driver code, display name, phone, email, active/inactive/suspended status and optional external driver ID.

Actions:
- Create a driver.
- Assign a driver to a truck.
- Show assigned driver on fleet rows.
- Map provider driver IDs to canonical Curb Connect drivers in a provider adapter.

Access rule:
- Company administrators and permitted operations staff see their own company's roster and movement data.
- A future driver-facing portal must limit drivers to their own assigned deliveries and approved records.
- Do not expose one company's driver data to another company, customer or marketplace participant.
- Driver tracking must be disclosed in company policies and used for legitimate fleet operations; do not enable covert tracking.

### 5. Dispatch and delivery lifecycle

Purpose: connect batch plant, ticket, mixer, driver, jobsite and pour status.

Delivery fields: ticket number, customer, jobsite name/address/coordinates, mix code, ordered/loaded/delivered cubic yards, plant, truck, driver and scheduled time.

Lifecycle: scheduled → batched → loaded → dispatched → arrived → pouring → completed. Cancellation is allowed from eligible pre-completion states. Lifecycle timestamps are recorded by the server.

Actions:
- Create a delivery ticket and optionally assign plant, truck and driver.
- Move the ticket through valid lifecycle transitions.
- Record delivered yards at completion.
- Connect dispatch provider ticket IDs and e-ticket PDFs in a later adapter.
- Calculate arrival estimates when a supported GPS provider and jobsite coordinates are available.
- Future AI dispatch recommends trucks based on location, availability, plant, mix compatibility, driver hours, route and pour windows. It must show its rationale and a dispatcher confirms assignments.

### 6. Concrete quality and testing

Purpose: link quality evidence to the delivery ticket that produced it.

Supported observation types:
- Slump, concrete temperature, air content, unit weight.
- Seven-day and 28-day cylinder break.
- Water added and visual observations.

Each observation records value, unit, result, notes, observed timestamp and the user who recorded it.

Future integrations:
- Giatec SmartMix for mix optimization and QC history.
- Giatec MixPilot for in-transit workability measurements.
- Giatec SmartRock for placement temperature and maturity.
- Command Alkon Fleet IoT or equivalent feeds for drum RPM, water added and engine activity.
- Lab report OCR and certificate attachment through existing Curb Connect media/document infrastructure.

Safety: software observations do not replace required ASTM/ACI field tests, approved mix designs, qualified QC review or project specifications. AI may flag risk; it must not independently change a mix, authorize water addition or certify concrete.

### 7. Predictive maintenance and work orders

Purpose: reduce unplanned downtime while keeping a traceable maintenance record per truck.

Categories: engine, transmission, hydraulic system, drum, tires, brakes, electrical, sensor and other. Work orders store number, priority, status, description, due date, completion date and external maintenance ID.

Actions:
- Create and update a work order.
- Convert diagnostic fault events into maintenance alerts.
- Later calculate service intervals from odometer and engine hours.
- Connect Fleetio or OEM maintenance systems only where an authorized API is available.

### 8. Alerts and safety review

Purpose: turn telemetry and operational exceptions into owned work.

Initial rules:
- Engine fault codes ingested from a truck gateway create a high-severity alert.
- Stale telemetry is identified in insights.
- Low fuel, overdue delivery and overdue maintenance conditions create recommendations from current data.

Actions:
- View severity, message, source and timestamp.
- Acknowledge an open alert.
- Future: assign owner, add notes, resolve with evidence and retain an audit trail.

Alerts are not emergency-response systems. Retain existing driver emergency, dispatch and safety procedures.

### 9. Integrations and truck connectivity

The provider catalog separates tested adapters from vendor-access-required adapters. Registering a connector is not the same as a live connection.

| Provider | Product / interface | Data purpose | Current state |
|---|---|---|---|
| Samsara | Vehicle API | GPS, vehicle identity, engine stats | Initial bearer-token test and paginated inventory/GPS/engine-state/RPM/fuel/fault snapshot adapter |
| Geotab | MyGeotab SDK | GPS, trips, diagnostics, faults, maintenance | Listed; dedicated adapter required |
| Command Alkon | Digital Fleet / TrackIt / Fleet IoT | Ready-mix delivery, drum, water and engine data | Vendor API access and field mapping required |
| Jonel | Access Dispatch / FLEX API | Orders, batching, dispatch, e-tickets | Vendor API access and field mapping required |
| BCMI | API Portal / Logistics | Concrete logistics, CRM and materials | Vendor API access and field mapping required |
| Giatec | SmartMix / MixPilot / SmartRock | Mix QC, in-transit workability and pour data | Partner/API access and field mapping required |
| Curb Connect | Per-truck gateway | GPS, J1939/CAN read-only diagnostics, drum and auxiliary sensors | Native per-vehicle device-key ingestion endpoint |

Connection lifecycle:
1. Company owner/admin registers a provider.
2. Provider credentials are entered over the authenticated API.
3. Curb Connect encrypts bearer credentials at rest using AES-256-GCM with a key derived from the server session secret. Raw tokens are never returned by list endpoints.
4. Supported provider test verifies authentication before the connection is labeled connected.
5. Sync imports provider inventory and selected telemetry snapshots.
6. Unavailable vendor APIs remain \`vendor_access_required\` until the vendor issues credentials, documentation and approved scopes. Never show a fake Connected state.

### 10. Truck-mounted gateway protocol

The native gateway is the hardware path for vehicles that do not expose the required data through an existing telematics provider.

Provisioning:
- An authorized integration manager creates a key for one specific vehicle.
- The secret is displayed once. Only its SHA-256 hash and prefix are stored.
- The key is bound server-side to one organization and one vehicle.
- Future device-key management must support revocation and rotation.

Ingestion:
- \`POST /v1/concrete-company/gateway/telemetry\`
- \`Authorization: Bearer ccg_live_...\`
- Send batches of up to 50 timestamped events.
- Event IDs are idempotent per company/provider; replayed events are ignored.
- The API derives tenant and vehicle from the device key. It does not trust an org ID or vehicle ID supplied by the gateway.
- The gateway buffers while offline and retries with the same event IDs.
- Use TLS, cellular connectivity, secure boot where supported, signed firmware updates, tamper-resistant key storage and an installation record.

Hardware data path:
1. Vehicle GPS/telematics gateway reads location and vehicle data.
2. Approved J1939/CAN interface reads supported engine diagnostic/measurement messages in read-only mode.
3. Separate calibrated sensors read mixer drum RPM/direction, water-meter pulses and concrete temperature where installed.
4. Edge agent normalizes units, timestamps and device IDs.
5. Edge agent buffers and batches events.
6. Curb Connect authenticates the per-truck key, deduplicates event IDs, stores telemetry and updates the latest vehicle snapshot.
7. Fleet dashboard and alert rules consume the normalized state.

Do not transmit write commands to engine ECUs, ABS, transmission, brake, steering or drum-control circuits. J1939 support and available parameters vary by truck year, chassis and body-builder; verify the exact vehicle/sensor interface with the OEM and installer. The first hardware pilot must be read-only.

### 11. AI operations and optimization roadmap

The current insights endpoint is a transparent rules engine, not a trained ML model. It identifies stale telemetry, low fuel, reported fault codes, late deliveries and overdue work orders.

Models to train only after real data is connected and quality-checked:
- Predictive maintenance: fault-code, engine-hour, mileage, repair and downtime history.
- Arrival-time prediction: historical GPS routes, plant departure, traffic, geofence dwell and jobsite arrival.
- Dispatch optimization: plant, truck, mix, route, driver schedule, capacity and pour windows.
- Concrete workability risk: mix design, batch ticket, water additions, drum history, temperature, transit duration and lab/field observations.
- Material optimization: mix revisions, cementitious materials, aggregates, admixtures, strength results, yield and cost.
- Fuel/idle analysis: engine state, speed, route, idle periods and fuel consumption.
- Pour duration prediction: project volume, access, pump, crew size, placement rate, weather and historical pour logs.

Governance:
- Show confidence, contributing data and limitations.
- Maintain model version, training dataset lineage and evaluation metrics.
- Compare predictions with actual outcomes.
- Keep dispatch, maintenance, QC and mix changes under authorized human approval.
- Do not claim savings or prediction accuracy before a measured pilot.

### 12. Estimating, batching, jobsite and financial workflows

Planned connected capabilities:
- Concrete volume takeoff from plans: slab, footing, wall, column, grade beam and foundation quantities; convert cubic feet to cubic yards; show waste allowance separately.
- Mix-design library: strength, slump range, exposure class, water/cementitious ratio, cement, fly ash, slag, aggregates and admixtures; version and approve designs.
- Batch records: actual material weights, water, admixtures, yield, plant, ticket and operator.
- Material inventory: cementitious materials, aggregates, admixtures, stock levels, reorder points and supplier pricing.
- Pour planning: volume, truck spacing, plant capacity, pump availability, crew size, access, weather and placement rate.
- Jobsite supervisor: daily logs, voice notes, photos, hours, equipment usage, safety observations and inspections.
- Finance: delivery ticket to invoice matching, short-load/return tracking, fuel/maintenance cost, project margin and accounts-receivable reconciliation. Reuse Curb Connect Billing/Invoices rather than duplicating the accounting ledger.

### 13. Permissions and data isolation

- \`org:read\`: overview, provider catalog and company access.
- \`job:read\`: fleet, driver, plant, delivery, alert and maintenance views.
- \`job:write\`: operational record creation and status updates.
- \`integration:manage\`: provider setup, credentials and truck device-key provisioning.
- \`org:settings_update\`: workspace activation and settings.
- \`analytics:read\`: rule-based insights.
- API routes resolve the active organization from the authenticated session.
- Concrete tables live in the \`concrete_company\` PostgreSQL schema with forced tenant RLS.
- Composite foreign keys include org_id to prevent cross-company references.
- The gateway endpoint verifies a per-vehicle token using a named, audited platform operation and writes inside that token's tenant scope.
- Credentials are encrypted at rest; no credentials are included in API responses.

## Market research references

- Command Alkon Digital Fleet: https://commandalkon.com/products/digital-fleet/
- Command Alkon TrackIt: https://commandalkon.com/products/trackit/
- Samsara Telematics API: https://developers.samsara.com/docs/telematics
- Samsara REST API overview: https://developers.samsara.com/docs/rest-api-overview
- Geotab MyGeotab SDK: https://developers.geotab.com/myGeotab/introduction/
- Giatec SmartMix: https://www.giatecscientific.com/products/software/smartmix/
- Jonel FLEX API: https://www.jonel.com/concrete-technology/flex-api
- BCMI API Portal: https://www.bcmicorp.com/introducing-the-bcmi-api-portal-for-seamless-integration-with-concrete-producers-software/
- SAE J1939 heavy-duty vehicle network: https://saemobilus.sae.org/standards/j1939_202603-serial-control-communications-heavy-duty-vehicle-network-top-level-document

## Pilot and scale plan

1. Configure one pilot company, one plant, 10–20 trucks and 10–20 drivers.
2. Test manual fleet records and the Samsara adapter against an authorized API token.
3. Test one truck gateway on a read-only installation; validate units, signal loss, duplicate events and offline replay.
4. Validate dispatch lifecycle against actual delivery tickets and plant records.
5. Validate QC observations with the company's QC manager and applicable project specifications.
6. Compare telemetry completeness, dispatch dwell, truck idle, on-time delivery, fuel per yard, maintenance downtime and returned concrete against a baseline.
7. Expand in controlled cohorts. Do not bulk-enroll hundreds of trucks until data quality, permissions, key rotation and support procedures pass.

## Current release boundary

The implementation includes the tenant-isolated schema; fleet, driver, plant and delivery records; quality observations; maintenance work orders; alerts; provider catalog; encrypted Samsara credentials; a Samsara connection test and paginated vehicle and driver roster import plus GPS/engine-state/RPM/fuel/fault-code snapshot sync; per-vehicle gateway key provisioning; idempotent telemetry ingestion; and transparent rule-based insights.

It does not yet include certified truck hardware, continuous Samsara feed synchronization, Geotab/Command Alkon/Jonel/BCMI/Giatec live vendor adapters, trained ML models, automated batch control, production dispatch optimization, accounting ledger changes or a driver-only mobile portal. Those require provider credentials, hardware specifications, real operating data, test coverage and company approval.
