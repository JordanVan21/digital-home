import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { supportsMeshPicking } from "./modelShape";

describe("renderer shape geometry", () => {
  it("keeps box fallback for alpha-masked and transparent model cards", () => {
    for (const material of [
      new MeshStandardMaterial({ alphaTest: 0.5 }),
      new MeshStandardMaterial({ transparent: true }),
    ]) {
      const scene = new Group();
      scene.add(new Mesh(new BoxGeometry(), material));
      expect(supportsMeshPicking(scene)).toBe(false);
    }
  });
});
