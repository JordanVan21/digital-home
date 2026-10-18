# Session notes: merge working knowledge (2026-10-17)

Things learned while doing steps 0–3b that are not obvious from the code. See `docs/MERGE_PLAN.md` for the plan and `docs/COLLIDER_PRECISION.md` for the next step.

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
- **test2 status after step 3b:** the 17 shelf items and 4 sofa items are still invalid under the voxel colliders (see COLLIDER_PRECISION.md); everything else validates. The demo studio and the scanned studio validate fully.

## User preferences seen this session

- Wants to *see* what changed: plain language, a before/after picture for visual steps, no jargon. "Not sure what changed" came after a jargon-heavy tilt summary.
- Judges by feel; prefers precise, general rules over category exceptions ("a general rule that can achieve high specificity for any scenario").
- Approves commits explicitly; happy to say "commit and continue".
