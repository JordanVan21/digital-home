# Aesthetic planner: implementation handoff

Written 2026-10-18, after commit `e4eb13e`. Read this before implementing more work. This handoff describes the **current single-room experiment**, not the superseded whole-house plan pasted earlier in the conversation.

## 1. Goal and current state

The user describes an aesthetic, for example “cozy Japanese–Scandinavian.” The planner should understand its palette, materials, lighting and atmosphere; compose a useful room; request furniture from the existing 3D render module; place it using shared geometry rules; inspect actual rendered views; and improve the proposal before showing it to the user. The user eventually accepts it as a separately named design or rejects it without changing their original room.

The difficult core loop now exists. The full consumer feature does not. Current UI is an isolated developer experiment at `http://127.0.0.1:5191/?planner-lab`, with an editable JSON brief. There is no questionnaire, inspiration upload, interpreted-summary screen, Accept/Reject persistence, or named-version picker yet.

The most recent step fixes model sourcing and loading visibility. The catalog demo visibly replaces sofa/chair models with real furniture. It is **scripted design and scripted review**, not proof that live AI produces a good design.

**First next task:** get the existing render-worker queue deployed/connected through the integration workflow, then run and assess one authenticated live design on a real scanned room. Do not build more screens on an assumed working live pipeline.

## 2. Workspace, branch and reading order

- Feature worktree: `/Users/jeffreyg/Projects/digital-home/.worktrees/aesthetic-planner`.
- Feature branch: `feature/aesthetic-planner`. Root checkout `/Users/jeffreyg/Projects/digital-home` is on `main`; do not accidentally implement there.
- Relevant commits: `cba5ad4` (isolated visual-feedback experiment), `e4eb13e` (real model sourcing and readiness). Nothing was pushed in this session.
- Scanner worktree: `/Users/jeffreyg/Projects/digital-home/.worktrees/room-scanner`.
- Integration worktree observed at `/Users/jeffreyg/Projects/digital-home-integration`. Check its current state before relying on it; another agent owns integration.

Read in this order:

1. This document and `agent_docs/PLANNER_NOTES.md`: current decisions and build log.
2. `agent_docs/CONTRACTS.md`, particularly the aesthetic experiment amendment, then `packages/contracts/src/aestheticPlanner.ts` for actual runtime schemas. Extend shared definitions additively.
3. `apps/planner-server/README.md`: commands, evidence and limitations.
4. Planner code listed below, then the shared editor/cloud code before introducing any hooks.
5. Relevant parts of `PRD.md`, `FUNCTIONAL_SPEC.md`, `FEATURE_DESIGN.md`, and `SYSTEM_ARCHITECTURE.md` in `agent_docs/`. Approved decisions below override older conflicting requirements.

The root `AGENTS.md` merge-in-progress banner is obsolete for this feature. Do not restart that merge workflow. Do not edit, move, delete or commit the older `agent_docs/AESTHETIC_PLANNER_NOTES.md` if present. The old Windows whole-house/storage handoff describes a different state: do not assume `apps/api`, `packages/planner-storage`, a test-house fixture or their commits exist here.

## 3. Approved decisions: do not reopen without a concrete reason

- **Single room** for the hackathon; houses are deferred.
- Only furniture/decor changes. Room function and essential capacity remain. Shell geometry and wall/floor finishes stay fixed.
- **Lock is the permission boundary:** preserve every property of a locked piece.
- **Keep** preserves physical identity, model, dimensions and appearance, but **may move**. This supersedes the older “Keep never moves” handoff.
- Replace/Remove are instructions, not merely permission to make arbitrary changes. Lock wins conflicts; explain conflicts visibly. Failed mandatory replacements/placements must block completion with a reason.
- Images, questionnaire, or both are supported eventually. Images describe style, never room geometry. Explicit answers override image guesses in code. Style values carry provenance and are editable before planning.
- Missing furniture may appear as **labelled placeholders**, with appearance explicitly unverified. Users may eventually accept these; a placeholder is not evidence that a mandatory instruction was fulfilled.
- Planning starts from a frozen saved snapshot and works separately. It never writes into the sandbox draft or original scene.
- Original and proposed design coexist like branches. Accept creates and opens a **new, separately named version**. Subsequent edits to the original stay there; they do not invalidate saving the separate design. Both designs must be easy to choose by name.
- **No merging changes between designs and no unfinished-run restoration** for the hackathon. Do not reintroduce the old “any original edit makes Accept stale” rule.
- Slow furniture can eventually swap into a proposal. Accepted versions stay frozen; later adoption must be explicit.
- One proposal, at most two visual repairs, bounded time. No partial proposal editing yet: change the brief and run again.
- Clearly label demo fallback, and provide Retry on AI failures.
- Budget and the timeline from current to target design are in hackathon scope, **after the aesthetic planner**. Preserve prices and replacement lineage now; do not start budget UI in this workstream.
- DeepSeek Pro handles text planning; Flash handles vision. Provider/model settings stay server-side. The existing render module owns retrieval/edit/build; do not duplicate it inside the planner.

