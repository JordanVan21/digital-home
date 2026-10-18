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

## Blender
Two ways to provide the TCP endpoint `BlenderMcpClient` talks to (default 127.0.0.1:9876, `BLENDER_MCP_PORT`):
- **Headless, no GUI/addon**: `blender -b --factory-startup -P packages/render-agent/blender/blender_server.py -- --port 9876`
  (same JSON protocol; no viewport, so `view_model` reports unavailable).
- **GUI with the Blender MCP addon** (`ahujasid/blender-mcp`): connect to the MCP server from the sidebar.

Export, import and screenshots go through temp files, so Blender must run on the same machine.
**Neither path has been run against a real Blender yet** (none was installed when this was written): the
protocol shape and the `bpy.ops.export_scene.gltf` / `import_scene.gltf` arguments are unconfirmed.

## Safety
Model-written Python runs inside Blender. `checkBpyCode` blocks filesystem/OS/network/process access and Blender
persistence hooks, but it is a screen, not a sandbox. Request text can come from users or other models: run
Blender as a low-privilege user.

## Tests use fakes
`FakeBlender` fakes the port protocol (toy `BOX w h d` / `SCALE x y z`, and it measures real imported GLBs);
`scriptedModel` replays tool calls. They prove the router, both agents' tools, guards, gate, registry and
orchestration. They do not show that a real model writes good `bpy` or that real Blender accepts it.
