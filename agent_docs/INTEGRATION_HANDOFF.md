# Integration handoff: merge `feature/room-scanner` + `feature/3d-sandbox-codex-base`

**Written:** 2026-10-18 (hackathon day). **For:** the session that performs the merge.
**Status at writing:** both branches pushed to `origin` (JordanVan21/digital-home), clean, nothing merged.

| Branch | Tip | Worktree |
| --- | --- | --- |
| `feature/room-scanner` | `cbb6755` (+ this doc) | `/Users/jeffreyg/Projects/digital-home/.worktrees/room-scanner` |
| `feature/3d-sandbox-codex-base` | `da1ddb8` | `/Users/jeffreyg/Projects/digital-home-codex-base` |
| `main` | `6fc23a2` (the merge base of both) | `/Users/jeffreyg/Projects/digital-home` |

**Decision (2026-10-18, agreed with the team): `feature/3d-sandbox-codex-base` is
the sandbox going forward.** Every other branch on GitHub is older or superseded:
`main`, `3d-sandbox`, `3d-sandbox-codex` and `aesthetic-planner` are fully contained
in codex-base/room-scanner; `asset-builder` and `render-agent-demo` were copied
unchanged into room-scanner (plus small improvements); `3d-sandblox-jordan` and
`3d-sandbox-merge` were superseded by codex-base. `3d-sandbox-jordan-merge`
(Jordan, 16 commits) is a parallel jordan+codex sandbox merge and is **reference
only** — do not merge it. Individual fixes there (walk mode, held-piece drag
feedback, wall-snap narrowing, pillows staying on sofa cushions, 60 FPS drag pass)
may be ported into codex-base later if wanted.

A teammate is starting the aesthetic planner on a new branch off codex-base
(suggested name `feature/aesthetic-planner-v2`). Budgeting, a room-over-time timeline
and web search for similar product listings are deliberately deferred until the
rendering pipeline is done.

## 1. Why merge

The app works end to end today only because the two branches run side by side as
separate programs that share **data**, not code:

```
iPhone app (room-scanner: apps/ios)  --upload-->  Supabase (hosted)
worker (room-scanner: apps/worker)   <--reads/writes-->  Supabase
   converter (packages/scan-import) + render agent (packages/render-agent,
   packages/asset-service) + headless Blender + DeepSeek
sandbox (codex-base: apps/web on :5185)  <--reads rooms/assets, Realtime-->  Supabase
```

The hand-off is the JSON in Supabase (`rooms.shell` = RoomShell, `rooms.scene` =
SceneSpec, `assets.spec` = AssetSpec). It was verified that worker output parses with
codex-base's own `RoomShellSchema`/`SceneSpecSchema`, and agent-built assets parse
with its `AssetSpecSchema`. Merging gives one codebase to run/test/demo and one
definition of those shapes so they cannot drift.

## 2. What each side contributes

**Keep from codex-base (it wins for everything sandbox):** `apps/web` (the real
sandbox: editor, Supabase sign-in, scanned-room loading/settling, live updates),
`packages/scene-engine`, `packages/contracts` (its `schemas.ts` + `catalog.json`
model), `scripts/` (Poly Haven / FurniMesh importers, collider baking, thumbnails),
`tests/` (Playwright), `docs/`, vitest/eslint/playwright config.

**Bring from room-scanner (it wins for everything pipeline):**
- `apps/ios` — SwiftUI + RoomPlan app; `HouseCloud` target (Supabase sign-in/upload).
- `apps/worker` — scan queue + planner request queue, runs converter + render agent.
- `packages/scan-import` — RawRoomScan v1 → RoomShell + SceneSpec converter.
- `packages/render-agent`, `packages/asset-service` — copied unchanged from
  `origin/feature/render-agent-demo` (which contains `feature/asset-builder`), plus
  local edits: storage/sideboard/wardrobe/tv-stand/vanity/bath/kitchen category
  affinities (`asset-service/src/categories.ts`) and a "no flush parts" builder rule
  (`render-agent/src/agent.ts`).
