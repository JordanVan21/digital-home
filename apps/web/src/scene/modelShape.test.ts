import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { shapeEdges } from "./modelShape";

describe("renderer shape geometry", () => {
  it("caches compound edges without mutating source geometry or transforms", () => {
    const scene = new Group();
    const mesh = new Mesh(
      new BoxGeometry(0.4, 0.4, 0.4),
      new MeshStandardMaterial(),
    );
    mesh.position.set(0.3, 0.2, -0.1);
    scene.add(mesh);
    const positions = Array.from(mesh.geometry.getAttribute("position").array);
    const edges = shapeEdges(scene)!;
    expect(edges.getAttribute("position").count).toBeGreaterThan(0);
    expect(shapeEdges(scene)).toBe(edges);
    expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(
      positions,
    );
    expect(mesh.position.toArray()).toEqual([0.3, 0.2, -0.1]);
    expect(mesh.geometry.boundsTree).toBeUndefined();
  });
  it("keeps box fallback for alpha-masked and transparent model cards", () => {
    for (const material of [
      new MeshStandardMaterial({ alphaTest: 0.5 }),
      new MeshStandardMaterial({ transparent: true }),
    ]) {
      const scene = new Group();
      scene.add(new Mesh(new BoxGeometry(), material));
      expect(shapeEdges(scene)).toBeNull();
    }
  });
});
