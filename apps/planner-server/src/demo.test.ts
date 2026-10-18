import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { catalog, createFixtureScene, roomShell } from "@house/contracts";
import {
  buildCandidate,
  type PlannerInput,
  type SemanticDesignPlan,
} from "@house/aesthetic-planner";
import { demoModel, createDemoRender } from "./demo";

it("the catalog demo produces visible physical replacements backed by actual model files", async () => {
  const scene = createFixtureScene();
  const input: PlannerInput = {
    scene,
    shell: roomShell,
    brief: {
      schemaVersion: 1,
      roomId: scene.roomId,
      styleTags: ["minimal"],
      palette: ["cream"],
      preferredMaterials: ["wood"],
      forms: [],
      avoid: [],
      priorities: [],
      mustKeepObjectIds: [],
      lightingMood: [],
      householdNeeds: [],
      freeText: "Cozy room",
    },
  };
  const signal = AbortSignal.timeout(5000);
  const plan = (await demoModel(input).complete(
    { task: "plan", instructions: "", data: {}, views: [] },
    signal,
  )) as SemanticDesignPlan;
  const result = await buildCandidate(
    plan,
    input,
    createDemoRender(
      catalog,
      new Set(scene.objects.flatMap((o) => (o.assetId ? [o.assetId] : []))),
    ),
    catalog,
    signal,
    randomUUID,
  );
  const replacements = result.scene.objects.filter((o) => o.replacesObjectId);
  expect(replacements).toHaveLength(2);
  for (const o of replacements) {
    expect(o.assetId).not.toBeNull();
    expect(o.assetId).not.toBe(
      scene.objects.find((p) => p.id === o.replacesObjectId)?.assetId,
    );
  }
  expect(scene).toEqual(createFixtureScene());
});