- `supabase/` — `config.toml`, migrations (see §6).
- `scripts/seed-assets.mjs` — seeds the assets table/bucket from a catalog ref.
- `agent_docs/` additions: `SUPABASE_PLAN.md`, `SCANNER_STATUS.md`,
  `PHONE_SCANNER_BACKLOG.md`, `ASSET_REQUESTS.md`, this file.

**Drop from room-scanner:** its `apps/web` (an old copy of the original
`feature/3d-sandbox` at `9c07024` plus a test "import scan JSON" page,
`apps/web/src/lib/scanImport.ts`) and its older `packages/scene-engine`.

## 3. Expected conflicts (from `git merge-tree`, 18 files, all add/add)

Both branches independently created these files from `main`.

| File(s) | Resolution |
| --- | --- |
| `apps/web/**` (index.html, package.json, App.tsx, main.tsx, SceneCanvas.tsx, wallGeometry.ts, vite.config.ts) | take codex-base; delete room-scanner-only web files afterwards (e.g. `apps/web/src/lib/scanImport.ts`, `fixtures/`, `ui/`, `state/sceneStore.ts`) if nothing imports them |
| `packages/scene-engine/**` (package.json, collision.ts, geometry.ts, index.ts) | take codex-base; delete room-scanner-only engine files (`reduce.ts`, `invert.ts`, `validate.ts` …) if unused |
| `packages/contracts/package.json`, `src/index.ts` | **the real work — see §4** |
| `package.json` | codex-base base (name `house-sandbox`, pnpm 10.32.1, vitest/playwright scripts) + add scripts for worker/scan-import/render-agent tests |
| `pnpm-workspace.yaml` | union: `apps/*`, `packages/*` (keep codex settings) |
| `pnpm-lock.yaml` | do not hand-merge: take codex-base, then `pnpm install` to regenerate |
| `tsconfig.base.json`, `.gitignore` | union of both (room-scanner ignores `.env*` except `.env.example`, `*.xcodeproj`, `.build/`, `node_modules/`) |

Recommended mechanics: create `feature/integration` from
`origin/feature/3d-sandbox-codex-base`, then `git merge origin/feature/room-scanner`
(a real merge commit, no rebase/squash), resolve, test, then PR into `main`.
Never rewrite either source branch. Ask the user before pushing or merging to main.

## 4. Contracts: the one real code change

Pipeline code imports these names from `@house/contracts` and uses several as
**runtime zod values** (`.parse`, `.safeParse`): `AssetRequest` (16 uses),
`AssetSpec` (15), `SceneSpec`, `SceneObject`, `RoomShell`, `Wall`, `Opening`, `UUID`,
`SceneOp`, `AssetResolution`, `AssetCandidate`, `Vec3`.

Codex-base exports `XxxSchema` values plus `Xxx` *types* (no `AssetRequest`,
`AssetCandidate`, `AssetResolution`, `UUID`/`Vec3` values).

Suggested approach (small, keeps codex as the authority):
1. Add room-scanner's `packages/contracts/src/assetRequest.ts` to codex contracts,
   rewritten to import `UUIDSchema`/`Vec3Schema`.
2. Add a `compat.ts` exporting value aliases with the pipeline's names, e.g.
   `export const AssetSpec = AssetSpecSchema;` (a const and a type of the same
   name may coexist in TS), likewise `SceneSpec`, `SceneObject`, `RoomShell`, `UUID`,
   `Vec3`; export it from `index.ts`.
3. Add `derivedFromAssetId: UUIDSchema.optional()` to codex `AssetSpecSchema`
   (render agent lineage for edited models; codex currently strips it).
4. Typecheck `packages/scan-import`, `packages/render-agent`,
   `packages/asset-service`, `apps/worker` and fix the remaining type drift.
