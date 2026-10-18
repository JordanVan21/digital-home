import { describe, expect, it } from "vitest";
import { roomShell, createFixtureScene } from "@house/contracts";
import { cameraPose, selectionBounds } from "./cameraPose";
import { createEditor } from "../state/editor";
describe("camera views", () => {
  it("preserves the familiar Codex starting view", () => {
    expect(cameraPose(roomShell, "iso")).toEqual({
      position: [7.2, 6.5, 8.3],
      target: [0, 0.65, 0],
    });
  });
  it("frames offset rooms and provides top and eye views", () => {
    const room = structuredClone(roomShell);
    room.floor.polygonXZ = room.floor.polygonXZ.map(([x, z]) => [
      x + 50,
      z - 20,
    ]);
    const pose = cameraPose(room, "iso");
    expect(pose.target).toEqual([50, 0.65, -20]);
    expect(pose.position[0]).toBeCloseTo(57.2);
    const top = cameraPose(room, "top");
    expect(top.position[1]).toBeGreaterThan(8);
    const eye = cameraPose(room, "eye");
    expect(eye.position[1]).toBeCloseTo(1.6);
    expect(eye.target[1]).toBeCloseTo(1.6);
  });
  it("frames the rotated volume of the selected piece", () => {
    const s = createFixtureScene(),
      o = s.objects[0];
    o.dimensionsM = [0.4, 1, 0.2];
    o.transform = {
      position: [0, 0, 0],
      rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      scale: [1, 1, 1],
    };
    const bounds = selectionBounds(s, [o.id])!;
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(1);
    expect(selectionBounds(s, [])).toBeUndefined();
  });
  it("requests views and walk mode without editing or touching history", () => {
    const e = createEditor(),
      before = e.working();
    expect(e.requestView("top")).toBe(true);
    expect(e.interaction.getState().planView).toBe(true);
    e.setWalk(true);
    expect(e.interaction.getState().walk).toBe(true);
    expect(e.working()).toBe(before);
    expect(e.hasDraft()).toBe(false);
    expect(e.history.getState().history.undo).toHaveLength(0);
    e.interaction.setState({ dragging: true });
    expect(e.requestView("iso")).toBe(false);
    e.dispose();
  });
});
