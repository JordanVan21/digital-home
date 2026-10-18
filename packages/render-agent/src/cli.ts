import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FileAssetRegistry, FileGlbStore } from "@house/asset-service";
import { AssetRequest, AssetSpec } from "@house/contracts";
import { BlenderMcpClient, BlenderPool } from "./blender";
import { createModel, type AgentModel } from "./model";
import { RenderService } from "./service";

/**
 * Dev runner: pnpm --filter @house/render-agent resolve <requests.json> [--no-blender] [--no-model]
 * requests.json is an array of AssetRequest. Keys come from the environment only
 * (DEEPSEEK_API_KEY or OPENAI_API_KEY; AGENT_PROVIDER selects). Generated assets are
 * written into apps/web/public/models/generated/ and its catalog.json.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: resolve <requests.json> [--no-blender] [--no-model]"); process.exit(2); }

const webRoot = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const fixtures = fileURLToPath(new URL("../../asset-service/fixtures", import.meta.url));
const bundled = (JSON.parse(readFileSync(`${fixtures}/assetCatalog.json`, "utf8")) as unknown[]).map((r) => AssetSpec.parse(r));
const registry = new FileAssetRegistry({ publicRoot: `${webRoot}/public` });

let model: AgentModel | null = null;
if (!args.includes("--no-model")) {
  const provider = process.env.AGENT_PROVIDER === "openai" ? "openai" : "deepseek";
  const apiKey = process.env[provider === "openai" ? "OPENAI_API_KEY" : "DEEPSEEK_API_KEY"];
  if (apiKey) model = createModel({ provider, apiKey, model: process.env[`${provider.toUpperCase()}_MODEL`] || (provider === "openai" ? "gpt-5.4-mini" : "deepseek-v4-pro") });
  else console.warn("No API key in the environment: running retrieval only.");
}
const blender = args.includes("--no-blender") ? null : new BlenderPool([new BlenderMcpClient({ port: Number(process.env.BLENDER_MCP_PORT) || 9876 })]);

const service = new RenderService({ store: new FileGlbStore([`${webRoot}/public`, fixtures]), catalog: async () => [...bundled, ...(await registry.list())], registry, model, blender });
const requests = (JSON.parse(readFileSync(file, "utf8")) as unknown[]).map((r) => AssetRequest.parse({ schemaVersion: 1, ...(r as object) }));
const outcomes = await service.resolveMany(requests, (o) => console.log(`[${o.source}] ${o.request.category}: ${o.asset?.title ?? "placeholder"}`));
console.log(JSON.stringify(outcomes.map((o) => ({ key: o.key, source: o.source, assetId: o.assetId, notes: o.notes, usage: o.usage })), null, 2));
