import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { catalog } from "@house/contracts";
import {
  PlannerSession,
  type PlannerInput,
  type LoopState,
} from "@house/aesthetic-planner";
import { createPlannerModel } from "./model";
import { demoRender } from "./demo";

const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  if (!process.env.PLANNER_ENV_FILE) throw new Error("Set PLANNER_ENV_FILE.");
  process.loadEnvFile(process.env.PLANNER_ENV_FILE);
  const provider = createPlannerModel({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: "https://api.deepseek.com",
    textModel: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    visionModel: "deepseek-flash",
  });
  let calls = 0;
  const model: typeof provider = {
    async complete(request, signal) {
      let raw: unknown;
      try {
        raw =
          request.task === "plan" && process.env.PLANNER_REPLAY_PLAN_FILE
            ? await readFile(process.env.PLANNER_REPLAY_PLAN_FILE, "utf8")
            : await provider.complete(request, signal);
      } catch (error) {
        console.log(
          JSON.stringify({
            task: request.task,
            providerError: error instanceof Error ? error.message : "Failed",
          }),
        );
        throw error;
      }
      await writeFile(
        `test-results/live-model-${++calls}-${request.task}.json`,
        typeof raw === "string" ? raw : JSON.stringify(raw),
      );
      return raw;
    },
  };
  let session: PlannerSession;
  let final: LoopState | undefined;
  const states: LoopState[] = [];
  const started = Date.now();
  // This opt-in provider evaluation deliberately substitutes fixture model sourcing.
  await page.route("**/planner-api/readiness", async (route) => {
    await route.fulfill({
      json: {
        liveReady: true,
        aiConfigured: true,
        renderStatus: "ready",
        catalogCount: catalog.length,
        catalogSource: "bundled",
        message: "Developer evaluation: fixture-only model sourcing.",
      },
    });
  });
  await page.route("**/planner-api/sessions", async (route) => {
    try {
      const input = route.request().postDataJSON() as PlannerInput;
      session = new PlannerSession(input, {
        model,
        render: demoRender,
        assets: catalog,
        uuid: randomUUID,
      });
      final = await session.start();
      states.push(final);
      await route.fulfill({ json: { id: "provider-evaluation", ...final } });
    } catch (error) {
      console.log(
        JSON.stringify({
          startError: error instanceof Error ? error.message : "Failed",
        }),
      );
      await route.fulfill({
        status: 400,
        json: { error: error instanceof Error ? error.message : "Failed" },
      });
    }
  });
  await page.route("**/planner-api/sessions/*/observe", async (route) => {
    const request = route.request().postDataJSON();
    final = await session.observe(request.candidateId, request.views);
    states.push(final);
    await writeFile(
      "test-results/live-evaluation.json",
      JSON.stringify(
        {
          seconds: (Date.now() - started) / 1000,
          limitation:
            "Real Pro/Flash models and actual sandbox captures; fixture-only scripted model sourcing, no Supabase requests.",
          states,
        },
        null,
        2,
      ),
    );
    await route.fulfill({ json: { id: "provider-evaluation", ...final } });
  });
  await page.goto("http://127.0.0.1:5191/?planner-lab");
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run design experiment" }).click();
  await expect(page.getByRole("status")).not.toHaveText(
    "Ready to test the design loop.",
  );
  await expect(
    page.getByRole("button", { name: "Run design experiment" }),
  ).toBeEnabled({ timeout: 210_000 });
  await page.screenshot({
    path: "test-results/planner-live.png",
    fullPage: true,
  });
  expect(final?.history.length).toBeGreaterThanOrEqual(1);
  expect(final?.done).toBe(true);
  await page.screenshot({
    path: "test-results/planner-live.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      seconds: (Date.now() - started) / 1000,
      reviews: final?.history.length,
      repairs: final?.repairs,
      messages: final?.messages,
      report: "test-results/live-evaluation.json",
    }),
  );
} finally {
  await browser.close();
}
