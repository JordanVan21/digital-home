import { expect, it } from "vitest";
import { assetById, createFixtureScene, fixtureId } from "@house/contracts";
import { lightBudget } from "./lightBudget";
it("limits active practical lights and their shadows, excluding switched-off pieces", () => {
  const scene = createFixtureScene(),
    lamp = scene.objects.find((o) => o.category === "lamp")!;
  scene.objects = Array.from({ length: 20 }, (_, i) => ({
    ...lamp,
    id: fixtureId(980 + i),
    lightOn: i !== 0,
  }));
  const budget = lightBudget(scene, assetById);
  expect(budget.active.size).toBe(8);
  expect(budget.shadows.size).toBe(1);
  expect(budget.active.has(scene.objects[0].id)).toBe(false);
  expect([...budget.shadows].every((id) => budget.active.has(id))).toBe(true);
});
