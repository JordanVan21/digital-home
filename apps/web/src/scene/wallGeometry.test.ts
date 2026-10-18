import { describe, expect, it } from "vitest";
import { roomShell } from "@house/contracts";
import { wallFrame, wallPanels, wallVisibility } from "./wallGeometry";
describe("room shell geometry", () => {
  it("keeps cutouts for doors, windows, and doorless openings at the right height", () => {
    const opening = {
      ...roomShell.openings[0],
      offsetM: 1,
      widthM: 2,
      bottomM: 0.5,
      heightM: 1,
    };
    const panels = wallPanels(4, 2.6, [opening]);
    expect(panels).toEqual([
      { s0: 0, s1: 1, y0: 0, y1: 2.6 },
      { s0: 1, s1: 3, y0: 0, y1: 0.5 },
      { s0: 1, s1: 3, y0: 1.5, y1: 2.6 },
      { s0: 3, s1: 4, y0: 0, y1: 2.6 },
    ]);
    expect(
      wallPanels(4, 0.17, [{ ...opening, bottomM: 0, heightM: 2 }]),
    ).toEqual([
      { s0: 0, s1: 1, y0: 0, y1: 0.17 },
      { s0: 3, s1: 4, y0: 0, y1: 0.17 },
    ]);
  });
  it("uses correct outward normals even for walls centred outside the floor", () => {
    const shell = structuredClone(roomShell);
    const wall = shell.walls[0];
    const f = wallFrame(shell, wall);
    expect(Math.hypot(...f.outward)).toBeCloseTo(1);
    // Move the centreline farther outside along its own outward normal.
    wall.fromXZ = wall.fromXZ.map(
      (v, i) => v + (f.outward[i] * wall.thicknessM) / 2,
    ) as [number, number];
    wall.toXZ = wall.toXZ.map(
      (v, i) => v + (f.outward[i] * wall.thicknessM) / 2,
    ) as [number, number];
    expect(wallFrame(shell, wall).outward).toEqual(f.outward);
  });
  it("hides facing walls only in cutaway, fades them in fade, and always shows them in show", () => {
    expect(wallVisibility("cutaway", true)).toBe(0);
    expect(wallVisibility("fade", true)).toBe(0.1);
    expect(wallVisibility("show", true)).toBe(1);
    expect(wallVisibility("cutaway", false)).toBe(1);
  });
});
