# Session notes: merge working knowledge (2026-10-17)

Things learned while doing steps 0–4 that are not obvious from the code. See `docs/MERGE_PLAN.md` for the plan and next step, and `docs/COLLIDER_PRECISION.md` for how colliders work now.

## Environment

- **pnpm:** `export PATH=/tmp/house-tools/node_modules/.bin:$PATH` (pnpm 10.32.1). If `/tmp` was cleared, use `npx -y pnpm@10.32.1`.
- **Dev servers** (restart with `pnpm exec vite --host 127.0.0.1 --port N --strictPort` from `apps/web`):

  | Port | What | Notes |
  |---|---|---|
  | **5185** | **this branch** (codex-base) | Our server. 5184 was taken. |
  | 5182 | original codex (`digital-home-codex-sandbox`) | Reference for feel |
  | 5181 | Jordan (`dh-review/3d-sandblox-jordan`) | Look reference |
  | 5183 | original sandbox | |
  | 5184 | aesthetic-planner review server | Not ours; leave it running |
  | 5173 | **the `digital-home-codex-sandbox` worktree** | Playwright's default URL. It *reuses* this server, so without `HOUSE_E2E_PORT` the browser tests test the wrong checkout. |

- **Browser tests:** `HOUSE_E2E_PORT=5185 HOUSE_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:browser` (9 tests, about 3 min, SwiftShader). Long flows use `test.slow()`.
- **GPU screenshots:** headless system Chrome with `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` renders on the M4. Minimal script (put it in the scratchpad, not the repo):
  ```js
  import { chromium } from "/Users/jeffreyg/Projects/digital-home-codex-base/node_modules/@playwright/test/index.mjs";
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:5185/"); await page.waitForTimeout(5000);
  // switch room: getByRole("button", { name: /^Switch room/ }), then getByRole("menuitemradio", { name, exact: true })
  await page.screenshot({ path: "shot.png" }); await browser.close();
  ```
  Use `deviceScaleFactor: 2` and `clip` for close-ups.
- **Before/after comparisons:** `git stash -u`, screenshot (Vite hot-reloads), then `git stash pop`.
- **Run vitest from the repo root** (`pnpm test` or `pnpm exec vitest run <path>`). Running it from `apps/web` loads two copies of Three.js, and `instanceof` checks in renderer tests fail even on clean code.
- **Collider bake:** `pnpm geometry:bake` takes about 2 s. Box counts print per model; `collision.bench.ts` measured 0.042 ms per query (BVH) after step 4.
- **Python** is available through `uv run --no-project --with <pkg> python …`; nothing is installed globally. It was used only for the CoACD trial.
- **Engine diagnostics:** write a throwaway `*.test.ts` under `packages/scene-engine/src` or `apps/web/src/state` that prints measurements, run it with `pnpm exec vitest run <file>`, then delete it. `topContactFaces` is not exported from the engine index; import it from `packages/scene-engine/src/contactFaces`.
- **Asset scripts:**
  - `node scripts/import-jordan-catalog.mjs`, `node scripts/import-jordan-fixtures.mjs` (both read from git `origin/feature/3d-sandblox-jordan`);
  - `pnpm geometry:bake`, `pnpm assets:verify`;
  - `node scripts/render-thumbnails.mjs` (needs `HOUSE_DEV_URL=http://127.0.0.1:5185`, `HOUSE_BROWSER_EXECUTABLE`, and the dev-only `?thumbnail-studio=<assetId>` page).

## Architecture added on this branch

