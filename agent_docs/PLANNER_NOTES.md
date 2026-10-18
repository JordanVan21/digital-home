# Aesthetic planner: approved direction and build log

This document replaces the older whole-house handoff where decisions differ. The user approved the single-room direction and a visual feedback experiment on 2026-10-18. `CONTRACTS.md` remains authoritative for shared meanings. Do not modify the older `AESTHETIC_PLANNER_NOTES.md` if it is brought over later.

## 1. Current application

The starting point is codex-base `da1ddb8`: the sandbox already loads scanned rooms and assets from Supabase. `feature/room-scanner` has the scanner worker and render agent, including `asset_requests`. Those components are being integrated separately; do not copy or merge them into this feature. No scanner/database migrations are part of this milestone.

## 2. Approved product decisions

- One room for the hackathon. Preserve its function and essential furniture/capacity.
- Furniture/decor may change; shell geometry and wall/floor finishes stay fixed.
- Lock preserves everything about a piece. Keep preserves physical identity, model, size and appearance but permits movement. Replace/Remove are instructions. Lock wins conflicts.
- Images only, questionnaire only, or both. Explicit answers beat image guesses. Every style value eventually carries provenance and is editable before planning.
- Missing models are labelled placeholders, with appearance explicitly unverified. Users may eventually accept them.
- Planning works on a frozen saved-room snapshot. The original can continue being edited independently.
- Accept design saves a separately named version and opens it. Original and subsequent original edits remain selectable. No merging changes between versions; original edits do not make this separate design unsaveable.
- Reject design changes no saved scene. No unfinished-run restoration for the hackathon.
- Slow models eventually swap in during proposal review. Accepted versions stay frozen; later model adoption must be explicit.
- Failed mandatory replacement/placement blocks completion with an explanation. Never quietly present a failed instruction as successful.
- Budget and purchase timeline ARE part of the hackathon, but are planned/built AFTER the aesthetic planner. Preserve integer-cent estimates, null unknown prices and replacement lineage now.
- One proposal, at most two visual repair rounds and a time cap. No partial proposal editing yet; revise the brief and run again.
- Clearly labelled demo fallback and Retry on AI failure.

## 3. Planner responsibilities

Approved brief → room composition and relational intents → render requests → deterministic placement → shared geometry validation → three actual rendered views → visual critique → up to two repairs → user preview.

The model reasons about coherent design and usability. It never invents coordinates or asset IDs. The render module owns model retrieval/edit/build. Code owns locks, instructions, geometry, physical replacement identity and prices. Visual scores are subjective, not a correctness proof.

## 4. Build order

1. **Core experiment first:** one existing room + cozy Japanese–Scandinavian brief; exercise planning, model requests, placement, capture, critique and repairs. Review together before expanding screens.
2. Furniture review: Lock and Keep/Replace/Remove.
3. Private inspiration upload and short questionnaire (style, palette, materials, mood/lighting, household, free text).
4. Editable interpreted style summary, provenance labels and natural-language corrections.
5. Broaden room composition/placement and live render integration based on the experiment's results.
6. Full preview: before/after, highlights and change list.
7. Accept/Reject, immutable named versions, version picker and rename.
8. Full input combinations, adverse cases and demo verification.
9. Budget/timeline planning and implementation as a separate subsequent workstream.

## 5. Merge boundaries

- `packages/aesthetic-planner`: pure typed planner, placement candidates and bounded loop; no browser or provider credentials.
- `apps/planner-server`: server-only model calls and adapter to the existing render request queue. Uses the signed-in user's JWT/RLS, never service-role privileges for queue requests.
- `apps/web/src/planner`: isolated experiment, actual shared Model/Room/Lighting rendering and image capture.
- Shared sandbox hooks: top-bar entry, lazy experiment route and Vite proxy. Shared schemas are additive in `contracts/src/aestheticPlanner.ts`.
- No changes to the scanner, cloud save path, editor scene/draft semantics or render-agent implementation.

## 6. Model settings

