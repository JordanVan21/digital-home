import { describe, expect, it } from "vitest";
import {
  fixtureId,
  roomShell,
  transformAt,
  type SceneObject,
  type SceneSpec,
} from "@house/contracts";
import { validateObject } from "@house/scene-engine";
import { buildCandidate, checkPlan } from "./candidate";
import { PlannerSession } from "./loop";
import { ModelSourcingError } from "./ports";
import {
  DesignBriefSchema,
  PriceRecordSchema,
  type SemanticDesignPlan,
} from "./schema";
import type { PlannerInput, PlannerModel, RenderPort } from "./ports";

const piece = (n: number, x: number): SceneObject => ({
  id: fixtureId(200 + n),
  assetId: null,
  displayName: `Piece ${n}`,
  category: "chair",
  dimensionsM: [0.5, 0.8, 0.5],
  transform: transformAt(x, 0),
  locked: false,
  source: "user",
});
const scene: SceneSpec = {
  schemaVersion: 1,
  id: fixtureId(300),
  roomId: fixtureId(4),
  shellId: roomShell.id,
  revision: 0,
  objects: [piece(1, -1), piece(2, 0), piece(3, 1)],
  lightingPreset: "daylight",
  updatedAt: "2026-10-18T00:00:00.000Z",
};
export const testInput = (): PlannerInput => ({
  scene: structuredClone(scene),
  shell: structuredClone(roomShell),
  brief: DesignBriefSchema.parse({
    schemaVersion: 1,
    roomId: scene.roomId,
    styleTags: ["Japandi"],
    palette: ["warm white"],
    preferredMaterials: ["oak"],
    forms: ["simple"],
    avoid: [],
    priorities: ["calm"],
    mustKeepObjectIds: [],
    lightingMood: ["soft"],
    householdNeeds: [],
    freeText: "Cozy Japanese–Scandinavian living room",
  }),
});
const planFor = (input: PlannerInput): SemanticDesignPlan => ({
  schemaVersion: 1,
  roomId: scene.roomId,
  rationale: "A calm conversation area",
  items: input.scene.objects.map((o, i) => ({
    key: `piece-${i}`,
    action: "keep",
    objectId: o.id,
    description: o.displayName,
    desiredStyleTags: [],
    colors: [],
    materials: [],
    placementIntent: { zone: "original" },
  })),
});
const render: RenderPort = {
  async resolve() {
    return { asset: null, source: "placeholder", notes: ["Test placeholder"] };
  },
};
let serial = 500;
const uuid = () => fixtureId(serial++);
const signal = () => AbortSignal.timeout(20_000);

