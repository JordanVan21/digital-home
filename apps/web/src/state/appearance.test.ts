import { describe, expect, it } from "vitest";
import { SceneOpSchema, createFixtureScene } from "@house/contracts";
import { createEditor } from "./editor";
import { applyOp, invertOp } from "@house/scene-engine";
describe("room finishes", () => {
  it("uses a typed room appearance operation and rejects malformed paint", () => {
    expect(
      SceneOpSchema.safeParse({
        type: "setAppearance",
        appearance: { wallColor: "#decab0", floorMaterial: "walnut" },
      }).success,
    ).toBe(true);
    expect(
      SceneOpSchema.safeParse({
        type: "setAppearance",
        appearance: { wallColor: "not a colour" },
      }).success,
    ).toBe(false);
  });
  it("previews, undoes, accepts, and reverts room-only suggestions", () => {
    const e = createEditor();
    const before = e.working();
    expect(
      e.suggest({
        type: "setAppearance",
        appearance: { wallColor: "#decab0", floorMaterial: "walnut" },
      } as never),
    ).toBe(true);
    expect(e.working().appearance?.floorMaterial).toBe("walnut");
    expect(e.scene.getState().scene).toBe(before);
    expect(e.changes()).toHaveLength(1);
    e.travel("undo");
    expect(e.working().appearance).toEqual(before.appearance);
    e.travel("redo");
    expect(e.working().appearance?.floorMaterial).toBe("walnut");
    expect(e.accept()).toBe(true);
    expect(e.scene.getState().scene.appearance?.wallColor).toBe("#decab0");
    e.travel("undo");
    expect(e.working().appearance).toEqual(before.appearance);
    e.dispose();
  });
  it("round-trips an appearance op without changing furniture", () => {
    const e = createEditor(),
      scene = createFixtureScene(),
      op = {
        type: "setAppearance",
        appearance: { wallColor: "#aa9988" },
      } as never;
    const r = applyOp(scene, op, e.context());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scene.objects).toEqual(scene.objects);
    const inverse = invertOp(scene, op);
    if (inverse.type === "checkpoint") expect(inverse.scene).toEqual(scene);
    else {
      const restored = applyOp(r.scene, inverse, e.context());
      expect(restored.ok && restored.scene.appearance).toEqual(
        scene.appearance,
      );
    }
    e.dispose();
  });
});
