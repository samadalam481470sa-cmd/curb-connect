# AI Architecture reel — five tool ideas in Field Pro

Source: Instagram reel DfhXv2LA5MM (AI Architecture, "5 AI tools for architecture on GitHub").
All five were built additively, in the reel-rundown order. No code was copied from any of the
five repos: OpenConstructionERP is AGPL-3.0 (ideas only), the Revit MCP tools need live Revit
on a Windows desktop (pattern only), and no priced cost database was copied or invented.

## 1. Concept check for House Studio plans — BUILT

- `apps/web/src/features/build/conceptCheck.ts` — pure rules over the schematic room
  rectangles: room too small (stated planning minimums, shown in the UI), bath with no hall
  access (ensuite-only is a note, fully enclosed is a problem), bedroom/primary with no
  exterior wall (no egress window wall on the sketch), two stories with no stair, program
  count mismatch, plumbing spread over 40 ft (soft cost note), plus room overlaps and
  out-of-bounds from manual edits.
- `ConceptCheckPanel.tsx` in the House Builder, under the floor plan: findings in plain
  language with a suggested fix; clicking one highlights the room in the plan. An area
  schedule lists every room's area from the same rectangles.
- Labeled **"not a code review"** in the panel: the rectangle model cannot see doors,
  windows, structure or local code. No API change, no migration, nothing to connect.

## 2. Plain-language house-model chat — BUILT

- `POST /v1/assistant/house-model` (`apps/api/src/modules/assistant/houseModel.ts`): the web
  app sends a client-computed summary of the house on screen (program + room schedule); the
  assistant answers from that summary only, through the existing home-AI-first hook (the
  user's Qwen, open model backup). Read-only: it cannot change the house and says which
  control does. When no AI is reachable it returns an honest "not available" error — never
  an invented answer.
- `HouseModelChat.tsx` panel in the House Builder ("Ask about this house").

## 3. Photo → draft cost estimate — BUILT (flow existed; status + draft labeling added)

- Plan photos already read through `POST /v1/home/brief` (Anthropic key or the open vision
  model, Qwen2.5-VL by default) into a house program, which drives the takeoff and priced
  estimate. Roof photos already go through roof auto-detect (candidate facets → contractor
  confirmation → measurement → estimate). Both stay gated on a vision-capable model: the
  home AI server's default model is text-only and does not count.
- Added `GET /v1/home/brief/status` + a status line in the AI build bar so the gated state
  is visible before uploading, and a "Draft estimate" banner in the House Builder when the
  current house was read from a plan/photo. Contractor prices only; nothing is invented.

## 4. Auto-tagging / audit agent for uploaded plans — BUILT

- `POST /v1/plan-to-bid/audit` (`apps/api/src/modules/planToBid/audit.ts`): reuses the
  deterministic plan reader (keyword tagging with evidence snippets + measured geometry)
  and the optional AI classification, then audits: trades never named in the plan text,
  tagged items without quantities, low-confidence or scale-less geometry, unlabeled or
  duplicate rooms, measured doors/windows without schedules, and stated area vs measured
  outline disagreement.
- "Audit this plan" button + findings/tags section in Plan-to-Bid. Real element detection
  (fixtures, symbols in a scan) needs a vision model and is **not** claimed — the audit
  works on text and measured lines and says so.

## 5. 2D room layout editing with 3D preview — BUILT (usable slice)

- Room edits (`apps/web/src/features/build/roomEdits.ts`): move/resize the generated room
  rectangles in the CAD plan editor (drag, corner handle, or typed X/Y/W/D), stored on the
  house spec (`roomEdits`, round-trips through saved houses) and applied inside
  `computeTakeoff`, so the takeoff, 3D studio, concept check and exports all follow the
  edited plan. Undo/redo and "Reset room edits" included.
- What is **not** in: no freeform walls (rooms stay axis-aligned rectangles), no adding or
  removing rooms in the editor (the program controls do that), no door/window placement,
  garage is not editable. Edits are keyed by generated room id — changing the program can
  renumber rooms and orphan an edit (orphans are ignored). Overlaps are allowed while
  dragging and flagged by the concept check. This is the realistic slice of the Pascal
  Editor idea, not a Pascal clone.

## Verification

Lint, typecheck, full unit suite and login tests run before push; exact counts are in the
push report. Visual verification in a real browser is still outstanding for the new panels
and the room dragging — verified by typecheck + unit tests only.