describe("proposal protections and shared rules", () => {
  it("keeps an approved closest match as a real model and labels the compromise", async () => {
    const { catalog } = await import("@house/contracts");
    const input = testInput(),
      plan = planFor(input);
    plan.items[0] = {
      ...plan.items[0],
      action: "replace",
      desiredCategory: "chair",
      description: "Oak chair",
      maxDimensionsM: [0.6, 0.6, 0.6],
    };
    const asset = {
      ...catalog[0],
      id: fixtureId(8000),
      category: "chair",
      dimensionsM: [1, 1, 1] as [number, number, number],
      mount: "floor" as const,
    };
    const port: RenderPort = {
      async resolve() {
        return { asset, source: "best_effort", notes: [] };
      },
    };
    const result = await buildCandidate(plan, input, port, [], signal(), uuid);
    expect(
      result.scene.objects.find(
        (o) => o.replacesObjectId === input.scene.objects[0].id,
      )?.assetId,
    ).toBe(asset.id);
    expect(result.items[0].method).toBe("retrieved");
    expect(result.items[0].matchQuality).toBe("closest_available");
    expect(result.items[0].notes.join()).toContain("compromise");
  });
  it("records infrastructure failure separately from a missing catalog match", async () => {
    const input = testInput(),
      plan = planFor(input);
    plan.items[0] = {
      ...plan.items[0],
      action: "replace",
      desiredCategory: "chair",
      description: "Oak chair",
      maxDimensionsM: [0.4, 0.7, 0.4],
    };
    const port: RenderPort = {
      async resolve() {
        throw new ModelSourcingError(
          "queue_missing",
          "Furniture requests are not connected.",
        );
      },
    };
    const result = await buildCandidate(plan, input, port, [], signal(), uuid);
    expect(result.items[0].placeholderReason).toBe("queue_missing");
    expect(result.items[0].notes).toContain(
      "Furniture requests are not connected.",
    );
    expect(result.items[0].price.estimatedUnitCost).toBeNull();
  });
  it("locks override hostile planner output without changing the original", async () => {
    const input = testInput();
    input.scene.objects[0].locked = true;
    input.scene.objects[0].renovationDecision = "remove";
    const before = structuredClone(input),
      plan = planFor(input);
    plan.items[0].action = "remove";
    const result = await buildCandidate(
      plan,
      input,
      render,
      [],
      signal(),
      uuid,
    );
    expect(
      result.scene.objects.find((o) => o.id === input.scene.objects[0].id),
    ).toEqual(input.scene.objects[0]);
    expect(result.operations).toEqual([]);
    expect(result.warnings.join()).toContain("Lock overrides");
    expect(input).toEqual(before);
  });
  it("Keep permits moving but refuses replacement and appearance changes", async () => {
    const input = testInput();
    input.scene.objects[0].renovationDecision = "keep";
    const plan = planFor(input);
    plan.items[0].action = "replace";
    expect(() => checkPlan(plan, input)).toThrow("must be kept");
    plan.items[0].action = "move";
    plan.items[0].placementIntent = { zone: "center" };
    const result = await buildCandidate(
      plan,
      input,
      render,
      [],
      signal(),
      uuid,
    );
    const moved = result.scene.objects.find(
      (o) => o.id === input.scene.objects[0].id,
    )!;
    expect(moved.transform).not.toEqual(input.scene.objects[0].transform);
    expect({
      ...moved,
      transform: input.scene.objects[0].transform,
      placement: input.scene.objects[0].placement,
    }).toEqual(input.scene.objects[0]);
  });
  it("enforces Remove and Replace as instructions, with new physical identity and null unknown prices", async () => {
    const input = testInput();
    input.scene.objects[0].renovationDecision = "remove";
    input.scene.objects[1].renovationDecision = "replace";
    const plan = planFor(input);
    expect(() => checkPlan(plan, input)).toThrow("must be removed");
    plan.items[0].action = "remove";
    plan.items[1] = {
      ...plan.items[1],
      action: "replace",
      desiredCategory: "chair",
      maxDimensionsM: [0.5, 0.8, 0.5],
      placementIntent: { zone: "center" },
    };
    const result = await buildCandidate(
      plan,
      input,
      render,
      [],
      signal(),
      uuid,
    );
    const replacement = result.scene.objects.find(
      (o) => o.replacesObjectId === input.scene.objects[1].id,
    )!;
    expect(replacement.id).not.toBe(input.scene.objects[1].id);
    expect(
      result.operations.some((o) => o.type === "replacePhysicalItem"),
    ).toBe(true);
    expect(result.items[1].price).toEqual({
      estimatedUnitCost: null,
      priceStatus: "unknown",
    });
    expect(
      PriceRecordSchema.safeParse({
        priceStatus: "unknown",
        estimatedUnitCost: { currency: "USD", minor: 0 },
      }).success,
    ).toBe(false);
    expect(result.scene.shellId).toBe(input.scene.shellId);
    expect(input.shell).toEqual(roomShell);
    for (const o of result.scene.objects)
      expect(
        validateObject(result.scene, o, {
          room: input.shell,
          roomId: scene.roomId,
          assets: {},
        }).ok,
      ).toBe(true);
  });
  it("rejects invented IDs, missing items, coordinates and impossible mandatory replacements", async () => {
    const input = testInput(),
      plan = planFor(input);
    expect(() =>
      checkPlan({ ...plan, items: plan.items.slice(1) }, input),
    ).toThrow("omitted");
    expect(() =>
      checkPlan(
        {
          ...plan,
          items: [
            { ...plan.items[0], objectId: fixtureId(999) },
            ...plan.items.slice(1),
          ],
        },
        input,
      ),
    ).toThrow("real ID");
    expect(() => checkPlan({ ...plan, coordinates: [1, 2] }, input)).toThrow();
    plan.items[0] = {
      ...plan.items[0],
      action: "replace",
      desiredCategory: "sofa",
      maxDimensionsM: [12, 8, 12],
      placementIntent: { zone: "center" },
    };
    await expect(
      buildCandidate(plan, input, render, [], signal(), uuid),
    ).rejects.toThrow("could not fit");
  });
});