- **Rooms:**
  - `packages/contracts/src/rooms.ts` holds the `RoomDefinition` type, `livingRoom`, `roomFromFixture`, and the parsed fixtures (`rooms/test2-room.json`, `rooms/demo-room.json`, `rooms/demo-scan.json`).
  - The list lives in the web app (`apps/web/src/state/rooms.ts`: `rooms`, `roomById`, `scannedStudio`), because scan reproduction needs the engine and contracts can't import it.
  - The editor: `createEditor(repository?, initialRoom)`, `editor.room` store, `editor.context()`, `editor.switchRoom(id)` (refuses with a pending draft; flushes autosave first), `editor.load(roomId?)`.
  - `state/lastRoom.ts` remembers the room per device (`house.lastRoom.v1`).
  - Room IDs: living room `00000000-0000-4000-8000-000000000004`; the scanned studio uses the scan's roomId; test2 and demo use their fixture roomIds.
- **Catalog:** codex IDs `00000000-…-1000…`, `…-2000…`; Jordan IDs `a55e7000-…`. Category aliases are in `scripts/jordan-categories.mjs` (`coffee_table`→`coffee-table`, `cabinet`→`sideboard`, `shelf`→`bookshelf`, `vase`/`bowl`/`tray`/`book`→`decor`, `pillow`/`throw`→`textile`, `wall_art`→`wall-art`, `floor_lamp`→`lamp`, `small_plant`→`plant`). Jordan's `light`, `variants`, `collision`, `supports` and `frontAxis` asset fields were *not* imported; re-import them when steps 11 and 20 need them.
- **Contracts (additive):**
  - openings: `kind: "opening"`, `swing`, `glazing`;
  - objects: `tilt`, `scanMatch`;
  - scenes: `appearance`;
  - new schemas: `RoomFixtureSchema`, `ScanFixtureSchema`, `RoomPlanCategorySchema`.

  Each is recorded in `apps/web/README.md` Decisions 22–28.
- **Engine:**
  - `matching.ts` (scan reproduction, `rankByDimensionFit`; max error 0.25 because codex stretches models to their box);
  - `tiltedDimensions` and `scaledDimensions` (geometry.ts);
  - tilted `colliderBlocks` (collision.ts);
  - `SLIDING_DOOR_WALKWAY_M = 0.9` (geometry.ts `doorClearances`).
- **Renderer:** `Model.tsx` `TiltFrame`. Furniture and CollisionOutline size by `tiltedDimensions`.

## Conventions discovered

