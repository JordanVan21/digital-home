import { describe, expect, it } from "vitest";
import {
  assetById,
  catalog,
  createFixtureScene,
  SceneObjectSchema,
  SceneOpSchema,
} from "@house/contracts";
import { applyOp, invertOp } from "./operations";
import { roomShell } from "@house/contracts";
describe("lamp state", () => {
  it("retains imported light metadata and typed on/off state", () => {
    const lamp = catalog.find((a) => a.title === "Arc floor lamp")!;
    expect(lamp.light?.position).toEqual([0, 0.76, 0.318]);
    const object = createFixtureScene().objects.find(
      (o) => o.category === "lamp",
    )!;
    expect(SceneObjectSchema.parse({ ...object, lightOn: false }).lightOn).toBe(
      false,
    );
    expect(
      SceneOpSchema.safeParse({
        type: "setLight",
        objectId: object.id,
        lightOn: false,
      }).success,
    ).toBe(true);
  });
  it("changes only the light, round-trips absence, and respects locks", () => {
    const scene = createFixtureScene(),
      lamp = scene.objects.find((o) => o.category === "lamp")!,
      ctx = { room: roomShell, assets: assetById },
      op = { type: "setLight", objectId: lamp.id, lightOn: false } as never;
    const r = applyOp(scene, op, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.objects.find((o) => o.id === lamp.id)?.lightOn).toBe(false);
    expect(r.scene.objects.map((o) => o.transform)).toEqual(
      scene.objects.map((o) => o.transform),
    );
    const inverse = invertOp(scene, op);
    if (inverse.type === "checkpoint") throw Error("expected a typed inverse");
    const restored = applyOp(r.scene, inverse, ctx);
    expect(restored.ok && restored.scene.objects).toEqual(scene.objects);
    lamp.locked = true;
    expect(applyOp(scene, op, ctx)).toMatchObject({
      ok: false,
      error: { code: "OBJECT_LOCKED" },
    });
  });
});
