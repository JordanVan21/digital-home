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
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { AssetRequest, type AssetSpec, type SceneObject, type SceneSpec } from "@house/contracts";
import {
  BlenderMcpClient,
  BlenderPool,
  RenderService,
  createModel,
  fittedDimensions,
  requestForObject,
  type RenderOutcome,
} from "@house/render-agent";
import { normalizeRoomScan } from "@house/scan-import";
import { SupabaseAssetRegistry, SupabaseGlbStore, bucketPath, loadCatalog } from "./supabaseAssets";

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
const blender = await connectBlender();

/**
 * Use a running Blender MCP endpoint (GUI addon, one job at a time), else start
 * BLENDER_INSTANCES headless Blenders on consecutive ports so several objects can
 * be built at once. Started processes are killed on exit.
 */
async function connectBlender(): Promise<BlenderPool | null> {
  const client = (port: number, timeoutMs: number) => new BlenderMcpClient({ port, timeoutMs });
  if (await client(blenderPort, 1500).ping()) return new BlenderPool([client(blenderPort, 120_000)]);
  const binary = process.env.BLENDER_BIN ?? "/Applications/Blender.app/Contents/MacOS/Blender";
  if (!existsSync(binary)) return null;
  const count = Math.max(1, Number(process.env.BLENDER_INSTANCES) || 3);
  const server = fileURLToPath(new URL("../../../packages/render-agent/blender/blender_server.py", import.meta.url));
  const children = Array.from({ length: count }, (_, i) => {
    const child = spawn(binary, ["-b", "--factory-startup", "-P", server, "--", "--port", String(blenderPort + i)], { stdio: "ignore" });
    child.on("error", () => {});
    return child;
  });
  for (const signal of ["exit", "SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { for (const c of children) c.kill(); if (signal !== "exit") process.exit(130); });
  }
  const ready: number[] = [];
  for (let i = 0; i < 60 && ready.length < count; i++) {
    for (let k = 0; k < count; k++) {
      if (!ready.includes(k) && children[k].exitCode === null && (await client(blenderPort + k, 1500).ping())) ready.push(k);
    }
    if (ready.length < count) await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready.length) { for (const c of children) c.kill(); return null; }
  return new BlenderPool(ready.map((k) => client(blenderPort + k, 120_000)));
}
const blenderCount = blender ? Math.max(1, Number(process.env.BLENDER_INSTANCES) || 3) : 1;

const workDir = join(tmpdir(), "house-worker-assets");
await mkdir(workDir, { recursive: true });
const shared = {
  catalog: () => loadCatalog(db),
  registry: new SupabaseAssetRegistry(db, workDir),
  store: new SupabaseGlbStore(db),
};
// Pass 1: deterministic library matching only (seconds). Never blocks on a model or Blender.
const fast = new RenderService({ ...shared, model: null, blender: null, ambiguousWithoutModel: "accept_best" });
// Pass 2: agents + Blender for objects pass 1 could not match confidently.
const full = new RenderService({ ...shared, model, blender, concurrency: blenderCount });
const scanTimeLimitMs = (Number(process.env.SCAN_TIME_LIMIT_S) || 900) * 1000;

console.log(
  `worker: model=${model ? `${provider}/${modelName}` : "none"} blender=${blender ? `port ${blenderPort}` : "none"} ` +
    `x${blenderCount} generation=${allowGeneration && blender ? "on" : "off"} scanLimit=${scanTimeLimitMs / 1000}s`,
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

/** Plain-language method label: (a) library, (b) edited library model, (c) built in Blender. */
function method(source: RenderOutcome["source"]): string {
  switch (source) {
    case "retrieved":
    case "reused":
      return "a";
    case "modified":
      return "b";
    case "generated":
      return "c";
    case "best_effort":
      return "a (best effort)";
    default:
      return "placeholder";
  }
}

type ObjectReport = {
  objectId: string;
  category: string;
  method: string;
  source: RenderOutcome["source"];
  assetId: string | null;
  title: string | null;
  notes: string[];
  seconds: number;
  usage: RenderOutcome["usage"];
};

const reportEntry = (objectId: string, category: string, o: RenderOutcome, seconds: number): ObjectReport => ({
  objectId,
  category,
  method: method(o.source),
  source: o.source,
  assetId: o.assetId,
  title: o.asset?.title ?? null,
  notes: o.notes,
  seconds: Math.round(seconds * 10) / 10,
  usage: o.usage,
});

/** Same object id, new visual, uniformly fitted inside the scanned envelope. */
function withAsset(object: SceneObject, asset: AssetSpec, envelope: [number, number, number]): SceneObject {
  return { ...object, assetId: asset.id, dimensionsM: fittedDimensions(asset, envelope), displayName: asset.title };
}

async function processScan(scan: ScanRow) {
  const path = scan.files["scan.json"];
  if (!path) throw new Error("Upload has no scan.json.");
  const file = await db.storage.from("scan-files").download(path);
  if (file.error || !file.data) throw new Error(`Could not download scan.json: ${file.error?.message}`);
  const raw = JSON.parse(await file.data.text());

  // Reprocessing reuses the existing house/room ids, so the sandbox URL stays valid.
  const existing = await db.from("rooms").select("id,revision").eq("scan_id", scan.id).eq("source_room_index", 0).maybeSingle();
  if (existing.error) throw existing.error;
  const { shell, scene, warnings, scanToWorld } = normalizeRoomScan(raw, { origin: "center", wallFaces: "inner", alignToWalls: true });
  if (existing.data) scene.roomId = existing.data.id;
  const envelopes = new Map(scene.objects.map((o) => [o.id, o.dimensionsM]));

  // --- Pass 1: library matching, then write the room so the sandbox can open it now.
  const started = Date.now();
  const firstOutcomes = await fast.resolveMany(scene.objects.map((o) => requestForObject(o, { allowGeneration: false })));
  const firstSeconds = (Date.now() - started) / 1000 / Math.max(scene.objects.length, 1);
  const objects = scene.objects.map((o, i) => {
    const asset = firstOutcomes[i]?.asset;
    return asset ? withAsset(o, asset, o.dimensionsM) : o;
  });
  const resolved: SceneSpec = { ...scene, objects };
  const report = {
    warnings,
    scanToWorld,
    pass: "library",
    objects: scene.objects.map((o, i) => reportEntry(o.id, o.category, firstOutcomes[i], firstSeconds)),
  };

  let houseId = scan.house_id;
  if (!houseId) {
    const house = await db.from("houses").insert({ user_id: scan.user_id, name: scan.name }).select("id").single();
    if (house.error) throw house.error;
    houseId = house.data.id as string;
  }
  const revision = existing.data ? (existing.data.revision as number) + 1 : 0;
  const room = await db.from("rooms").upsert(
    {
      id: scene.roomId,
      user_id: scan.user_id,
      house_id: houseId,
      scan_id: scan.id,
      source_room_index: 0,
      name: scan.name,
      shell,
      original_scene: { ...resolved, revision },
      scene: { ...resolved, revision },
      revision,
      render_report: report,
    },
    { onConflict: "id" },
  );
  if (room.error) throw room.error;
  const linked = await db.from("scans").update({ house_id: houseId }).eq("id", scan.id);
  if (linked.error) throw linked.error;
  const matched = report.objects.filter((o) => o.assetId).length;
  console.log(`  room ${scene.roomId} ready: ${matched}/${scene.objects.length} objects from the library`);

  // --- Pass 2: agents/Blender for objects without a confident match, swapped in live.
  const pending = scene.objects
    .map((o, i) => ({ object: o, first: firstOutcomes[i] }))
    .filter(({ first }) => first.source !== "retrieved");
  if (model && pending.length) {
    console.log(`  improving ${pending.length} object(s) with ${blender && allowGeneration ? "agent + Blender" : "agent"}…`);
    const signal = AbortSignal.timeout(scanTimeLimitMs);
    let next = 0;
    const workers = Array.from({ length: blenderCount }, async () => {
      while (next < pending.length && !signal.aborted) {
        const { object, first } = pending[next++];
        const t0 = Date.now();
        const outcome = await full.resolve(requestForObject(object, { allowGeneration }), signal);
        const entry = reportEntry(object.id, object.category, outcome, (Date.now() - t0) / 1000);
        const better = outcome.asset && outcome.assetId !== first.assetId && outcome.source !== "best_effort";
        await swapIn(scene.roomId, object.id, first.assetId, better ? outcome.asset : null, envelopes.get(object.id)!, entry);
        console.log(better
          ? `    ${object.category}: (${entry.method}) ${entry.title} in ${entry.seconds}s`
          : `    ${object.category}: kept ${first.asset?.title ?? "placeholder"} (no better model, ${entry.seconds}s)`);
      }
    });
    await Promise.all(workers);
    if (signal.aborted) console.log(`  scan time limit reached; remaining objects keep their pass-1 model`);
  }

  const done = await db.from("scans").update({ status: "done", error: null }).eq("id", scan.id);
  if (done.error) throw done.error;
  console.log(`  done`);
}

/**
 * Swap one object's model into the saved room without touching anything else.
 * Skips objects the user deleted or already re-modelled; retries on a concurrent save
 * (revision check), so a sandbox edit is never overwritten.
 */
async function swapIn(
  roomId: string,
  objectId: string,
  expectedAssetId: string | null,
  asset: AssetSpec | null,
  envelope: [number, number, number],
  entry: ObjectReport,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await db.from("rooms").select("scene,original_scene,revision,render_report").eq("id", roomId).single();
    if (current.error) throw current.error;
    const { scene, original_scene, revision, render_report } = current.data as {
      scene: SceneSpec; original_scene: SceneSpec; revision: number; render_report: { objects: ObjectReport[] };
    };
    // No better model: the object keeps its pass-1 model, so keep that report entry too
    // and just note what the improvement attempt did.
    const report = {
      ...render_report,
      objects: render_report.objects.map((o) =>
        o.objectId !== objectId ? o
        : asset ? entry
        : { ...o, notes: [...o.notes, `Improvement (${entry.source}, ${entry.seconds}s) kept this model: ${entry.notes.at(-1) ?? "no better model"}`] },
      ),
    };
    let nextScene = scene;
    let nextOriginal = original_scene;
    if (asset) {
      const target = scene.objects.find((o) => o.id === objectId);
      if (target && target.assetId === expectedAssetId) {
        nextScene = { ...scene, revision: revision + 1, objects: scene.objects.map((o) => (o.id === objectId ? withAsset(o, asset, envelope) : o)) };
      }
      nextOriginal = { ...original_scene, objects: original_scene.objects.map((o) => (o.id === objectId ? withAsset(o, asset, envelope) : o)) };
    }
    const nextRevision = nextScene === scene ? revision : revision + 1;
    const update = await db
      .from("rooms")
      .update({ scene: nextScene, original_scene: nextOriginal, revision: nextRevision, render_report: report })
      .eq("id", roomId)
      .eq("revision", revision)
      .select("id");
    if (update.error) throw update.error;
    if (update.data.length) return;
  }
  console.warn(`    could not swap ${objectId}: room kept changing`);
}

// --- Planner asset requests: the caller decides placement; we only pick the model.
type AssetRequestRow = { id: string; request: unknown };
const requestTimeLimitMs = (Number(process.env.REQUEST_TIME_LIMIT_S) || 300) * 1000;
const requestLanes = Math.max(1, Number(process.env.REQUEST_CONCURRENCY) || 4);
const glbUrl = (key: string) => `${url}/storage/v1/object/public/glbs/${bucketPath(key)}`;
const answer = (o: RenderOutcome, seconds: number) => ({
  asset_id: o.assetId,
  asset: o.asset ? { ...o.asset, glbUrl: glbUrl(o.asset.glbStorageKey) } : null,
  method: method(o.source),
  source: o.source,
  notes: o.notes,
  seconds: Math.round(seconds * 10) / 10,
});

async function claimRequest(): Promise<AssetRequestRow | null> {
  const { data, error } = await db.from("asset_requests").select("id").eq("status", "pending").order("created_at").limit(1);
  if (error) throw error;
  if (!data.length) return null;
  const claimed = await db
    .from("asset_requests")
    .update({ status: "processing" })
    .eq("id", data[0].id)
    .eq("status", "pending")
    .select("id,request");
  if (claimed.error) throw claimed.error;
  return (claimed.data[0] as AssetRequestRow | undefined) ?? null;
}

/** Library match first (written immediately), then agents/Blender if it was not confident. */
async function processRequest(row: AssetRequestRow) {
  const parsed = AssetRequest.safeParse(row.request);
  if (!parsed.success) throw new Error(`Invalid AssetRequest: ${parsed.error.issues[0]?.message}`);
  const request = { ...parsed.data, allowGeneration: parsed.data.allowGeneration && allowGeneration };
  const t0 = Date.now();
  const first = await fast.resolve({ ...request, allowGeneration: false });
  let final = first;
  if (first.source !== "retrieved" && model) {
    const interim = await db.from("asset_requests").update(answer(first, (Date.now() - t0) / 1000)).eq("id", row.id);
    if (interim.error) throw interim.error;
    const improved = await full.resolve(request, AbortSignal.timeout(requestTimeLimitMs));
    if (improved.asset && improved.source !== "best_effort") final = improved;
  }
  const done = await db
    .from("asset_requests")
    .update({ ...answer(final, (Date.now() - t0) / 1000), status: "done", error: null })
    .eq("id", row.id);
  if (done.error) throw done.error;
  console.log(`request ${row.id}: ${request.category} -> (${method(final.source)}) ${final.asset?.title ?? "placeholder"}`);
}

/** Runs one queue until it is empty (--once) or forever, one item at a time. */
async function drain<T extends { id: string }>(
  label: string,
  next: () => Promise<T | null>,
  work: (item: T) => Promise<void>,
  fail: (item: T, message: string) => PromiseLike<unknown>,
) {
  for (;;) {
    let missingTable = false;
    const item = await next().catch((error: { message?: string; code?: string }) => {
      // PGRST205 / 42P01: the queue's table is not deployed yet (migration pending).
      missingTable = error?.code === "PGRST205" || error?.code === "42P01";
      if (!missingTable) console.error(`${label} queue: ${error?.message ?? String(error)}`);
      return null;
    });
    if (missingTable) {
      console.log(`${label} queue off: its table is not deployed yet (apply the pending migration).`);
      return;
    }
    if (!item) {
      if (once) return;
      await new Promise((r) => setTimeout(r, label === "request" ? 1500 : 5000));
      continue;
    }
    try {
      await work(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ${label} ${item.id} failed: ${message}`);
      await fail(item, message);
    }
  }
}

// Scans and planner requests run side by side, so a long scan never blocks the planner.
await Promise.all([
  drain(
    "scan",
    claim,
    (scan) => {
      console.log(`scan ${scan.id} "${scan.name}"`);
      return processScan(scan);
    },
    (scan, message) => db.from("scans").update({ status: "failed", error: message }).eq("id", scan.id),
  ),
  // Several request lanes: the planner asks for a room's pieces together and only waits
  // so long, so one slow agent check must not hold up the library answers for the rest.
  // claimRequest is atomic (pending -> processing), so lanes never take the same row.
  ...Array.from({ length: requestLanes }, () =>
    drain(
      "request",
      claimRequest,
      processRequest,
      (row, message) => db.from("asset_requests").update({ status: "failed", error: message }).eq("id", row.id),
    ),
  ),
]);
process.exit(0); // --once: also stops the headless Blenders we started