## 4. Code map and current behavior

| Location                                       | Responsibility                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/aestheticPlanner.ts`   | Strict shared Zod brief, semantic plan, review, view and price schemas.                                                           |
| `packages/aesthetic-planner/src/ports.ts`      | Planner/model/render ports, candidate/items, typed model issues and readiness.                                                    |
| `packages/aesthetic-planner/src/prompts.ts`    | Composition and visual-review instructions.                                                                                       |
| `packages/aesthetic-planner/src/loop.ts`       | `PlannerSession`, plan/review/repair orchestration, best-candidate retention, max two repairs, default 240-second session budget. |
| `packages/aesthetic-planner/src/candidate.ts`  | Lock/instruction enforcement, render requests, candidate assembly, safe operation replay, prices and warnings.                    |
| `packages/aesthetic-planner/src/placement.ts`  | Dependency ordering and deterministic relation-ranked candidate placement.                                                        |
| `packages/aesthetic-planner/src/modelFit.ts`   | Uniform fitting to maximum dimensions; rejects a scale below 0.5.                                                                 |
| `apps/planner-server/src/model.ts`             | Server-only DeepSeek-compatible text/vision calls, structured-output validation/retry.                                            |
| `apps/planner-server/src/renderQueue.ts`       | Existing owner-scoped scanner `asset_requests` adapter, deduplication and bounded polling.                                        |
| `apps/planner-server/src/catalog.ts`           | Verified shared catalog metadata merged with bundled assets; 30-second cache and offline fallback.                                |
| `apps/planner-server/src/readiness.ts`         | Read-only connection preflight before paid AI calls. This checks queue availability, not worker heartbeat.                        |
| `apps/planner-server/src/server.ts`            | Local HTTP endpoints and in-memory sessions; no durable proposal save.                                                            |
| `apps/planner-server/src/demo.ts`              | Explicitly scripted demo using real catalog alternatives and one scripted rug repair.                                             |
| `apps/web/src/planner/PlannerLab.tsx`          | Room/brief input, existing account control, readiness, progress, proposal list and before/after.                                  |
| `apps/web/src/planner/PlannerViewport.tsx`     | Reuses shared Model/Room/Lighting; separate scene, actual three-view captures and per-object load tracking.                       |
| `apps/web/src/planner/modelStatus.ts`          | Distinguishes ready/loading/placeholder/download failure.                                                                         |
| `apps/web/src/state/editor.ts`                 | Shared sandbox accepted scene/draft semantics. Read before adding furniture review.                                               |
| `apps/web/src/state/cloud.ts`, `repository.ts` | Current Supabase room/asset integration and save path. Read before implementing versions.                                         |
| `tests/planner-loop.spec.ts`                   | Actual-model browser demo, missing-queue gating and recoverable service-error checks.                                             |

Pipeline: approved brief → semantic composition → render requests → deterministic placement → `resolveDraft`/`validateObject` → actual browser captures → Flash review → bounded repairs → best valid candidate. Models never invent coordinates or asset IDs. Placement intentions include original/center/wall/near/on, with object-key relationships; dependencies and cycles are checked.

Physical replacement uses a new object ID and `replacePhysicalItem`/`replacesObjectId`, not an owned-item model swap. Unknown price is null, never zero; existing pieces carry zero. A usable `best_effort` model is retained and labelled `closest_available`. Invalid/unverified/unsupported/oversize models remain labelled placeholders with specific reasons.

The queue adapter waits through intermediate results, defaults to a 45-second wait (bounded to 90), and distinguishes queue missing, pending/timeout/failure, invalid output and no match. Current requests use `allowGeneration:false`: edit/build and asynchronous swap-ins are not implemented here.

Current endpoints: GET `/planner-api/health`, GET `/planner-api/readiness`, POST `/planner-api/sessions`, POST `/planner-api/sessions/:id/observe`. Sessions are process-local, expire after 30 minutes, and are capped at 20. Do not treat this local development service as a production authorization/storage layer. Before deployment or durable writes, bind proposal/session operations to the authenticated owner and load/authorize canonical room data on the server.

## 5. Integration blocker and honest evidence

Read-only checks on 2026-10-18 found **233 shared catalog rows, 232 usable verified assets**. Sample public model URLs returned real GLBs. But `asset_requests` returned **HTTP 404, `PGRST205`**, including a read-only service-role diagnostic. This is a missing table/schema exposure problem, not a model-loading bug or proof that the scanner-to-sandbox flow is broken.

The migration already exists in the scanner/integration worktrees:

`supabase/migrations/20261018140000_asset_requests.sql`

Coordinate deployment through the existing integration workflow. Do not silently apply migrations, copy render code, introduce competing tables, or use a service key to bypass owner access. No database schema or rows were written during the model-sourcing follow-up. No temporary test account was created; an optional earlier question about creating one was not answered. Prefer the user's existing browser sign-in for verification.

What has been demonstrated:

- Catalog demo: real sofa/chair alternatives, 12 real models loaded, one unchanged scanned proxy, zero model-download failures; original saved scene unchanged.
- Real provider smoke: Pro valid plan in 7.546 seconds; Flash palette/material interpretation in 1.753 seconds.
- Visual experiment: a recorded real Pro plan plus live Flash on fresh captures completed three reviews/two repairs in 23.913 seconds excluding planning. Scores **8/15 → 7/15 → 7/15**, so the initial candidate was retained. **Quality improvement was not demonstrated.**
- Latest code checks: typecheck, lint, 271 unit tests, web build, three GPU Chrome planner browser tests passed. Full 28-test sandbox browser suite passed at the earlier core-loop milestone, not rerun for every follow-up.
- Built browser output checked against private environment key values; none were present.

Not demonstrated: authenticated live queue end to end, strong Japandi design quality, general circulation/access quality, real edit/build jobs, consumer inputs, or version acceptance.

## 6. Run and verify locally

This machine is macOS. `corepack` is unavailable; pnpm exists at `/tmp/house-tools/node_modules/.bin/pnpm`. Add it to PATH. From the feature worktree:

```sh
export PATH=/tmp/house-tools/node_modules/.bin:$PATH
PLANNER_ENV_FILE=/Users/jeffreyg/Projects/digital-home/.worktrees/room-scanner/.env pnpm --filter @house/planner-server dev
# Separate terminal:
pnpm --filter @house/web dev --port 5191 --strictPort
```

API binds to `127.0.0.1:8791`; Vite proxies `/planner-api`. Both servers may already be running; inspect before starting duplicates. API is not a watch process; restart it after server edits. Leave other agents' servers alone.

Use the scanner `.env` **by file path**; never print, copy, commit or modify it. Relevant names/defaults are in `apps/planner-server/.env.example`: `DEEPSEEK_API_KEY`, `PLANNER_BASE_URL`, `PLANNER_TEXT_MODEL`, `PLANNER_VISION_MODEL`, `PLANNER_PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. `main.ts` also falls back to `DEEPSEEK_MODEL`. Do not prefix private keys with `VITE_`. Provider formats/models were checked against official DeepSeek documentation in the first milestone; recheck if changing providers or capabilities.

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @house/web build
HOUSE_E2E_PORT=5191 HOUSE_BROWSER_GPU=1 \
HOUSE_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
pnpm exec playwright test tests/planner-loop.spec.ts
```

See server README for opt-in `verify-models.ts` and `live-evaluation.ts`. These make paid provider calls. The latter explicitly substitutes fixture model sourcing and intercepts readiness; **it cannot prove live queue integration**. Outputs/screenshots are ignored under `test-results/`. Never commit provider responses containing user data or secrets.

## 7. Ordered next implementation steps

Each numbered step is a separately reviewable milestone. Resolve integration dependencies while continuing independent work, but do not claim a blocked live test succeeded.

### A. Prove the real pipeline and assess design quality

1. Coordinate the existing queue migration and confirm a running scanner/render worker. Verify request/result contract against its current implementation rather than assuming branch tips match.
2. Sign in on the planner origin. Check readiness, submit one owner-scoped request, and verify worker completion and a model that actually loads. Verify another owner cannot read the request or its private room data. No service-role workaround.
3. Run cozy Japanese–Scandinavian on a real scanned room. Inspect three actual views, model requests, placement, required instructions and warnings. Capture a before/after screenshot and measure planning, sourcing, placement, capture, review and total times.
4. Diagnose weak design with evidence: unclear brief, conservative composition, poor style matches, incomplete model availability, relation scoring or visual critique. Improve the responsible stage. Do not optimize subjective scores at the expense of geometry or instructions.

Done when: an authenticated live proposal uses real returned models, keeps locks and instructions, validates, leaves the original unchanged, and has an honest quality/time report. If blocked, record the exact dependency and continue only work that does not depend on it.

### B. Furniture review and consumer entry

Add new planner components matching the sandbox UI. Review current saved furniture with Lock and Keep/Replace/Remove controls, conflict explanation and selection linked to 3D. Reuse current editor operations and save semantics; do not mutate objects directly. Clearly resolve pending sandbox suggestions before taking the planning snapshot, so the accepted baseline is unambiguous. Keep may move in a proposal. No need for house grouping.

Done when: controls work both ways with selection, lock wins visibly, choices are saved deliberately, and taking a snapshot cannot mix unaccepted sandbox edits into the proposal. Add focused store/UI and browser coverage.

### C. Private inspiration and questionnaire

Introduce a `PlannerStorage` port for inputs/images/briefs/proposals/named versions and change/price records, adapting to the existing database. Inspect current storage/schema with the integration owner; do not recreate scan/room tables. If a local adapter helps, test its common behavior through a reusable conformance suite. Durable unfinished-run restoration is excluded.

Provide inspiration upload by file picker, drag/drop and paste; thumbnails/remove/progress/plain errors. Validate JPEG/PNG magic bytes and configured limits (original plan: 10 MB each, ten images). Owner-only access; recheck ownership for selected image IDs. No scraping or external image hotlinks.

Provide a short single-room questionnaire: purpose, household needs, style cards, palette, materials, mood/lighting, love/avoid, must-keep links and free text. Use local/license-clean visuals. Save answers as the user goes. Define and Zod-validate the shape, preserving the distinction between unanswered and explicit choices.

Done when: images only, questions only and both persist privately; spoofed types, oversized uploads, excessive counts and another owner's reads fail safely. No private key enters browser code.

### D. Style interpretation and editable summary

Add a distinct Style Interpreter before semantic composition. Inputs: answers/free text, authorized images, and room purpose. Extract palette, materials, forms, mood/lighting, focal pieces and avoid cues; never derive layout or shell geometry from inspiration. Record each value's origin (image ID, answer/free text or default).

Validate output, retry invalid output once, then return a recoverable error. Enforce explicit-answer precedence **in code**, not only in a prompt. Retain original AI interpretation and separately track user edits. Show plain words, palette swatches and provenance tags; all values editable. “Looks right — design it” passes the approved brief into the existing loop.

Done when: all three input modes work, empty input is rejected, typed answers beat contradictory images in tests, missing keys/provider errors are clear, and the user sees/edits the summary before a proposal runs.

### E. Strengthen composition, placement and progress

Use actual scans and at least a few different style briefs to improve function/capacity preservation, coherent silhouettes/materials, focal relationships and usable access. Current placement is a 30 cm grid plus greedy relation ranking and shared resolver; it does **not** solve whole-room circulation or jointly optimize all objects. Implement improvements inside the isolated pure package where possible.

Always validate the final scene and safe operation replay. Optional decor may be dropped with a reason; failed mandatory instructions must block completion. Preserve best-candidate regression protection and bounded retries. Show honest stage progress and failure/retry state; do not call a placeholder or missing queue a successful live render.

Done when: representative valid layouts improve or have an explicit limitation, required pieces remain usable, and regression tests cover the concrete failures found. Measure time rather than promising the old whole-house targets.

### F. Full proposal preview

Promote the experiment into the normal flow with a separate read-only proposal scene. Reuse shared viewer components; do not write proposals into `editor.draft`. Before/after keeps the camera. Add green added, red removed ghosts, amber replacements and blue moves with old-position indication. Single-room change list shows action/reason, Found/Edited/Built/Placeholder, closest-match caveats and estimated/unknown prices.

Preserve loading/failure diagnostics and real captured views. Disable editing of the proposal while allowing the original to exist independently. If a shared sandbox hook is necessary, tell the user exactly what and why before changing it.

Done when: highlights match actual operations, before/after changes no saved scene, model failures remain visible, and normal sandbox interactions still work outside preview.

### G. Named-version Accept/Reject

First agree the smallest persistence adapter with existing cloud/version architecture. The server must authorize the owner, reload the frozen snapshot and approved candidate, reapply operations, validate through shared rules and atomically/idempotently create a separately named design. Keep the immutable shell reference. Open the new design after success and provide a name-based picker/rename so the original remains easy to find.

Original edits after snapshot stay on the original. They are not a reason to reject saving the independent design. Protect the actual destination write/idempotency operation from conflicting retries; do not import the superseded original-head stale rule. Reject changes proposal status only. User-facing buttons are **Accept design** / **Reject design**, distinct from sandbox draft Accept.

Done when: Reject leaves original byte-identical; Accept creates exactly one new named design even on retry; both remain selectable; original edits survive; shell/locks validate on the server; unauthorized writes fail. No merging or unfinished-run restoration.

### H. Slow edit/build models and proposal swap-ins

Coordinate with the render module rather than porting its implementation. Retrieval first, then edit, then create last. Current request has one `allowGeneration`; separate edit/create permissions only through a coordinated additive contract change. Proposed create cap is two per proposal, with per-item/overall budgets; confirm the render module's actual supported limits before wiring them.

Preview must not wait for slow model creation. Show a correctly sized labelled placeholder, then update the proposal when a verified model arrives. Validate size/placement again and report failure without hiding the reason. Accepted designs are frozen; no silent late swaps. Use the render module's existing fakes for tests; do not assume Blender is installed or its worker is available.

Done when: ordering and cap are enforced, preview opens while a job runs, valid models swap in safely, failures stay explained and accepted versions never mutate.

### I. Complete feature validation and handoff to budgeting

Exercise full input → summary edit → live proposal → review → Accept for images only, questions only and both. Reject a separate run. Also test locks, Keep moves without identity/appearance changes, mandatory Replace/Remove, unavailable models, provider/worker failure, privacy, repeated acceptance and original edits during planning.

Record stage/total times and compare actual visual quality; distinguish scripted demo from live evidence. Run required checks plus full browser suite before integration. Update build log and storage/integration notes. Only then start the separately planned budget/timeline work using preserved integer-cent costs, null unknowns and replacement lineage.

## 8. Nonnegotiable tests by completion

- Locked objects never change; Keep preserves identity/model/dimensions/appearance while allowing validated movement.
- Shell and finishes never change; every placed object passes shared rules.
- Required Replace/Remove instructions succeed or visibly block completion.
- Unknown prices are null/unknown, never zero; replacement IDs/lineage are correct.
- Explicit answers override image guesses; uploaded images and proposals are owner-private.
- Reject changes no saved scene; Accept creates one separate named design and is idempotent.
- Original edits remain available and do not get overwritten by proposal acceptance.
- Captures correspond to the exact reviewed candidate, distinguish missing/failed models, and repairs remain bounded.
- Slow model failures and closest matches are explained; accepted versions stay frozen.
- Storage adapters pass the same behavioral suite; normal scan → database → sandbox flow still works.

## 9. Working routine

Work one milestone at a time. For each: run typecheck, lint, unit tests and build; relevant browser checks; fix failures; update `PLANNER_NOTES.md` §11; commit with a clear message and `Co-Authored-By: OpenAI Codex <noreply@openai.com>`; give exact clicks/expected behavior; **stop for user review**. Explain limitations plainly. Do not claim the full feature works because the demo renders.

Keep planner code in its new package/server/components. Explain unavoidable sandbox changes before making them. Do not reset/force-push, modify other branches or push without request. Do not merge other feature branches into this worktree; coordinate integration and adapt small contract changes deliberately. Stage with:

```sh
git add -A -- . ':!agent_docs/AESTHETIC_PLANNER_NOTES.md'
```

The last user-facing step was committed and waiting for review. This handoff is documentation for another agent; it is not authorization to apply database migrations or publish/deploy changes.
