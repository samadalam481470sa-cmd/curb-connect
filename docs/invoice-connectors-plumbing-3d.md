# Field Pro — invoice delivery and Plumbing Pro 3D viewer

## Scope delivered in this increment

The existing network invoice and double-entry bookkeeping APIs remain authoritative; no financial database migrations are performed.

### Invoice delivery / cross-app import (Billing)

- Select an existing, company-owned invoice returned from the authenticated billing API.
- Review invoice number, recipient, due date, line items, and decimal-formatted totals derived from integer minor units.
- Export invoice lines as CSV with spreadsheet-formula injection escaping or a plain-text summary. No values are fabricated.
- Enter a recipient email and open a manually prefilled draft in Gmail, Outlook/Microsoft 365, or the device's default email app. The user must independently review and click Send.
- Preview TXT, Markdown, CSV, or JSON instructions from other apps locally in the browser; inputs have a 1 MB limit and JSON is parsed before display. Import never silently changes invoices, payment statuses, or company records.
- Statuses in the ledger do not change when an email draft is opened. Sending through a provider is **not** inferred or claimed.

**Not connected yet:** Direct Gmail API, Microsoft Graph/Outlook, Azure Blob, OneDrive/SharePoint APIs, automated outbound emails, attachments, bidirectional imports, and delivery receipts require each company to authorize accounts through a dedicated server-side OAuth integration with isolated credentials, token encryption, least-privilege scopes, audit logs, refresh/revocation, and tenant-aware access controls. There is no safe way to claim those providers are connected from a compose-link alone. The web app's Microsoft sign-in does not grant Graph mail permissions. Avoid email tokens or cloud credentials in browser localStorage.

### Plumbing 3D (Plumbing Pro)

A lightweight SVG orthographic 3D renderer works on iPhones, tablets, and desktops without requiring WebGL or third-party rendering CDNs. It includes:

- Rooms with explicit metre-based x/y dimensions and ceiling heights.
- Explicit XYZ pipe polyline coordinates and material-system color coding.
- Rotation, elevation angle, zoom, room-outline and plumbing-system visibility controls.
- Computed 3D segment lengths using Euclidean geometry (metres), pipe diameter labels, and warnings for points outside all supplied room volumes.
- A ready-to-download example JSON model. You can upload a structured Field Pro model JSON (up to 8 MB) with strict validation of coordinates, counts, finite values, IDs, and diameters.
- PNG/JPEG/WebP reference images (8 MB maximum) for side-by-side visual reference, **not automatically converted to 3D**. The example image/JSON is never treated as a real architectural plan.

The model JSON schema is: \`{ "schemaVersion": 1, "units": "m", "rooms": [{ "id": "...", "name": "...", "x": 0, "y": 0, "width": 4, "depth": 3, "height": 2.6 }], "pipes": [{ "id": "...", "name": "...", "system": "cold_water", "diameterMm": 20, "points": [{ "x": 0, "y": 0, "z": 0 }, { "x": 3, "y": 0, "z": 0 }] }] }\`.

**Not automatic BIM:** This does not claim to generate a dimensionally accurate 3D model from raster plans, scanned PDFs, DWG, or IFC. IFC/DWG parsing and BIM reconstruction are separate engineering integrations with calibration, storey extraction, element classification, coordinate systems, uncertainty quantification, architectural review and clash detection; false automatic precision would be dangerous on construction projects. No professional code approval, clearance certification, slope checking, or regulatory verification is implied.

## Testing

- Invoice compose URL encoding, invalid addresses, spreadsheet-safe CSV and import validation.
- Model schema validation, 3D pipe lengths, projection stability and out-of-volume flags.
- Existing repository CI: lint, typecheck, unit tests, production build, PostGIS integration and Python vision.
- Test authenticated Billing and Plumbing screens in a browser before claiming mobile production acceptance.

## Next implementation priorities

1. Backend connectors API with provider auth initiation/callback, signed state, PKCE, tenant-scoped token vault, disconnect, least-privilege Graph/Gmail send scopes, encrypted attachment storage, delivery receipts and audited outbound queue.
2. Company-customizable invoice templates, external customer directory, server PDF rendering, payment links and recurring billing with idempotent invoice generation.
3. Plan upload processing: S3 object storage, PDF rasterization, vector CAD/IFC conversion, point picking, image-to-world calibration, room reconstruction and explicit professional approval.
4. 3D collision and clearance calculations using BIM geometry and code-specific rules; integration with the existing estimate engine only after geometry is independently validated.