5. `packages/scan-import/src/normalize.test.ts` (last test) uses the old engine's
   `validateOp(scene, shell, op)` returning `{valid, errors}`; codex's `validateOp`
   has a different signature — port the test to codex's `validateObject`/`validateOp`.

## 5. Verify after merging (all of these passed on their own branch before)

| Area | Command (from repo root unless noted) | Before merge |
| --- | --- | --- |
| Sandbox unit tests | `pnpm test` (vitest) | 239/239 |
| Sandbox typecheck | `pnpm typecheck` | clean except pre-existing `tests/navigation-modes.spec.ts` (3 errors from commit `05e4bdb`) |
| Sandbox build | `pnpm --filter @house/web build` | ok |
| Converter | `cd packages/scan-import && npx tsx --test src/*.test.ts` | 9/9 |
| Asset service | `cd packages/asset-service && npx tsx --test src/*.test.ts` | 33/33 |
| Render agent | `cd packages/render-agent && npx tsx --test src/render.test.ts` | 27/27 |
| Worker | `cd apps/worker && npx tsc --noEmit` | ok |
| iPhone | `cd apps/ios && swift test` (16 tests) and the unsigned device build below | ok |

```
cd apps/ios && xcodebuild -project HouseScanner.xcodeproj -scheme HouseScanner \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/house-scanner-build \
  CODE_SIGNING_ALLOWED=NO build
```

Then a live check: worker `--once --reprocess`, open the sandbox, sign in, open
each scanned room (see §8 for the headless harness approach).

## 6. Supabase (hosted demo project `synyznfvklhsosnaivno`)

- Applied: `20261018120000_core.sql` — tables `houses`, `scans` (status =
  uploaded → processing → done/failed; doubles as the job queue), `rooms` (`shell`,
  `original_scene`, `scene`, `revision`, `placement`, `render_report`), `designs`,
  `assets` (AssetSpec in `spec` + search columns); owner-only RLS; buckets
  `scan-files` (private, per-user folders) and `glbs` (public read); Realtime on
  scans/rooms/designs.
- **Not applied, intentionally parked:** `20261018140000_asset_requests.sql` (commit
  `ec3bb58`, planner → render agent request queue, doc `ASSET_REQUESTS.md`). The user
  expects the planner branch to design its own approach. The worker turns that queue
  off automatically when the table is missing. Do not push it without asking.
- CLI is linked in the room-scanner worktree (`supabase link` done; `supabase/.temp`
  is gitignored). Any `supabase db push` to the hosted project needs explicit user OK.
