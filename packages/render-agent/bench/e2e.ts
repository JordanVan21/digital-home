import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileAssetRegistry, FileGlbStore, inspectGlb } from "@house/asset-service";
import { AssetRequest, AssetSpec } from "@house/contracts";
import { BlenderMcpClient, BlenderPool, type BlenderPort } from "../src/blender";
import { createModel } from "../src/model";
import { RenderService } from "../src/service";

/**
 * End to end with a REAL model and a REAL Blender (MCP addon or headless server on BLENDER_MCP_PORT, default 9876):
 *   tsx --env-file=<.env> bench/e2e.ts <outDir> [caseId ...]
 * Writes generated GLBs, per-step traces and a viewport screenshot of each submitted model into <outDir>.
 * The registry lives in <outDir>, not in the repo.
 */
const outDir = process.argv[2];
if (!outDir) { console.error("usage: e2e.ts <outDir> [caseId ...]"); process.exit(2); }
mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(3);

const provider = process.env.AGENT_PROVIDER === "openai" ? "openai" : "deepseek";
const apiKey = process.env[provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"];
if (!apiKey) { console.error(`No ${provider} API key in the environment.`); process.exit(2); }
const modelName = process.env[`${provider.toUpperCase()}_MODEL`] || (provider === "openai" ? "gpt-5.4-mini" : "deepseek-v4-pro");
const baseModel = createModel({ provider, apiKey, model: modelName, reasoningEffort: "low" });

const webRoot = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const bundled = (JSON.parse(readFileSync(`${webRoot}/src/fixtures/assetCatalog.json`, "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));
const registry = new FileAssetRegistry({ publicRoot: outDir });
const store = new FileGlbStore([outDir, `${webRoot}/public`]);

let step = 0;
const log: string[] = [];
const say = (s: string) => { log.push(s); console.log(s); };

// Traces every model request and every Blender call; screenshots the scene just before each export.
const model = { ...baseModel, async respond(input: Parameters<typeof baseModel.respond>[0], instructions: string, tools: Parameters<typeof baseModel.respond>[2], signal?: AbortSignal) {
  const t0 = Date.now();
  const reply = await baseModel.respond(input, instructions, tools, signal);
  const calls = reply.output.filter((o) => o.type === "function_call").map((o) => o.type === "function_call" ? `${o.name}(${o.arguments.slice(0, 160).replace(/\s+/g, " ")})` : "");
  say(`  [model ${((Date.now() - t0) / 1000).toFixed(0)}s, ${reply.usage.inputTokens}+${reply.usage.outputTokens} tok] ${calls.join(" ; ") || "(text) " + reply.text.slice(0, 120)}`);
  return reply;
} };
const real = new BlenderMcpClient({ port: Number(process.env.BLENDER_MCP_PORT) || 9876, timeoutMs: 120_000 });
const spy: BlenderPort = {
  runPython: async (code, s) => { const r = await real.runPython(code, s); if (!r.ok) say(`    blender error: ${r.output.split("\n")[0].slice(0, 200)}`); return r; },
  screenshot: (s) => real.screenshot(s),
  importGlb: (g, s) => real.importGlb(g, s),
  reset: (s) => real.reset(s),
  async exportGlb(s) {
    const png = await real.screenshot(s).catch(() => null);
    if (png) { writeFileSync(join(outDir, `shot-${String(++step).padStart(2, "0")}.png`), png); say(`    screenshot saved: shot-${String(step).padStart(2, "0")}.png`); }
    return real.exportGlb(s);
  },
};
if (!(await real.ping())) { console.error("Blender MCP is not answering. Start Blender with the addon (or the headless server) first."); process.exit(2); }

const r = (category: string, description: string, dims: [number, number, number], extra: Partial<AssetRequest> = {}) => AssetRequest.parse({ schemaVersion: 1, category, description, targetDimensionsM: dims, ...extra });
const CASES: Record<string, AssetRequest> = {
  "bed-queen": r("bed", "queen bed with a simple wooden frame and a headboard", [1.6, 1.0, 2.1], { colors: ["walnut"] }),
  "credenza-sliding": r("credenza", "mid-century walnut credenza with sliding doors on tapered legs", [2.2, 0.8, 0.5], { styles: ["mid-century"], colors: ["walnut"] }),
  "sofa-red": r("sofa", "red velvet sofa", [2.3, 0.9, 0.95], { colors: ["red"] }),
  "floor-lamp": r("floor_lamp", "arc floor lamp with a round base", [0.5, 1.8, 0.5]),
};

const service = new RenderService({
  catalog: async () => [...bundled, ...(await registry.list())], registry, store, model,
  blender: new BlenderPool([spy]),
  limits: { maxRounds: 30, maxToolCalls: 60, maxSubmissions: 3, maxCodeRuns: 30 },
});

for (const [id, request] of Object.entries(CASES)) {
  if (only.length && !only.includes(id)) continue;
  say(`\n=== ${id}: ${request.description} (${request.targetDimensionsM.join(" x ")} m)`);
  const t0 = Date.now();
  const out = await service.resolve(request);
  say(`  => ${out.source}${out.asset ? ` "${out.asset.title}" ${out.asset.id}` : ""} in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${out.usage.modelRequests} model requests, ${out.usage.inputTokens}+${out.usage.outputTokens} tokens`);
  for (const n of out.notes) say(`     note: ${n}`);
  if (out.asset && (out.source === "generated" || out.source === "modified")) {
    const info = inspectGlb(new Uint8Array(readFileSync(join(outDir, out.asset.glbStorageKey))));
    say(`     GLB: ${info.size.map((n) => n.toFixed(2)).join(" x ")} m, ${info.triangleCount} triangles, materials [${info.materialNames.join(", ")}], ${(info.fileBytes / 1024).toFixed(0)} KB${out.derivedFromAssetId ? `, derived from ${out.derivedFromAssetId}` : ""}`);
  }
}
writeFileSync(join(outDir, "trace.log"), log.join("\n"));