Read the scanner's private `.env` using `PLANNER_ENV_FILE`; never copy, modify or expose it. Pro handles text planning; Flash handles image review. Current official DeepSeek docs confirm `deepseek-flash` image input via `image_url` content in chat completions. Keep both names configurable. Sources: https://api-docs.deepseek.com/quick_start/pricing/ and https://api-docs.deepseek.com/api/create-chat-completion/.

## 7. What storage/integration needs later

Use a PlannerStorage port for saved inputs, private images, briefs, proposal snapshots, named immutable versions and price/change records. Adapt it to the existing database instead of introducing competing scan/room tables. Proposals reference their frozen starting snapshot, not a mutable original head. Accept must validate and write a new version atomically and idempotently. This experiment intentionally has no accept/save endpoint and keeps sessions only in server memory.

## 11. Build log

### Core visual-feedback experiment (2026-10-18)

Implemented the separate planner package/server/lab, strict semantic intent schemas, locked/Keep/Replace/Remove enforcement, actual worker queue adapter, deterministic relationship-ranked placement followed by `resolveDraft`/`validateObject`, safe scene-operation replay, replacement identity and price records, candidate-bound three-view capture and bounded visual repair. Before/after uses the original snapshot; no proposal writes into the accepted scene or draft.

Verification and limitations are recorded in `apps/planner-server/README.md`. Real-provider smoke checks and the opt-in visual evaluation write local artifacts under ignored `test-results/`; these are not evidence of authenticated render-worker integration.

Real-provider evidence: Pro planning smoke 7.546 s, Flash palette/material reading 1.753 s. A complete evaluation reused a recorded real Pro plan and ran live Flash on freshly captured proposals: 23.913 s excluding planning, three reviews, two repairs, scores 8/15 → 7/15 → 7/15, so the initial valid candidate was retained. This did not demonstrate quality improvement or authenticated render-worker integration. Optional decor that cannot fit is visibly left out; required replacements remain mandatory.

Final checks passed: TypeScript, ESLint, all 255 unit/integration tests, web production build, and all 28 GPU Chrome browser tests (2.2 minutes). Verified the built browser files contain none of the private keys read from the scanner environment. The existing navigation browser test needed a readiness guard for its selected object and camera projection; no editor or geometry behavior was changed.

Try: http://127.0.0.1:5191/?planner-lab → Demo fallback (scripted) → Run design experiment → Show before / Show proposed design → Actual views sent for review. The API runs at 127.0.0.1:8791. Stop here for user review before building the next stage.

### Model sourcing and visible connection status (2026-10-18)

The server now reads verified shared catalog metadata with a bundled offline fallback. Usable closest render-worker matches remain real models and carry an explicit compromise label; uniform fitting follows the render module's minimum scale of 0.5. Requests deduplicate, wait through intermediate worker results and distinguish missing infrastructure, delay, failure, invalid output and no match. Unsupported optional mounted decor is not sent to the queue.

The lab includes the existing sign-in control, a furniture-connection check before paid AI calls, per-object loading/failure status, and a clearly labelled catalog demo using real alternative furniture. Screenshot capture waits for actual models and lighting; unavailable pieces are reported individually. Service failures show a recoverable plain-language message. No shared sandbox component or saved-scene behavior changed.

Read-only integration check: 233 catalog rows, 232 usable verified assets; `asset_requests` returned 404 / PGRST205. The existing integration/scanner migration is `supabase/migrations/20261018140000_asset_requests.sql`. It must be deployed through integration before live owner-authenticated worker verification. No database schema/rows were changed and no temporary account was created. No new paid AI evaluation was run; design quality and authenticated worker integration remain unproven.

Checks passed: typecheck, lint, 271 unit tests, production build and three GPU Chrome planner browser tests. The demo visibly changed sofa/chair models and showed 12 real models ready, one unchanged scanned placeholder and zero model-load failures. Before/after leaves the saved scene identical. Browser bundle checked against private environment keys.

Try: http://127.0.0.1:5191/?planner-lab → Catalog demo (real furniture) → Run design experiment → Show before / Show proposed design. Expect real alternative furniture, a model-status count and clearly scripted review. Live mode explains its missing connection and stays disabled. Stop here for user review. Intake, editable style summary, full preview highlights and named-version Accept/Reject remain later steps.