- Email confirmation is off on the hosted project (dashboard toggle).
- Library: 170 assets in Supabase = 54 codex catalog (seeded) + ~17 agent-built
  (Blender/edited) + 99 FurniMesh batch (Supabase-only, under `glbs/furnimesh/`).
  One agent-edited "Walnut table" (`0ac86106-…`) is retired (`licenseStatus:
  restricted`). **Pending user action:** seed the 63 new Poly Haven models:
  `node --env-file=.env scripts/seed-assets.mjs feature/3d-sandbox-codex-base`
  (run in the user's Terminal; Node uploads fail inside the agent sandbox).

## 7. Running it (demo Mac)

- Secrets: repo-root `.env` in the room-scanner worktree (gitignored):
  `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AGENT_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `OPENAI_*`,
  `ALLOW_GENERATION=1`, `BLENDER_MCP_PORT=9876`, `BLENDER_INSTANCES=3`,
  `SCAN_TIME_LIMIT_S=900`. After merging, the worker reads `../../.env` relative to
  `apps/worker` — copy or recreate `.env` in the integration worktree root. Never
  commit it. Only the public anon key is committed (iOS `CloudConfig.swift`, web
  `apps/web/src/state/cloudConfig.ts`). The service-role key was briefly printed in
  a local tool log; the user may rotate it after the hackathon.
- pnpm: `export PATH=/tmp/house-tools/node_modules/.bin:$PATH` (pnpm 10.32.1; the
  room-scanner root declares 12.14.0 — prefer codex's 10.32.1 in the merge; set
  `npm_config_manage_package_manager_versions=false` if pnpm tries to switch).
- Worker: `cd apps/worker && pnpm start` (forever) / `pnpm once` / `-- --reprocess`.
  It starts `BLENDER_INSTANCES` headless Blenders (Blender 5.2.2 installed via
  Homebrew cask) and kills them on exit. Only one worker at a time.
- Sandbox: dev server `pnpm exec vite --host 127.0.0.1 --port 5185 --strictPort`
  from `apps/web` (port notes in codex `docs/SESSION_NOTES.md`).
- iPhone: open the **existing generated** `apps/ios/HouseScanner.xcodeproj` and
  Command-R. **Do not run `xcodegen generate`** — it wipes the user's signing team
  (`83TZUU37GR`). New Swift code goes in the `RoomScanKit`/`HouseCloud` package
  targets so no regeneration is needed; any Info.plist key must be added to both
  `App/Info.plist` and `project.yml`.

## 8. Behaviour worth preserving (and why)

- **Worker two-pass:** pass 1 matches every object against the library (seconds)
  and writes the room so it opens immediately; pass 2 runs agent/Blender only for
  non-confident objects (3 Blenders in parallel, `SCAN_TIME_LIMIT_S` cap) and swaps
  each better model in with a revision check so sandbox edits are not overwritten.
  `render_report` records method a/b/c/placeholder, notes, seconds, tokens.
- **Converter options the worker uses:** `origin: "center"`, `wallFaces: "inner"`
  (scanned plane = room face; walls drawn outward, like codex fixtures), and
  `alignToWalls: true` (longest wall along X). Floor-outline fallback transforms
  surface-local corners (real RoomPlan data).
- **Sandbox settle on load (`apps/web/src/state/cloud.ts`):** raised pieces (≥0.35 m)
  become normal lifted pieces (`placement: {support:"floor", float:true}`, *not*
  wall mounts — wall mounts get wall-art dragging); sunk-in pieces rest on the
  surface below; invalid pieces go through codex `resolveDraft`, then shrink ≤25%
  with a nudge, and as a last resort are left out with a notice. Reason: **one
  invalid piece blocks every Accept in the room.**
- Agent-built (`source: "generated"`) models get a per-part depth bias in
  `Model.tsx` to stop flush faces z-fighting (the "checkerboard oven").
- New rooms appear via Realtime INSERT; open rooms reload when the worker swaps a
  model (only while the user is idle).
- Browser testing without the user's password: Playwright (`@playwright/test` in
  codex-base, system Chrome, `--use-angle=metal`) with an injected
  `sb-synyznfvklhsosnaivno-auth-token` session and `context.route` serving
  Supabase reads from data fetched with the service key; block all writes. Reach
  the editor via dynamic import of `/src/state/editor.ts` and use
  `editor.motion.projectPoint` to click/drag objects.

## 9. Known issues / backlog (not merge blockers)

- Agent-built models have no thumbnails (inspector shows a generic cube).
- The in-scene object toolbar (drei `Html`, zIndexRange up to 5) still draws over an
  open room menu's corner; raising `.topbar` z-index to 9 did not fix it.
- FurniMesh batch sizes are estimated (uniform scale to a typical category height),
  so some widths look odd in the browser; the agent refits to scanned sizes.
- Kitchen scan: 2 RoomPlan boxes (duplicate / wall-cut cabinet) are left out on load.
- Whole-house multi-room capture: implemented then reverted untested
  (`05dc2bc` / revert `4edab99`); see `PHONE_SCANNER_BACKLOG.md`.
- Other deferred phone features: v2 export, backup sharing, saved-scan delete,
  diagnostic log (`PHONE_SCANNER_BACKLOG.md`).

## 10. Working with this user

Hackathon: finishing beats polish. Explain in plain words what the user will see,
show before/after screenshots for visual changes, ask before pushing, merging into
`main`, or changing the hosted Supabase project, and never force-push or rewrite
the source branches.
