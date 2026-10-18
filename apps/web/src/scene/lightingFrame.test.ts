import { describe, expect, it } from "vitest";
import { roomShell, test2Fixture } from "@house/contracts";
import { lightingFrame } from "./lightingFrame";
import { nextPreset, presetFor } from "../theme";
describe("room lighting", () => {
  it("offers daylight, golden hour and evening without falling back", () => {
    expect(presetFor("evening").id).toBe("evening");
    expect(nextPreset("daylight").id).toBe("evening");
    expect(nextPreset("golden-hour").id).toBe("daylight");
    expect(nextPreset("evening").id).toBe("golden-hour");
  });
  it("fits the sun and shadows to an offset room instead of the world origin", () => {
    const shell = structuredClone(roomShell);
    shell.floor.polygonXZ = shell.floor.polygonXZ.map(([x, z]) => [
      x + 100,
      z - 70,
    ]);
    for (const w of shell.walls) {
      w.fromXZ = [w.fromXZ[0] + 100, w.fromXZ[1] - 70];
      w.toXZ = [w.toXZ[0] + 100, w.toXZ[1] - 70];
    }
    const original = lightingFrame(roomShell, 20),
      shifted = lightingFrame(shell, 20);
    expect(shifted.position[0] - original.position[0]).toBeCloseTo(100);
    expect(shifted.position[2] - original.position[2]).toBeCloseTo(-70);
    expect(shifted.radius).toBeCloseTo(original.radius);
  });
  it("puts the golden sun outside the largest glazed opening", () => {
    const frame = lightingFrame(test2Fixture.shell, 20);
    expect(frame.position.every(Number.isFinite)).toBe(true);
    expect(frame.radius).toBeGreaterThan(3);
    expect(frame.position[1]).toBeCloseTo(12 * Math.sin((20 * Math.PI) / 180));
    const glazed = test2Fixture.shell.openings
      .filter((o) => o.glazing)
      .sort((a, b) => b.widthM - a.widthM)[0];
    expect(frame.openingId).toBe(glazed.id);
  });
});