- **Walls:** codex centres a wall on its floor-polygon edge. Jordan puts the wall's *inner face* on the edge. The fixture importer moves Jordan's walls outward by half their thickness, re-joins the corners and shifts opening offsets.
- **Wall items:** codex requires `placement.parentId` = the wall ID; the importer assigns the nearest wall.
- **Lighting preset IDs:** the fixtures use `daylight`, `golden-hour` and `evening`. Codex currently has `golden-hour`, `daylight` and `overcast`, so `evening` falls back until step 7.
- **Models:** both catalogs are bottom-centred, metre scale, +Z front. Codex's renderer fits each model to `dimensionsM` non-uniformly, so a loosely matched model looks stretched.
- **Validation:** codex only validates changed and added pieces. A fixture that breaks rules looks fine until you edit near it, then Accept tries to "fix" it. Always check new fixtures with `validateObject` over every object.
- **Accept:** carries children at their local offset (`moveAssembly`), so a sofa's pillows keep their pose when the sofa moves.
- **test2 status after step 4:** 40 of 45 pieces validate. The 5 invalid ones are the 3 sofa pillows, the knit throw and the sofa itself (which collides with a pillow); they sit 11–19 cm inside the real back cushion, and step 5 re-poses them. The living room, demo studio and scanned studio validate fully.
- **The "Sculptural walnut coffee table" (codex `…1002`) is multi-level:** its real top is 0.282 m, with raised 0.35 m blocks. Tests that need a flat tabletop use the "Concrete-top coffee table" (`a55e7000-…0003`).
- **GLB positions are quantized**, so baked heights differ from round authored numbers by tens of micrometres (Jordan's shelf boards are at 0.46994 / 0.89004). Contact and collision both allow 0.1 mm.

## User preferences seen this session

- Wants to *see* what changed: plain language, a before/after picture for visual steps, no jargon. "Not sure what changed" came after a jargon-heavy tilt summary.
- Judges by feel; prefers precise, general rules over category exceptions ("a general rule that can achieve high specificity for any scenario").
- Approves commits explicitly; happy to say "commit and continue".

## Autonomous continuation (2026-10-17)

The user approved finishing all remaining merge steps autonomously, including commits without asking. Never push. Compare the finished merge against Codex (5182) and Jordan (5181). This overrides the earlier commit-approval instructions.

## Step 5 completed

- Full quaternion geometry, OBB collision, projected occupied-volume contact stability, full-pose assemblies, X/Y/Z inspector fields and quick poses; the swivel stays horizontal and rotates about world Y.
- Fixture tilt fields folded into quaternions; compatibility rendering retained. All 45 test2 pieces validate after the sofa textiles were re-posed.
- Every check passed: format, typecheck, lint, 193 unit tests, build, 10 browser tests (`HOUSE_E2E_PORT=5185`, system Chrome). Browser suite took 3.6 minutes. GPU Chrome reported Apple M4 Metal; same real mouse drag produced the same movement and one suggestion on 5182 and 5185. No 60 FPS guarantee was measured.
- Visual review: `docs/review/STEP_5.md`. Known geometric stability assumptions are documented there and in the web README. Step 6 skipped: no soft-item exemption needed. Next: step 7 lighting.

## Step 7 completed

Local CC0 HDRs, room-relative sunlight through the largest glazed opening, fitted shadows, daylight / golden-hour / evening, and preset accent/backdrop are in place. All checks passed: format, typecheck, lint, 196 unit tests, build, 10 browser tests (3.8 minutes), and M4 GPU images in `docs/review/STEP_7.md`. Preserve Golden hour → Daylight → Evening for the lighting button.

Do not format or edit app source while Playwright runs against Vite: HMR can detach a button mid-click. A clean, unchanged-server rerun passed the chair stack test that a live reload had interrupted. Prepare the next feature in `/tmp` while browser checks finish.

## Step 8 completed

Glazing/open doorways, local PBR floor finishes, paint, Cut away / Fade / Show, wall-item visibility and click-through, and the Room inspector are complete. `setAppearance` is a schema-typed room-wide suggestion; scene diffs now include `appearanceChanged`. All checks pass: 203 unit tests, 11 browser tests, build, typecheck, lint and format. Visual review: `docs/review/STEP_8.md`.

For subsequent local browser runs use `HOUSE_BROWSER_GPU=1 HOUSE_E2E_PORT=5185 HOUSE_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:browser`. This opt-in uses the verified Apple M4 Metal backend and ran 11 tests in 57.5 s. Without the GPU flag, the original SwiftShader configuration remains available. Keep app source unchanged during the browser suite.

## Step 9 completed

Warm cream glass, warm ink/shadows, higher evening opacity and readable secondary text. A browser contrast regression failed before (2.64:1 in Golden hour) and passes across all three presets now. All checks green: 203 unit tests, 12 GPU browser tests (1.1 minutes), format/typecheck/lint/build. Visual review: `docs/review/STEP_9.md`. Next: CameraControls and views/walk, preserving Codex drag priority.

## Step 10 completed

CameraControls, smooth views, dolly-to-cursor, selection/room framing, eye/top/isometric views, and P/WASD/Escape walk mode. Initial living-room camera remains exactly [7.2,6.5,8.3] aimed at [0,.65,0], preserving existing real-mouse browser tests. Motion exposes transient camera position/direction/target and projection for later keyboard/marquee features. All checks passed: 207 unit tests, 13 GPU browser tests (1.1 minutes), build/typecheck/lint/format. Review: `docs/review/STEP_10.md`.

CameraControls boundaryEnclosesCamera must stay off during walk entry and turn on at rest; enabling it immediately caused an 8.7 m single-frame jump, caught by the new browser test. View popovers need a higher stacking order than the inspector. Framing uses fitToSphere to retain viewing direction.

The original 5185 server stopped during this step. A persistent Vite server is now running through exec session 80119, from this worktree’s apps/web on 5185. Keep it running. Browser commands must always set HOUSE_E2E_PORT=5185, HOUSE_BROWSER_GPU=1, and the system Chrome path.

## Step 11 completed

Lamp metadata imported, `lightOn`/`setLight`, owned emissive materials, 8 active practical lights / 1 practical shadow budget plus the sun, demand rendering, and `?perf`. All checks passed: 211 unit tests, 14 GPU browser tests, build/typecheck/lint/format. Visual review and benchmark: `docs/review/STEP_11.md`.

Performance: real-pointer drag in test2 + one proxy averaged 58.9 rendered FPS, rolling 59.9, 164 final-scene draws / 186,457 triangles on Apple M4 Metal. Zero frames over a 400 ms idle check. Do not insert an extra 16 ms pause after each Playwright mouse move when measuring cadence; CDP already paces those inputs. PerfProbe must read in addAfterEffect after the main render: useFrame reads the contact-shadow blur pass (1 draw / 2 triangles), which was wrong and now has a browser regression.

Demand rendering: imperative Furniture moves explicitly invalidate; easing clamps the initial post-idle delta. Camera transitions invalidate once and defer start to the next RAF so idle time cannot become one giant animation step. Stores subscribe through IdleFrameloop; transient motion remains outside React. The persistent 5185 server is still exec session 80119.

## Step 12 completed

Toolbar/Ctrl-Cmd+D duplicate into a nearby valid spot, preserving pose/scale/finishes/light state, as one draft step per copy. Locks/gestures guarded, wall copies stay along their wall. All checks: 213 unit tests, 15 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_12.md`. Browser screenshots must wait for model loading; an immediate screenshot can capture the blank/loading frame even after scene data is ready.

Next keyboard extraction/tests are prepared in `/tmp/house-keyboard-step13.ts` and `/tmp/house-keyboard-tests-step13.ts`; they have not been applied.


## Step 13 completed

Camera-relative 2 cm arrow nudges (Shift ×10), Q/E absolute-grid turns, F selection and Home room framing. Keyboard handling extracted for tests. All checks passed: 216 unit tests, 16 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_13.md`. Next: editable XYZ position.

## Step 14 completed

Editable exact XYZ metre fields through suggestions, disabled during drags/locks; height-only movement summary fixed. All checks passed: 218 unit tests, 17 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_14.md`. Existing browser tests now read position inputs instead of removed read-only outputs. Next: multi-select.

## Step 15 completed

Shift-click/Shift-marquee selection, primary inspector/rotation, atomic multi-piece translation with transient preview and one undo step, selected supports carry children once, locks protect whole moves, F frames selection. Shift-drag keeps existing grid snapping; toggle selection happens on click release. All checks: 221 unit tests, 18 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_15.md`. Next: persistent groups.

## Step 16 completed

Typed groupId/setGroup with inverse, atomic Group/Ungroup suggestions, Ctrl/Cmd+G / Shift modifier, saved group selection, Alt-member pick. Copies detach group identity. Browser caught normal clicks retaining a prior Alt-member selection; fixed and covered. All checks: 223 unit tests, 19 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_16.md`. Next: wall/ceiling items.

## Step 17 completed

Asset mount metadata (preserved by catalog importer), ceiling support, exact wall contact/opening validation, collision checks for mounted objects, nearest-wall remount on Accept and ceiling attachment. Wall pointer plane rebases when crossing corners and mutates both live position and quaternion; GPU-free regression covers continuation without model rerenders. Explicit transparent glass is corrected on owned materials (opacity/depth/shadow); source artwork had a fully opaque metallic glass layer hiding the picture, confirmed by inspecting both sides in Chrome. All checks: 229 unit tests, 20 GPU browser tests, format/typecheck/lint/build. Review: `docs/review/STEP_17.md`. Next: resize.
