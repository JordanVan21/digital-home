// @vitest-environment jsdom
import { expect, it } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group, LineSegments, Raycaster } from "three";
import { assetById, createFixtureScene, fixtureId } from "@house/contracts";
import { colliderBlocks } from "@house/scene-engine";
import { CollisionOutline } from "./CollisionOutline";
import { compoundExteriorPositions } from "./compoundOutline";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
it("draws the compound exterior under the current furniture transform without mutating cached geometry", async () => {
  const object = structuredClone(
    createFixtureScene().objects.find((o) => o.id === fixtureId(102))!,
  );
  object.transform = {
    position: [1, 0.5, -1],
    rotation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
    scale: [1.2, 1.2, 1.2],
  };
  const normalized = compoundExteriorPositions(
    colliderBlocks(object, assetById),
  );
  const before = Array.from(normalized);
  const renderer = await ReactThreeTestRenderer.create(
    <group
      position={object.transform.position}
      quaternion={object.transform.rotation}
      scale={object.transform.scale}
    >
      <CollisionOutline object={object} />
    </group>,
  );
  try {
    const root = renderer.scene.children[0].instance as Group;
    expect(root.position.toArray()).toEqual(object.transform.position);
    expect(root.quaternion.toArray()).toEqual(object.transform.rotation);
    expect(root.scale.toArray()).toEqual(object.transform.scale);
    const lines = renderer.scene.find((n) => n.instance instanceof LineSegments)
      .instance as LineSegments;
    expect(lines.geometry.getAttribute("position").count).toBe(
      normalized.length / 3,
    );
    expect(lines.geometry.getAttribute("position").count).toBeGreaterThan(24);
    expect(Array.from(normalized)).toEqual(before);
    expect(lines.raycast(new Raycaster(), [])).toBeNull();
  } finally {
    await renderer.unmount();
  }
});