describe("bounded visual feedback loop", () => {
  it("orders forward anchors, preserves Keep identity during movement, and rejects cycles", () => {
    const input = testInput(),
      plan = planFor(input);
    plan.items[0].placementIntent = {
      zone: "near",
      anchorKey: "piece-2",
      relation: "beside",
    };
    const checked = checkPlan(plan, input);
    expect(checked.items.map((i) => i.key)).toEqual([
      "piece-2",
      "piece-0",
      "piece-1",
    ]);
    expect(checked.items[1].action).toBe("move");
    plan.items[2].placementIntent = { zone: "near", anchorKey: "piece-0" };
    expect(() => checkPlan(plan, input)).toThrow("cycle");
  });

  it("allows original-position replacement and reports optional additions that cannot fit", async () => {
    const input = testInput(),
      plan = planFor(input);
    plan.items[0] = {
      ...plan.items[0],
      action: "replace",
      desiredCategory: "chair",
      description: "Small oak chair",
      maxDimensionsM: [0.45, 0.7, 0.45],
    };
    plan.items.push({
      key: "oversize-decor",
      action: "add",
      desiredCategory: "decor",
      description: "Oversized sculpture",
      desiredStyleTags: [],
      colors: [],
      materials: [],
      maxDimensionsM: [12, 8, 12],
      placementIntent: { zone: "center" },
    });
    const candidate = await buildCandidate(
      plan,
      input,
      render,
      [],
      signal(),
      uuid,
    );
    expect(
      candidate.scene.objects.find(
        (o) => o.replacesObjectId === input.scene.objects[0].id,
      )?.transform.position,
    ).toEqual(input.scene.objects[0].transform.position);
    expect(
      candidate.items.find((i) => i.key === "oversize-decor")?.placement,
    ).toBe("dropped");
    expect(candidate.operations).toHaveLength(1);
    expect(candidate.warnings.join()).toContain("could not fit");
  });

  it("places tabletop decor using actual shared support geometry", async () => {
    const input = testInput();
    input.scene.objects[0].dimensionsM = [1, 0.8, 1];
    input.scene.objects = [input.scene.objects[0]];
    const plan = planFor(input);
    plan.items.push({
      key: "vase",
      action: "add",
      desiredCategory: "decor",
      description: "Small ceramic vase",
      desiredStyleTags: [],
      colors: [],
      materials: [],
      maxDimensionsM: [0.15, 0.2, 0.15],
      placementIntent: { zone: "on", anchorKey: "piece-0" },
    });
    const candidate = await buildCandidate(
      plan,
      input,
      render,
      [],
      signal(),
      uuid,
    );
    const vase = candidate.scene.objects.find((o) => o.source === "agent")!;
    expect(vase.placement?.parentId).toBe(input.scene.objects[0].id);
    expect(vase.transform.position[1]).toBeCloseTo(0.8);
    expect(
      validateObject(candidate.scene, vase, {
        room: input.shell,
        roomId: input.scene.roomId,
        assets: {},
      }).ok,
    ).toBe(true);
  });

  it("sends the rejected output and validation feedback on retry without transport-only fields", async () => {
    const input = testInput(),
      requests: unknown[] = [];
    const bad = { ...planFor(input), items: [] };
    const model: PlannerModel = {
      async complete(request) {
        requests.push(request.data);
        return requests.length === 1 ? bad : planFor(input);
      },
    };
    const session = new PlannerSession(
      { ...input, transportAssets: "must not reach model" } as PlannerInput,
      { model, render, assets: [], uuid },
    );
    await session.start();
    expect(requests[0]).not.toHaveProperty("transportAssets");
    expect(requests[1]).toMatchObject({
      previousOutput: bad,
      validationErrors: "Plan omitted existing furniture.",
    });
  });

  it("requires fresh actual views, repairs at most twice, and preserves a better candidate", async () => {
    const input = testInput();
    let calls = 0;
    const plan = planFor(input);
    const model: PlannerModel = {
      async complete(request) {
        calls++;
        if (request.task === "plan") return plan;
        return {
          verdict: "repair",
          scores: { style: calls === 2 ? 5 : 1, composition: 3, usability: 3 },
          findings: [],
          revisedPlan: plan,
        };
      },
    };
    const session = new PlannerSession(input, {
      model,
      render,
      assets: [],
      uuid,
      maxRepairs: 2,
    });
    let state = await session.start();
    const originalId = state.candidate.id;
    const views = ["top", "angle-a", "angle-b"].map((name) => ({
      name,
      image: "data:image/jpeg;base64,/9j/AA==",
      unavailableObjectIds: [],
    }));
    await expect(session.observe("wrong-candidate", views)).rejects.toThrow(
      "different candidate",
    );
    for (let round = 0; round < 3; round++)
      state = await session.observe(state.candidate.id, views);
    expect(state.done).toBe(true);
    expect(state.candidate.id).toBe(originalId);
    expect(state.repairs).toBe(2);
    expect(calls).toBe(4);
    expect(input).toEqual(testInput());
  });
  it("retries invalid model JSON once then reports a recoverable failure", async () => {
    let calls = 0;
    const model: PlannerModel = {
      async complete() {
        calls++;
        return "not JSON";
      },
    };
    const session = new PlannerSession(testInput(), {
      model,
      render,
      assets: [],
      uuid,
    });
    await expect(session.start()).rejects.toThrow("valid design");
    expect(calls).toBe(2);
  });
});
