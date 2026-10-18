# 3D render agent

Turns an `AssetRequest` (category, description, styles, size) into an `assetId` that resolves to a
verified GLB. Used by the room scanner (objects with no asset yet) and the aesthetic planner (new items).

```
request -> retrieveAsset (deterministic, packages/asset-service)
  matched      -> done, no model call
  ambiguous    -> selection agent picks a candidate, or asks for generation
  needs_gen    -> generation agent builds it in Blender -> submit_asset
                  -> normalize + validate + register (FileAssetRegistry) -> assetId
  otherwise    -> placeholder outcome (assetId null; renderer keeps its approximate box)
```

The model decides; deterministic code enforces. An asset only becomes `verified` by passing
`validateGlb` inside `registry.registerGenerated`, so the agent cannot approve its own output.
Identical concurrent requests share one job; Blender jobs run one at a time per Blender instance.

## Handing results to the frontend
`toReplaceAssetOps(objects, outcomes)` yields `replaceAsset` ops (same object id, new `assetId`,
fitted `dimensionsM`). Retrieval results are available immediately; generation finishes later, so
apply ops as `resolveMany`'s `onOutcome` fires. Generated assets land in
`apps/web/public/models/generated/` with a `catalog.json`; the web app does not read that catalog yet
(it still bundles `assetCatalog.json`), so rendering generated assets needs the async catalog lookup.

## Run it
```sh
pnpm --filter @house/render-agent test
# retrieval only, no keys needed:
pnpm --filter @house/render-agent resolve requests.json --no-model --no-blender
# full: needs DEEPSEEK_API_KEY or OPENAI_API_KEY in the environment and Blender (below)
```

## Blender setup (not verified: no Blender was available when this was written)
1. Install Blender 4.x and the Blender MCP addon (`ahujasid/blender-mcp`, `addon.py`); in Blender's 3D
   viewport sidebar, "Connect to MCP server" (default port 9876; override with `BLENDER_MCP_PORT`).
2. `BlenderMcpClient` speaks the addon's TCP JSON protocol (`execute_code`, `get_viewport_screenshot`).
   Export and screenshots go through temp files, so Blender must run on the same machine.
3. First thing to check on a real install: the protocol shape in `BlenderMcpClient.command`/`runPython`,
   and the `bpy.ops.export_scene.gltf` arguments in `exportScript`.

## Safety
Model-written Python runs inside Blender. `checkBpyCode` blocks filesystem/OS/network/process access and
Blender persistence hooks, but it is a screen, not a sandbox. Request text can come from users or other
models, so run Blender as a low-privilege user on a machine you are comfortable exposing to that risk.

## Tests use fakes
`FakeBlender` fakes the port protocol with a toy `BOX w h d` language; `scriptedModel` replays tool calls.
They prove the loop, guard, gate, registry and orchestration, not that a real model writes good bpy
or that real Blender accepts it.
