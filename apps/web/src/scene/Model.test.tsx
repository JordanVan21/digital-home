// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { createFixtureScene, fixtureId } from "@house/contracts";
import { acceleratedRaycast } from "three-mesh-bvh";
import { Model } from "./Model";
const loader = vi.hoisted(() => ({ scene: null as Group | null }));
vi.mock("@react-three/drei", () => ({
  useGLTF: () => ({ scene: loader.scene }),
  Html: () => null,
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
it.each([false, true])(
  "keeps mesh picking without compound outlines (DEV=%s)",
  async (dev) => {
    vi.stubEnv("DEV", dev);
    const scene = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    scene.add(mesh);
    loader.scene = scene;
    const onShape = vi.fn();
    const object = createFixtureScene().objects.find(
      (o) => o.id === fixtureId(100),
    )!;
    const renderer = await ReactThreeTestRenderer.create(
      <Model object={object} onShape={onShape} />,
    );
    try {
      expect(onShape).toHaveBeenCalledWith(true);
      expect(
        renderer.scene.findAllByProps({ name: "shape-outline" }),
      ).toHaveLength(0);
      const picked = renderer.scene.findAll(
        (n) => n.instance instanceof Mesh,
      )[0].instance as Mesh;
      expect(picked.raycast).toBe(acceleratedRaycast);
      expect(picked.geometry.boundsTree).toBeDefined();
      expect(mesh.geometry.boundsTree).toBeUndefined();
    } finally {
      await renderer.unmount();
    }
  },
);
