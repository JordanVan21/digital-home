// Scan processing worker: uploaded phone scan -> RoomShell + SceneSpec (scan-import)
// -> each object resolved to a library asset by the render agent -> houses/rooms rows
// the sandbox loads. Runs on the Mac with the service-role key (never in a client).
//
//   pnpm --filter @house/worker start            # poll forever
//   pnpm --filter @house/worker once             # process what is queued, then exit
//   ... start -- --retry-failed                  # requeue failed scans first
//   ... once -- --reprocess                      # redo every scan (e.g. after seeding assets)
//
// Optional: DEEPSEEK_API_KEY / OPENAI_API_KEY (+ AGENT_PROVIDER=openai) enables the
// retrieval/builder agents; a Blender MCP endpoint on BLENDER_MCP_PORT (default 9876)
// plus ALLOW_GENERATION=1 enables building new GLBs. Without them, matching is
// deterministic and unmatched objects keep their measured placeholder box.
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { SceneObject, SceneSpec } from "@house/contracts";
import {
  BlenderMcpClient,
  BlenderPool,
  RenderService,
  createModel,
  requestForObject,
  toReplaceAssetOps,
  type RenderOutcome,
} from "@house/render-agent";
import { normalizeRoomScan } from "@house/scan-import";
import { SupabaseAssetRegistry, SupabaseGlbStore, loadCatalog } from "./supabaseAssets";

type ScanRow = {
  id: string;
  user_id: string;
  house_id: string | null;
  name: string;
  files: Record<string, string>;
};

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the repo-root .env");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const once = process.argv.includes("--once");
const allowGeneration = process.env.ALLOW_GENERATION === "1";

const provider = process.env.AGENT_PROVIDER === "openai" ? "openai" : "deepseek";
const apiKey = process.env[provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"];
const modelName =
  process.env[`${provider.toUpperCase()}_MODEL`] || (provider === "openai" ? "gpt-5.4-mini" : "deepseek-v4-pro");
const model = apiKey ? createModel({ provider, apiKey, model: modelName, reasoningEffort: "low" }) : null;

const blenderPort = Number(process.env.BLENDER_MCP_PORT) || 9876;
const blender = (await new BlenderMcpClient({ port: blenderPort, timeoutMs: 1500 }).ping())
  ? new BlenderPool([new BlenderMcpClient({ port: blenderPort, timeoutMs: 120_000 })])
  : null;

const workDir = join(tmpdir(), "house-worker-assets");
await mkdir(workDir, { recursive: true });
const render = new RenderService({
  catalog: () => loadCatalog(db),
  registry: new SupabaseAssetRegistry(db, workDir),
  store: new SupabaseGlbStore(db),
  model,
  blender,
  concurrency: 2,
});

console.log(
  `worker: model=${model ? `${provider}/${modelName}` : "none"} blender=${blender ? `port ${blenderPort}` : "none"} ` +
    `generation=${allowGeneration && blender ? "on" : "off"}`,
);

// --retry-failed requeues failed scans; --reprocess also redoes finished ones
// (e.g. after the asset library changed). Room/house ids are kept.
const requeue = process.argv.includes("--reprocess") ? ["failed", "done"]
  : process.argv.includes("--retry-failed") ? ["failed"] : [];
if (requeue.length) {
  const { error } = await db.from("scans").update({ status: "uploaded", error: null }).in("status", requeue);
  if (error) throw error;
}

/** Atomically move the oldest uploaded scan to processing; null when the queue is empty. */
async function claim(): Promise<ScanRow | null> {
  const { data, error } = await db.from("scans").select("id").eq("status", "uploaded").order("created_at").limit(1);
  if (error) throw error;
  if (!data.length) return null;
  const claimed = await db
    .from("scans")
    .update({ status: "processing", error: null })
    .eq("id", data[0].id)
    .eq("status", "uploaded")
    .select("id,user_id,house_id,name,files");
  if (claimed.error) throw claimed.error;
  return (claimed.data[0] as ScanRow | undefined) ?? null;
}

async function processScan(scan: ScanRow) {
  const path = scan.files["scan.json"];
  if (!path) throw new Error("Upload has no scan.json.");
  const file = await db.storage.from("scan-files").download(path);
  if (file.error || !file.data) throw new Error(`Could not download scan.json: ${file.error?.message}`);
  const raw = JSON.parse(await file.data.text());

  // Reprocessing reuses the existing house/room ids, so the sandbox URL stays valid.
  const existing = await db.from("rooms").select("id").eq("scan_id", scan.id).eq("source_room_index", 0).maybeSingle();
  if (existing.error) throw existing.error;
  const { shell, scene, warnings, scanToWorld } = normalizeRoomScan(raw);
  if (existing.data) scene.roomId = existing.data.id;

  const { outcomes, resolved } = await resolveAssets(scene);
  const report = {
    warnings,
    scanToWorld,
    objects: scene.objects.map((o, i) => ({
      objectId: o.id,
      category: o.category,
      source: outcomes[i]?.source ?? "placeholder",
      assetId: outcomes[i]?.assetId ?? null,
      title: outcomes[i]?.asset?.title ?? null,
      retrieval: outcomes[i]?.retrieval ?? null,
      notes: outcomes[i]?.notes ?? [],
    })),
  };

  let houseId = scan.house_id;
  if (!houseId) {
    const house = await db.from("houses").insert({ user_id: scan.user_id, name: scan.name }).select("id").single();
    if (house.error) throw house.error;
    houseId = house.data.id as string;
  }
  const room = await db.from("rooms").upsert(
    {
      id: scene.roomId,
      user_id: scan.user_id,
      house_id: houseId,
      scan_id: scan.id,
      source_room_index: 0,
      name: scan.name,
      shell,
      original_scene: resolved,
      scene: resolved,
      revision: 0,
      render_report: report,
    },
    { onConflict: "id" },
  );
  if (room.error) throw room.error;
  const done = await db.from("scans").update({ status: "done", house_id: houseId, error: null }).eq("id", scan.id);
  if (done.error) throw done.error;
  const matched = report.objects.filter((o) => o.assetId).length;
  console.log(`  done: room ${scene.roomId}, ${matched}/${scene.objects.length} objects matched to library assets`);
}

/** Ask the render agent for every scanned object; apply the resulting replaceAsset ops. */
async function resolveAssets(scene: SceneSpec): Promise<{ outcomes: RenderOutcome[]; resolved: SceneSpec }> {
  const targets = scene.objects;
  const outcomes = await render.resolveMany(targets.map((o) => requestForObject(o, { allowGeneration })));
  const byId = new Map(outcomes.map((o, i) => [targets[i].id, o]));
  const ops = toReplaceAssetOps(targets, outcomes);
  const objects: SceneObject[] = scene.objects.map((object) => {
    const op = ops.find((p) => p.type === "replaceAsset" && p.objectId === object.id);
    if (!op || op.type !== "replaceAsset") return object;
    const asset = byId.get(object.id)?.asset;
    return { ...object, assetId: op.assetId, dimensionsM: op.dimensionsM ?? object.dimensionsM, displayName: asset?.title ?? object.displayName };
  });
  return { outcomes, resolved: { ...scene, objects } };
}

for (;;) {
  const scan = await claim();
  if (!scan) {
    if (once) break;
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }
  console.log(`scan ${scan.id} "${scan.name}"`);
  try {
    await processScan(scan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  failed: ${message}`);
    await db.from("scans").update({ status: "failed", error: message }).eq("id", scan.id);
  }
}
