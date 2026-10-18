# 3D render agent

Bridges descriptions to renderable GLBs. Input: an `AssetRequest` (category, description, styles, colors,
size it must fit), e.g. a scanned object that has data but no 3D model yet. Output: a `RenderOutcome` whose
`assetId` resolves to a verified GLB the sandbox can render, or a placeholder when nothing works.

## Architecture: code router + retrieval agent + builder agent
```
request -> retrieveAsset (deterministic scores over the library, hard filters, top-K)
  score >= 0.75 (confident)      -> reuse the match, no model
  0.5 <= score < 0.75 (uncertain)-> RETRIEVAL AGENT: use a candidate as-is, or hand off to the builder
  nothing acceptable (< 0.5 / none) -> BUILDER AGENT directly (deterministic hand-off)
BUILDER AGENT (Blender): modify a close library asset, or create from scratch -> submit_asset
  -> normalize + validate + register (FileAssetRegistry) -> assetId
failure / no model / no Blender / generation forbidden -> best candidate or placeholder (assetId null)
```
The user's description is the exact request, so the retrieval agent chooses a candidate only if it satisfies
everything the request specifies; otherwise it hands off. Building is preferred over a near-miss.

- **Retrieval agent** (`retrievalAgent.ts`): one short judgment over pre-scored candidates (it sees each score and
  its breakdown: category affinity, size fit, style/color/material, text). Tools: `choose_asset`,
  `send_to_builder` (with a hand-off: reason, closest `baseAssetId`, and the `change` needed) or, when building is
  impossible, `reject_all`.
- **Builder agent** (`agent.ts`): tools `search_assets` (top-K, scored), `score_asset`, `import_asset_to_blender`,
  `run_blender_python`, `measure_model`, `view_model`, `submit_asset`, `use_placeholder`. It receives the hand-off
  (why reuse was ruled out, the suggested base asset and change, the scored candidates), so it usually starts
  with an import or a build step.
- **Code enforces, models decide.** Thresholds are judged against the ORIGINAL request (rewording a search can't
  unlock creation): creating from scratch is blocked while a confident match exists; a modification must start
  from an asset of the same kind; a retrieval choice must be a listed candidate; `submit_asset` only succeeds if
  the GLB passes `validateGlb` in the registry (size/proportions, triangle and texture budgets, self-contained,
  supported extensions), so the builder cannot approve its own output. Model-written Python passes `checkBpyCode`.

`RenderService` adds: the confident-match fast path (`fastPath: false` makes the retrieval agent review those too),
behavior without a model or Blender, request dedupe, concurrency, per-Blender exclusivity (leased lazily, only
when the builder reaches for Blender), and fallbacks. Expected failures never throw.

## Handing results to the scene
`toReplaceAssetOps(objects, outcomes)` yields `replaceAsset` ops (same object id, new `assetId`, fitted
`dimensionsM`). Locked objects are skipped; ops must still pass the scene engine's `validatePatch`. Generated and
modified assets land in `apps/web/public/models/generated/` with a `catalog.json`; the web app does not read that
catalog yet.

## Run it
```sh
pnpm --filter @house/render-agent test
pnpm --filter @house/render-agent resolve requests.json --no-model --no-blender   # retrieval only
# full: DEEPSEEK_API_KEY or OPENAI_API_KEY in the environment, and Blender (below)
```
Decision benchmark against a real model (no Blender needed; stops each run at the first commitment):
`tsx --env-file=<.env> bench/run.ts --trials 2 --out results.json`. See `bench/RESULTS.md`.

## Blender (verified against Blender 5.2.2 and the real MCP addon)
`BlenderMcpClient` speaks the Blender MCP addon's TCP protocol (`ahujasid/blender-mcp` `addon.py`, v1.8; default
127.0.0.1:9876, `BLENDER_MCP_PORT`): `{type, params}` -> `{status, result|message}`. It uses `ping`, `execute_code`,
the native `export_scene` (mesh objects only; script fallback for older addons) and `get_viewport_screenshot`.
Facts learned from the real addon and real runs, now handled in code/prompts:
- Each `execute_code` runs in a fresh namespace (only `bpy`): scene data persists, Python variables do not.
- Errors arrive as JSON (`exception_type`, `message`, `traceback`) and are shown to the agent readably.
- Imported glTF assets are **flattened** (no parent empties, identity transforms, world-space vertices, names kept);
  otherwise editing them is a fight with parent transforms.
- `measure_model` reports size, triangles, and every material's base color and whether a texture drives it.
- Requested colors are verified in the exported GLB (a flat matching base color on an untextured material);
  library materials are texture-driven, so the prompt carries the unlink-and-recolor recipe.
- `derivedFromAssetId` is accepted only if an imported object is still in the scene (a delete-and-rebuild is creating).
- Builder jobs have a wall-clock budget (default 8 min) and the model client retries transient errors.
- Viewport screenshots are framed on the model (GUI Blender only).

Two ways to provide the endpoint:
- **GUI Blender with the MCP addon** (the real thing; the addon refuses to run in `blender -b`). Without touching your
  Blender profile (temp scripts/config dirs, factory settings, no update check, telemetry stays off):
  ```sh
  mkdir -p /tmp/bl/scripts/addons && cp addon.py /tmp/bl/scripts/addons/blender_mcp_addon.py
  echo 'import addon_utils; addon_utils.enable("blender_mcp_addon", default_set=False, persistent=False)' > /tmp/bl/startup.py
  BLENDERMCP_NO_UPDATE_CHECK=1 BLENDER_USER_SCRIPTS=/tmp/bl/scripts BLENDER_USER_CONFIG=/tmp/bl/config \
    /Applications/Blender.app/Contents/MacOS/Blender --factory-startup --python /tmp/bl/startup.py
  ```
  Read the addon before enabling it: it executes arbitrary code by design (localhost only) and ships optional network integrations (off by default).
- **Headless, no GUI/addon** (tests, servers): `blender -b --factory-startup -P blender/blender_server.py -- --port 9876`
  (mirrors the addon's protocol for `ping`/`execute_code`/`get_scene_info`; no viewport).

Tests against real Blender: `pnpm --filter @house/render-agent test` runs `src/blender.integration.test.ts`, spawning the
headless server if Blender is installed (skips otherwise); set `BLENDER_MCP_PORT` (+ `BLENDER_EXPECT_GUI=1`) to run it
against a GUI session. Full stack with a real model: `tsx --env-file=<.env> bench/e2e.ts <outDir> [caseId...]` (writes
GLBs, traces and viewport screenshots to `<outDir>`).

## Safety
Model-written Python runs inside Blender. `checkBpyCode` blocks filesystem/OS/network/process access and Blender
persistence hooks, but it is a screen, not a sandbox. Request text can come from users or other models: run
Blender as a low-privilege user.

## Tests use fakes
`FakeBlender` fakes the port protocol (toy `BOX w h d` / `SCALE x y z`, and it measures real imported GLBs);
`scriptedModel` replays tool calls. They prove the router, both agents' tools, guards, gate, registry and
orchestration. They do not show that a real model writes good `bpy` or that real Blender accepts it.
