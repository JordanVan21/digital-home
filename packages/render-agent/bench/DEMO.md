# Local render demo

From the repository root, install workspace dependencies with `pnpm install` if needed, then:

```sh
cd packages/render-agent
pnpm exec tsx --env-file=../../.env bench/demo-server.ts
# Alternatively, with credentials already exported: pnpm demo
# Options: --port 5199 --registry /tmp/my-house-render-demo
```

Open **http://127.0.0.1:5199**. Keys are read only from process environment;
`.env` is never served. `AGENT_PROVIDER=openai` selects OpenAI; default is DeepSeek.
Use `DEEPSEEK_API_KEY` / `OPENAI_API_KEY`, optionally `DEEPSEEK_MODEL` / `OPENAI_MODEL`.
The status shows provider/model and whether a key is set. A model key is required for
the single description-to-request parse call, including retrieval-only requests.

Try “accent armchair for a reading nook” (library retrieval, zero render-agent calls)
and “round dining table with a walnut top and four slender tapered legs” (Blender build).
The parsed request is expanded before routing. Repeat the table request to retrieve
its registered model. Turn off “Allow Blender to build” to forbid generation.
Cancel disconnects the stream and aborts the job; another job may briefly report busy
while Blender finishes its current operation. One job runs at a time.

Generated GLBs and the catalog live outside the repo, by default in
`os.tmpdir()/house-render-demo`. The generated strip includes assets retained from
previous runs in that registry. “Clear generated assets” removes catalog-listed GLBs
and the generated catalog, leaving unrelated files alone. Library thumbnails are
rendered in the browser from local GLBs; no thumbnail image files or CDN scripts are
needed. The viewer requires WebGL2. Only fonts use Google Fonts.

The server binds only to 127.0.0.1 and checks Host, POST Origin, JSON content type,
body size, and model paths. Keep Blender on localhost as well. The existing
`checkBpyCode` guard stays enabled; model Python runs inside Blender and that guard
is a screen, not a sandbox. Run Blender under a low-privilege account.

At startup, the server pings `BLENDER_MCP_PORT` (default 9876). An answering endpoint
is reported as `addon`. Otherwise it starts the installed macOS Blender headlessly on
a free port, or reports `none` and disables building. Its own Blender process is killed
on shutdown. Headless Blender builds GLBs but provides **no live viewport screenshots**.
Status classifies an already-running endpoint as addon as requested; point that port
at a GUI addon if you want live screenshots.

For live screenshots, obtain `addon.py` from
[ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp), **read it before enabling**,
and follow the package README’s Blender section. Do not copy it into this repo.
Use temporary `BLENDER_USER_SCRIPTS` and `BLENDER_USER_CONFIG` directories,
`--factory-startup`, and `BLENDERMCP_NO_UPDATE_CHECK=1`; telemetry stays off.
For example, after placing the reviewed addon outside the repo:

```sh
mkdir -p /tmp/house-blender/scripts/addons /tmp/house-blender/config
cp /path/to/reviewed/addon.py /tmp/house-blender/scripts/addons/blender_mcp_addon.py
printf '%s\n' 'import addon_utils; addon_utils.enable("blender_mcp_addon", default_set=False, persistent=False)' > /tmp/house-blender/startup.py
BLENDERMCP_NO_UPDATE_CHECK=1 BLENDER_USER_SCRIPTS=/tmp/house-blender/scripts BLENDER_USER_CONFIG=/tmp/house-blender/config \
  /Applications/Blender.app/Contents/MacOS/Blender --factory-startup --python /tmp/house-blender/startup.py
```

Start the addon’s localhost server from its GUI panel, then start this demo.

Checks:

```sh
pnpm --filter @house/render-agent typecheck
pnpm --filter @house/render-agent test
```
