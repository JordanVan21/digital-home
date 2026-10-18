# Aesthetic planner: first visual-feedback experiment

This milestone tests the difficult design loop before the full intake and version UI. Open `http://127.0.0.1:5191/?planner-lab`. Normal sandbox use remains at `/`.

From the worktree root, launch the server and web app in separate terminals:

```sh
PLANNER_ENV_FILE=/absolute/path/to/room-scanner/.env pnpm --filter @house/planner-server dev
pnpm --filter @house/web dev --port 5191 --strictPort
```

On this machine, pnpm is available at `/tmp/house-tools/node_modules/.bin/pnpm`; add that directory to PATH. The server binds only to 127.0.0.1:8791. `.env.example` lists settings; model keys never enter the web bundle. The existing scanner environment is read without modifying it.

## Try it

1. Open the lab and choose a base room.
2. Choose **Catalog demo (real furniture)** and **Run design experiment**. It replaces two eligible pieces with real catalog alternatives, requests a rug in one scripted repair and captures three actual views per candidate. Design and review are explicitly labelled scripted; this demo makes no AI or worker calls.
3. Toggle **Show before** / **Show proposed design**, inspect the change list and expand **Actual views sent for review**. No saved room changes.
4. To try real design reasoning, sign in using the account control in the lab and choose **Live AI + connected render worker**. Check the Furniture connection message first. The scanner worker and `asset_requests` migration must be available; missing infrastructure blocks the run before paid AI calls. Queue/worker delays leave labelled placeholders with specific reasons.

The editable JSON is a temporary approved-brief interface for this experiment. Consumer questionnaire and style-summary screens come later.

## How it works

Pro proposes a composition using real object IDs and relations (center, wall, beside, in front of, facing). The renderer adapter submits model requests to the scanner worker's existing owner-scoped queue. The server loads verified shared catalog metadata, with the bundled catalog as an offline fallback. Queue requests are deduplicated, wait up to 45 seconds by default, and retain usable closest matches with an explicit compromise label. Placement uses actual returned dimensions with uniform fitting, ranks deterministic candidates (including a nearest-fit search when the original spot fails), and runs the sandbox's shared rules. It validates all final objects and replays safe operations; physical replacements use `replacePhysicalItem` with new identity. Unknown cost is null, never zero.

The browser renders a separate scene with the sandbox's Model/Room/Lighting components. It captures top and opposing angled views with fixed cameras/lighting, adds numbered annotations and reports unavailable models. Flash reviews those actual views against the brief; a complete revised plan goes through the same checks. At most two repairs and a 240-second server session budget. The best visually scored valid candidate survives a failed/worse repair. Scores are subjective feedback, not proof of quality.

## Boundaries and known limits

- This is a local experiment, not the complete planner. No Accept design, persisted versions, intake uploads, provenance editing, highlight overlay or unfinished-run restore yet.
- Model sourcing is retrieval-only for this milestone (`allowGeneration:false`). No edit/build jobs, late swap-ins or new GLB downloads.
- Existing mounted/attached furniture stays in place. New pieces are floor furniture or tabletop objects placed through the shared support rules. Unsupported optional additions are reported as left out; mandatory replacements still block completion if they cannot fit. Unsupported support changes fail with an explanation.
- Placement uses a 30 cm grid and greedy relationship scoring, then the shared resolver. It does not yet solve whole-room circulation/access paths or optimize the entire arrangement jointly.
- Lighting mood informs requests; the experiment does not alter the sandbox's lighting preset or immutable finishes.
- Three screenshot checks demonstrate transport and review mechanics; they do not prove a proposal is aesthetically strong. Actual user review is required.
- The signed-in live worker path requires a user session. The manual provider evaluations use fixture model sourcing and make no database writes.
- Branches/version acceptance must be implemented separately before any proposal can be saved. Original edits must remain independently available.

## Verification

Root checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @house/web build`.

Browser smoke: `HOUSE_E2E_PORT=5191 HOUSE_BROWSER_GPU=1 HOUSE_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm exec playwright test tests/planner-loop.spec.ts` (start both services first). Verifies real replacement models load, two distinct candidates, three real views each, before/after and unchanged saved scene. Also verifies missing-queue gating and recoverable service errors.

Paid provider smoke, from the worktree root after the browser smoke:

```sh
PLANNER_ENV_FILE=/absolute/path/to/room-scanner/.env node --import ./apps/planner-server/node_modules/tsx/dist/loader.mjs apps/planner-server/src/verify-models.ts
```

Measured provider smoke: Pro returned a valid 12-item plan in 7.546 seconds; Flash described visible warm beige/off-white/wood colors and likely fabric, wood, glass and metal in 1.753 seconds, explicitly noting placeholder/fine-texture uncertainty. The initial Pro plan was overly conservative (all Keep); the planning prompt was corrected to distinguish preserving room function from preserving every item.

Opt-in full real Pro/Flash loop with **fixture-only model sourcing**, requiring the UI on port 5191:

```sh
PLANNER_ENV_FILE=/absolute/path/to/room-scanner/.env node --import ./apps/planner-server/node_modules/tsx/dist/loader.mjs apps/planner-server/src/live-evaluation.ts
```

This writes raw fixture-model responses, review history and a screenshot under ignored `test-results/`. It never uses or prints a service-role key and does not exercise the authenticated worker queue.

Completed real visual-feedback evaluation: a recorded real Pro plan was replayed, placed, and reviewed by live Flash against fresh sandbox captures. Three reviews and two repair rounds completed in 23.913 seconds (excluding the recorded planning call). Scores were 8/15, 7/15 and 7/15; the first candidate was retained. This proves the loop and regression safeguard, not improved design quality. Fresh live attempts also exposed invalid references, unsuitable placements and an interrupted provider connection; those findings drove the schema, dependency ordering, bounded retries and optional-decor reporting. Authenticated worker requests remain unverified with a real user session.

Final local checks: typecheck, lint, production build and 255 unit tests. All 28 GPU Chrome browser tests passed in 2.2 minutes, including the planner loop and unchanged saved-scene check. The built browser bundle was checked against the scanner environment and contains none of its private keys.

## Model-sourcing follow-up (2026-10-18)

Read-only checks found 233 shared catalog rows (232 usable verified assets), but `asset_requests` returned HTTP 404 / `PGRST205`. The migration already exists at `supabase/migrations/20261018140000_asset_requests.sql` in the integration/scanner worktrees. Deploy it through the integration workflow, then verify owner-authenticated requests and a running worker. No database migrations or rows were written here; live worker integration remains unverified.

Current checks: typecheck, lint, production build, 271 unit tests and three planner browser tests passed. The browser demo showed 12 real models ready, one unchanged scanned placeholder and zero load failures. The earlier 28-test full sandbox run above belongs to the first milestone. No new paid AI evaluation was run for this follow-up; aesthetic quality still needs live evaluation.
