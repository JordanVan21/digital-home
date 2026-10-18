import { describe, expect, it } from "vitest";
import { fixtureId } from "@house/contracts";
import { validateObject } from "@house/scene-engine";
import { createEditor } from "./editor";
describe("duplicate", () => {
  it("copies the complete pose and finishes into one nearby valid draft step", () => {
    const e = createEditor();
    e.select(fixtureId(111));
    const original = e.selected()!;
    original.materialOverrides = { "*": { colorHex: "#775544" } };
    const before = structuredClone(e.working());
    expect(e.duplicate()).toBe(true);
    const copy = e.selected()!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.displayName).toContain("copy");
    expect(copy.transform.rotation).toEqual(original.transform.rotation);
    expect(copy.dimensionsM).toEqual(original.dimensionsM);
    expect(copy.materialOverrides).toEqual(original.materialOverrides);
    expect(copy.materialOverrides).not.toBe(original.materialOverrides);
    expect(copy.transform.position).not.toEqual(original.transform.position);
    expect(validateObject(e.working(), copy, e.context())).toEqual({
      ok: true,
    });
    expect(e.scene.getState().scene.objects).toEqual(before.objects);
    expect(e.draft.getState().undo).toHaveLength(1);
    e.travel("undo");
    expect(e.working().objects).toEqual(before.objects);
    e.travel("redo");
    expect(e.working().objects).toHaveLength(before.objects.length + 1);
    expect(e.accept()).toBe(true);
    e.dispose();
  });
  it("does not duplicate a locked piece or interrupt a gesture", () => {
    const e = createEditor(),
      locked = e.working().objects.find((o) => o.locked)!;
    e.select(locked.id);
    expect(e.duplicate()).toBe(false);
    e.select(fixtureId(111));
    e.interaction.setState({ dragging: true });
    expect(e.duplicate()).toBe(false);
    expect(e.hasDraft()).toBe(false);
    e.dispose();
  });
});
