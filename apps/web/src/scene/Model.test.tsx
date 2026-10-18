// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
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
it.each([
  [{ x: 1, z: 0 }, [0.4, 0.1, 0.3]],
  [{ x: 0, z: 1 }, [0.3, 0.4, 0.1]],
  [{ x: 1, z: 1 }, [0.1, 0.4, 0.3]],
] as const)(
  "renders tilt %j at the tilted size, resting on y = 0",
  async (tilt, size) => {
    const scene = new Group();
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    loader.scene = scene;
    const object = {
      ...createFixtureScene().objects.find((o) => o.id === fixtureId(100))!,
      dimensionsM: [0.4, 0.3, 0.1] as [number, number, number],
      tilt,
    };
    const renderer = await ReactThreeTestRenderer.create(
      <Model object={object} />,
    );
    try {
      const root = renderer.scene.instance;
      root.updateMatrixWorld(true);
      const box = new Box3().setFromObject(root);
      const got = box.getSize(new Vector3()).toArray();
      got.forEach((v, i) => expect(v).toBeCloseTo(size[i], 6));
      expect(box.min.y).toBeCloseTo(0, 6);
      expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 6);
      expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 6);
    } finally {
      await renderer.unmount();
    }
  },
);

it("switches owned bulb emissive materials without changing the cached source", async () => {
  const scene = new Group(),
    material = new MeshStandardMaterial({
      emissive: "#ffffff",
      emissiveIntensity: 1,
    });
  material.name = "shade";
  scene.add(new Mesh(new BoxGeometry(), material));
  loader.scene = scene;
  const object = {
    ...createFixtureScene().objects.find((o) => o.category === "lamp")!,
    lightOn: false,
  };
  const renderer = await ReactThreeTestRenderer.create(
    <Model object={object} />,
  );
  try {
    const mesh = renderer.scene.findAll((n) => n.instance instanceof Mesh)[0]
      .instance as Mesh;
    expect((mesh.material as MeshStandardMaterial).emissiveIntensity).toBe(0);
    await renderer.update(<Model object={{ ...object, lightOn: true }} />);
    expect(
      (mesh.material as MeshStandardMaterial).emissiveIntensity,
    ).toBeGreaterThan(0);
    expect(material.emissiveIntensity).toBe(1);
  } finally {
    await renderer.unmount();
  }
});

it("keeps imported transparent glass clear without opaque shadows or changing cached materials", async () => {
  const scene = new Group(),
    material = new MeshStandardMaterial({
      transparent: true,
      opacity: 1,
      metalness: 1,
    });
  material.name = "picture_glass";
  scene.add(new Mesh(new BoxGeometry(), material));
  loader.scene = scene;
  const object = createFixtureScene().objects.find(
    (o) => o.id === fixtureId(100),
  )!;
  const renderer = await ReactThreeTestRenderer.create(
    <Model object={object} />,
  );
  try {
    const mesh = renderer.scene.findAll((n) => n.instance instanceof Mesh)[0]
      .instance as Mesh;
    const owned = mesh.material as MeshStandardMaterial;
    expect(owned.opacity).toBeLessThanOrEqual(0.12);
    expect(owned.depthWrite).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.metalness).toBe(1);
  } finally {
    await renderer.unmount();
  }
});
