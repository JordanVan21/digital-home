// Manual provider check using a public fixture and real three-view browser captures.
// This never writes to Supabase or pretends to exercise live model sourcing.
import process from "node:process";
import { readFile, writeFile } from "node:fs/promises";
import { createFixtureScene, roomShell, catalog } from "@house/contracts";
import {
  checkPlan,
  DesignBriefSchema,
  ViewsSchema,
} from "@house/aesthetic-planner";
import { PLAN_INSTRUCTIONS } from "../../../packages/aesthetic-planner/src/prompts";
import { createPlannerModel } from "./model";

if (!process.env.PLANNER_ENV_FILE)
  throw new Error("Set PLANNER_ENV_FILE to the private .env path.");
process.loadEnvFile(process.env.PLANNER_ENV_FILE);
const model = createPlannerModel({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseUrl: process.env.PLANNER_BASE_URL ?? "https://api.deepseek.com",
  textModel:
    process.env.PLANNER_TEXT_MODEL ??
    process.env.DEEPSEEK_MODEL ??
    "deepseek-v4-pro",
  visionModel: process.env.PLANNER_VISION_MODEL ?? "deepseek-flash",
});
const observations = JSON.parse(
  await readFile("test-results/planner-observations.json", "utf8"),
);
const views = ViewsSchema.parse(observations[0].views);
const scene = createFixtureScene();
const brief = DesignBriefSchema.parse({
  schemaVersion: 1,
  roomId: scene.roomId,
  styleTags: ["Japanese–Scandinavian", "cozy"],
  palette: ["warm white", "sand"],
  preferredMaterials: ["pale wood", "linen"],
  forms: ["simple", "low"],
  avoid: ["clutter"],
  priorities: ["comfortable seating", "clear routes"],
  mustKeepObjectIds: [],
  lightingMood: ["soft"],
  householdNeeds: ["Preserve living-room function"],
  freeText: "Cozy Japanese–Scandinavian living room",
});
const input = { scene, shell: roomShell, brief };
const t0 = Date.now();
const raw = await model.complete(
  {
    task: "plan",
    instructions: PLAN_INSTRUCTIONS,
    data: {
      ...input,
      catalogAffordances: catalog.map((a) => ({
        category: a.category,
        dimensionsM: a.dimensionsM,
        styles: a.styles,
      })),
    },
    views: [],
  },
  AbortSignal.timeout(90_000),
);
await writeFile(
  "test-results/pro-plan-raw.json",
  typeof raw === "string" ? raw : JSON.stringify(raw),
);
const plan = checkPlan(typeof raw === "string" ? JSON.parse(raw) : raw, input);
const planSeconds = (Date.now() - t0) / 1000;
const t1 = Date.now();
const rawVision = await model.complete(
  {
    task: "review",
    instructions:
      "Describe the visible palette and likely materials in these actual room views. Return JSON only: {palette:string[],materials:string[],limitations:string[]}. Placeholder appearance is unknown. Do not merely repeat requested style names.",
    data: {
      note: "Public fixture screenshot; assess visible appearance, not any requested redesign.",
    },
    views,
  },
  AbortSignal.timeout(90_000),
);
const vision =
  typeof rawVision === "string" ? JSON.parse(rawVision) : rawVision;
const report = {
  planSeconds,
  visionSeconds: (Date.now() - t1) / 1000,
  plan,
  vision,
  limitation:
    "Provider smoke check only: real model calls and fixture screenshots. Live render-worker requests require the user's signed-in session and are not tested here.",
};
await writeFile(
  "test-results/provider-smoke.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    planSeconds: report.planSeconds,
    visionSeconds: report.visionSeconds,
    plannedItems: plan.items.length,
    vision,
    report: "test-results/provider-smoke.json",
  }),
);
