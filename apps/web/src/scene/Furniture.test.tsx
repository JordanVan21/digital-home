// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import {
  BoxGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Ray,
  Vector3,
} from "three";
import { createFixtureScene, fixtureId } from "@house/contracts";
import { createHistory, yawOf, topY } from "@house/scene-engine";
import { editor } from "../state/editor";
import { Furniture } from "./Furniture";
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const model = vi.hoisted(() => ({ renders: 0 }));
vi.mock("./Model", () => ({
  Model: () => {
    model.renders++;
    return <group />;
  },
}));
vi.mock("@react-three/drei", () => ({ Html: () => null }));
let renderer:
  | Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>
  | undefined;
const pointer = (x: number, z: number, clientX = 100) => ({
  button: 0,
  pointerId: 1,
  clientX,
  clientY: 100,
  shiftKey: false,
  ray: new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0)),
  target: {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  },
});
beforeEach(() => {
  editor.scene.setState({ scene: createFixtureScene(), ready: true });
  editor.history.setState({ history: createHistory() });
  editor.discard();
  editor.interaction.setState({
    selectedId: null,
    hoveredId: null,
    dragging: false,
    tool: "move",
    movePlane: "floor",
    heightModifier: false,
    boundingBoxes: false,
    toast: null,
  });
  model.renders = 0;
  vi.spyOn(performance, "now").mockReturnValue(1000);
});
afterEach(async () => {
  await renderer?.unmount();
  renderer = undefined;
  vi.restoreAllMocks();
});
describe("actual canvas gesture adapter (without GPU)", () => {
  it("moves the Three group imperatively without model rerenders or scene commits until release", async () => {
    const object = editor.scene
      .getState()
      .scene.objects.find((o) => o.id === fixtureId(111))!;
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    await renderer.fireEvent(node, "pointerDown", pointer(0.2, 1.75));
    const renders = model.renders;
    for (let i = 1; i <= 30; i++)
      await renderer.fireEvent(
        node,
        "pointerMove",
        pointer(0.2 + i * 0.005, 1.75, 100 + i * 4),
      );
    expect((node.instance as Group).position.x).toBeCloseTo(0.35);
    expect(model.renders).toBe(renders);
    expect(editor.scene.getState().scene.revision).toBe(0);
    expect(editor.history.getState().history.undo).toHaveLength(0);
    await renderer.fireEvent(node, "pointerUp", pointer(0.35, 1.75, 220));
    expect(
      editor.working().objects.find((o) => o.id === fixtureId(111))?.transform
        .position[0],
    ).toBeCloseTo(0.35);
    expect(editor.scene.getState().scene.revision).toBe(0);
    expect(editor.draft.getState().undo).toHaveLength(1);
    expect(editor.interaction.getState().dragging).toBe(false);
  });
  it("invalid drops stay where they land as red, conflicted suggestions", async () => {
    editor.interaction.setState({ boundingBoxes: true });
    const object = editor.scene
      .getState()
      .scene.objects.find((o) => o.id === fixtureId(111))!;
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    await renderer.fireEvent(node, "pointerDown", pointer(0.2, 1.75));
    await renderer.fireEvent(node, "pointerMove", pointer(8, 1.75, 400));
    expect((node.instance as Group).position.x).toBe(8);
    await renderer.advanceFrames(1, 0.016);
    const edges = node.instance.children[2].children.find(
      (o) => o instanceof LineSegments,
    ) as LineSegments;
    expect((edges.material as LineBasicMaterial).color.getHexString()).toBe(
      "e36856",
    );
    await renderer.fireEvent(node, "pointerUp", pointer(8, 1.75, 400));
    await renderer.advanceFrames(50, 0.016);
    expect((node.instance as Group).position.x).toBeCloseTo(8, 3);
    expect(editor.scene.getState().scene.revision).toBe(0);
    expect(editor.draft.getState().conflicts[fixtureId(111)]).toContain(
      "inside",
    );
    expect((edges.material as LineBasicMaterial).color.getHexString()).toBe(
      "e36856",
    );
    await act(async () => editor.discard());
    await renderer.advanceFrames(80, 0.016);
    expect((node.instance as Group).position.x).toBeCloseTo(0.2, 3);
  });
  it("locked pieces reject pointer manipulation", async () => {
    const object = editor.scene.getState().scene.objects.find((o) => o.locked)!;
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    await renderer.fireEvent(
      node,
      "pointerDown",
      pointer(
        ...([object.transform.position[0], object.transform.position[2]] as [
          number,
          number,
        ]),
      ),
    );
    await renderer.fireEvent(node, "pointerMove", pointer(0, 0, 300));
    expect((node.instance as Group).position.toArray()).toEqual(
      object.transform.position,
    );
    expect(editor.interaction.getState().dragging).toBe(false);
    expect(editor.interaction.getState().toast).toContain("locked");
  });
  it.each([false, true])(
    "swivels imperatively, then records exactly one draft step (snap=%s)",
    async (snap) => {
      const object = editor
        .working()
        .objects.find((o) => o.id === fixtureId(111))!;
      editor.select(object.id);
      editor.interaction.setState({ tool: "rotate" });
      renderer = await ReactThreeTestRenderer.create(
        <Furniture object={object} />,
      );
      const node = renderer.scene.children[0];
      const ring = node.findByProps({ name: "swivel-area" });
      const [x, , z] = object.transform.position;
      await renderer.fireEvent(ring, "pointerDown", pointer(x, z + 0.2));
      const renders = model.renders;
      const angle = 0.38;
      for (let i = 1; i <= 20; i++) {
        const a = (angle * i) / 20;
        await renderer.fireEvent(ring, "pointerMove", {
          ...pointer(x + Math.sin(a) * 0.2, z + Math.cos(a) * 0.2),
          shiftKey: snap,
        });
      }
      const expected = snap ? Math.PI / 12 : angle;
      expect(yawOf((node.instance as Group).quaternion.toArray())).toBeCloseTo(
        expected,
      );
      expect(model.renders).toBe(renders);
      expect(editor.draft.getState().undo).toHaveLength(0);
      expect(editor.scene.getState().scene.revision).toBe(0);
      await renderer.fireEvent(ring, "pointerUp", pointer(x, z + 0.2));
      expect(editor.draft.getState().undo).toHaveLength(1);
      expect(
        yawOf(
          editor.working().objects.find((o) => o.id === object.id)!.transform
            .rotation,
        ),
      ).toBeCloseTo(expected);
      expect(editor.interaction.getState().dragging).toBe(false);
      expect(editor.history.getState().history.undo).toHaveLength(0);
    },
  );
  it("shows no swivel area for locked pieces or in Move mode", async () => {
    const object = editor.working().objects.find((o) => o.locked)!;
    editor.select(object.id);
    editor.interaction.setState({ tool: "rotate" });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    expect(renderer.scene.findAllByProps({ name: "swivel-area" })).toHaveLength(
      0,
    );
    const unlocked = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    await act(async () => {
      editor.select(unlocked.id);
      editor.interaction.setState({ tool: "move" });
    });
    await renderer.update(<Furniture object={unlocked} />);
    expect(renderer.scene.findAllByProps({ name: "swivel-area" })).toHaveLength(
      0,
    );
  });

  it("rotates through the furniture hitbox in Rotate mode instead of moving or stepping on click", async () => {
    const object = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    editor.interaction.setState({ tool: "rotate" });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    const [x, , z] = object.transform.position;
    await renderer.fireEvent(node, "pointerDown", pointer(x, z + 0.1));
    expect(editor.draft.getState().undo).toHaveLength(0);
    await renderer.fireEvent(node, "pointerMove", pointer(x + 0.1, z));
    await renderer.fireEvent(node, "pointerUp", pointer(x + 0.1, z));
    expect(
      editor.working().objects.find((o) => o.id === object.id)!.transform
        .position,
    ).toEqual(object.transform.position);
    expect(editor.draft.getState().undo).toHaveLength(1);
  });
  it.each([false, true])(
    "height drags preserve XZ, stay imperative and create one suggestion (snap=%s)",
    async (snap) => {
      const object = editor
        .working()
        .objects.find((o) => o.id === fixtureId(111))!;
      editor.interaction.setState({ tool: "move", movePlane: "height" });
      renderer = await ReactThreeTestRenderer.create(
        <Furniture object={object} />,
      );
      const node = renderer.scene.children[0];
      const [x, , z] = object.transform.position;
      const verticalPointer = (y: number, clientX = 100) => ({
        ...pointer(x, z, clientX),
        shiftKey: snap,
        ray: new Ray(new Vector3(x, y, z + 5), new Vector3(0, 0, -1)),
      });
      await renderer.fireEvent(node, "pointerDown", verticalPointer(0.2));
      const renders = model.renders;
      for (let i = 1; i <= 10; i++)
        await renderer.fireEvent(
          node,
          "pointerMove",
          verticalPointer(0.2 + 0.037 * i, 100 + i * 4),
        );
      const expected = snap ? 0.4 : 0.37;
      expect((node.instance as Group).position.toArray()).toEqual([
        x,
        expect.closeTo(expected),
        z,
      ]);
      expect(model.renders).toBe(renders);
      expect(editor.draft.getState().undo).toHaveLength(0);
      await renderer.fireEvent(node, "pointerUp", verticalPointer(0.57, 140));
      expect(editor.draft.getState().undo).toHaveLength(1);
      expect(
        editor.working().objects.find((o) => o.id === object.id)!.transform
          .position,
      ).toEqual([x, expect.closeTo(expected), z]);
      expect(editor.scene.getState().scene.revision).toBe(0);
    },
  );
  it("cancels a height gesture without creating a suggestion", async () => {
    const object = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    editor.interaction.setState({ movePlane: "height" });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    await renderer.fireEvent(node, "pointerDown", pointer(0.2, 1.75));
    await renderer.fireEvent(node, "pointerCancel", pointer(0.2, 1.75));
    expect(editor.draft.getState().undo).toHaveLength(0);
    expect(editor.interaction.getState().dragging).toBe(false);
  });
  it("cancels a swivel without committing its preview", async () => {
    const object = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    editor.select(object.id);
    editor.interaction.setState({ tool: "rotate" });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    const ring = node.findByProps({ name: "swivel-area" });
    const [x, , z] = object.transform.position;
    await renderer.fireEvent(ring, "pointerDown", pointer(x, z + 0.2));
    await renderer.fireEvent(ring, "pointerMove", pointer(x + 0.2, z));
    await renderer.fireEvent(ring, "pointerCancel", pointer(x + 0.2, z));
    expect(editor.draft.getState().undo).toHaveLength(0);
    await renderer.advanceFrames(80, 0.016);
    expect(yawOf((node.instance as Group).quaternion.toArray())).toBeCloseTo(0);
    expect(editor.interaction.getState().dragging).toBe(false);
  });
  it.each([false, true])(
    "height dragging magnetically lands on a tabletop, with Alt bypass=%s",
    async (bypass) => {
      const original = editor
        .working()
        .objects.find((o) => o.id === fixtureId(111))!;
      const table = editor
        .working()
        .objects.find((o) => o.category === "coffee-table")!;
      const [x, , z] = table.transform.position;
      const object = {
        ...original,
        transform: {
          ...original.transform,
          position: [x, topY(table) + 0.3, z] as [number, number, number],
        },
      };
      editor.scene.setState({
        scene: { ...editor.working(), objects: [table, object] },
      });
      editor.select(object.id);
      editor.interaction.setState({ tool: "move", movePlane: "height" });
      renderer = await ReactThreeTestRenderer.create(
        <Furniture object={object} />,
      );
      const node = renderer.scene.children[0];
      const event = (y: number, clientX = 100) => ({
        ...pointer(x, z, clientX),
        altKey: bypass,
        ray: new Ray(new Vector3(x, y, z + 5), new Vector3(0, 0, -1)),
      });
      await renderer.fireEvent(
        node,
        "pointerDown",
        event(object.transform.position[1] + 0.2),
      );
      const renders = model.renders;
      await renderer.fireEvent(
        node,
        "pointerMove",
        event(topY(table) + 0.04 + 0.2, 180),
      );
      const expected = topY(table) + (bypass ? 0.04 : 0);
      expect((node.instance as Group).position.y).toBeCloseTo(expected);
      expect(model.renders).toBe(renders);
      const guide = renderer.scene.findByProps({ name: "face-snap-guide" });
      expect(guide.instance.visible).toBe(!bypass);
      await renderer.fireEvent(node, "pointerUp", event(expected + 0.2, 180));
      expect(guide.instance.visible).toBe(false);
      expect(editor.draft.getState().undo).toHaveLength(1);
      expect(
        editor.working().objects.find((o) => o.id === object.id)!.transform
          .position[1],
      ).toBeCloseTo(expected);
      expect(!!editor.draft.getState().conflicts[object.id]).toBe(bypass);
      if (!bypass)
        expect(
          editor.working().objects.find((o) => o.id === object.id)!.placement,
        ).toEqual({ support: "object", parentId: table.id });
    },
  );
  it("lands precisely back on the floor while dragging a raised draft", async () => {
    const original = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    editor.suggest({
      type: "move",
      objectId: original.id,
      transform: { ...original.transform, position: [0.2, 0.4, 1.75] },
    });
    const object = editor.working().objects.find((o) => o.id === original.id)!;
    editor.select(object.id);
    editor.interaction.setState({ tool: "move", movePlane: "height" });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    const event = (y: number, c = 100) => ({
      ...pointer(0.2, 1.75, c),
      ray: new Ray(new Vector3(0.2, y, 6.75), new Vector3(0, 0, -1)),
    });
    await renderer.fireEvent(node, "pointerDown", event(0.6));
    await renderer.fireEvent(node, "pointerMove", event(0.23, 180));
    expect((node.instance as Group).position.y).toBe(0);
    await renderer.fireEvent(node, "pointerUp", event(0.23, 180));
    expect(
      editor.working().objects.find((o) => o.id === object.id)!.transform
        .position[1],
    ).toBe(0);
    expect(editor.draft.getState().conflicts[object.id]).toBeUndefined();
  });
  it("slides, raises and slides again in one continuous gesture without jumps or model rerenders", async () => {
    const object = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const node = renderer.scene.children[0];
    await renderer.fireEvent(node, "pointerDown", pointer(0.2, 1.75));
    const renders = model.renders;
    await renderer.fireEvent(node, "pointerMove", pointer(0.4, 1.75, 150));
    expect((node.instance as Group).position.x).toBeCloseTo(0.4);
    editor.interaction.setState({ heightModifier: true });
    const vertical = (y: number) => ({
      ...pointer(0.4, 1.75, 180),
      ray: new Ray(new Vector3(0.4, y, 6.75), new Vector3(0, 0, -1)),
    });
    await renderer.fireEvent(node, "pointerMove", vertical(0.2));
    expect((node.instance as Group).position.toArray()).toEqual([0.4, 0, 1.75]);
    await renderer.fireEvent(node, "pointerMove", vertical(0.6));
    expect((node.instance as Group).position.y).toBeCloseTo(0.4);
    editor.interaction.setState({ heightModifier: false });
    await renderer.fireEvent(node, "pointerMove", pointer(0.4, 1.75, 200));
    expect((node.instance as Group).position.toArray()).toEqual([
      0.4,
      expect.closeTo(0.4),
      1.75,
    ]);
    await renderer.fireEvent(node, "pointerMove", pointer(0.6, 1.75, 220));
    expect((node.instance as Group).position.toArray()).toEqual([
      0.6,
      expect.closeTo(0.4),
      1.75,
    ]);
    expect(model.renders).toBe(renders);
    expect(editor.draft.getState().undo).toHaveLength(0);
    await renderer.fireEvent(node, "pointerUp", pointer(0.6, 1.75, 220));
    expect(editor.draft.getState().undo).toHaveLength(1);
    expect(
      editor.working().objects.find((o) => o.id === object.id)!.transform
        .position,
    ).toEqual([0.6, expect.closeTo(0.4), 1.75]);
  });
});

describe("attached item gesture previews", () => {
  it("clears child previews on cancel and rejects dragging a support with a locked child", async () => {
    const original = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    const parent = {
      ...original,
      dimensionsM: [1, 0.6, 1] as [number, number, number],
      transform: {
        ...original.transform,
        position: [0, 0, 0] as [number, number, number],
      },
    };
    const child = {
      ...original,
      id: fixtureId(902),
      dimensionsM: [0.2, 0.2, 0.2] as [number, number, number],
      placement: { support: "object" as const, parentId: parent.id },
      transform: {
        ...parent.transform,
        position: [0.2, 0.6, 0] as [number, number, number],
      },
    };
    editor.scene.setState({
      scene: { ...createFixtureScene(), objects: [parent, child] },
      ready: true,
    });
    renderer = await ReactThreeTestRenderer.create(
      <>
        <Furniture object={parent} />
        <Furniture object={child} />
      </>,
    );
    const node = renderer.scene.findByProps({ name: `furniture-${parent.id}` });
    const attached = renderer.scene.findByProps({
      name: `furniture-${child.id}`,
    });
    await renderer.fireEvent(node, "pointerDown", pointer(0, 0));
    await renderer.fireEvent(node, "pointerMove", pointer(0.5, 0, 180));
    await renderer.advanceFrames(1, 0.1);
    expect((attached.instance as Group).position.x).toBeCloseTo(0.7);
    await renderer.fireEvent(node, "pointerCancel", pointer(0.5, 0, 180));
    await renderer.advanceFrames(1, 1);
    expect((attached.instance as Group).position.x).toBeCloseTo(0.2);
    expect(editor.motion.transforms.size).toBe(0);
    expect(editor.draft.getState().undo).toHaveLength(0);
    await act(async () =>
      editor.scene.setState({
        scene: {
          ...createFixtureScene(),
          objects: [parent, { ...child, locked: true }],
        },
      }),
    );
    await renderer.fireEvent(node, "pointerDown", pointer(0, 0));
    expect(editor.interaction.getState().dragging).toBe(false);
    expect(editor.interaction.getState().toast).toMatch(/locked/i);
  });

  it.each(["move", "rotate"] as const)(
    "previews %s for the whole stack without model rerenders and commits one draft step",
    async (tool) => {
      const original = editor
        .working()
        .objects.find((o) => o.id === fixtureId(111))!;
      const parent = {
        ...original,
        dimensionsM: [1, 0.6, 1] as [number, number, number],
        transform: {
          position: [0, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        },
      };
      const child = {
        ...original,
        id: fixtureId(900),
        dimensionsM: [0.2, 0.2, 0.2] as [number, number, number],
        placement: { support: "object" as const, parentId: parent.id },
        transform: {
          ...parent.transform,
          position: [0.2, 0.6, 0] as [number, number, number],
        },
      };
      editor.scene.setState({
        scene: { ...createFixtureScene(), objects: [parent, child] },
        ready: true,
      });
      editor.interaction.setState({ tool });
      renderer = await ReactThreeTestRenderer.create(
        <>
          <Furniture object={parent} />
          <Furniture object={child} />
        </>,
      );
      const node = renderer.scene.findByProps({
        name: `furniture-${parent.id}`,
      });
      const attached = renderer.scene.findByProps({
        name: `furniture-${child.id}`,
      });
      await renderer.fireEvent(node, "pointerDown", pointer(0, 1));
      const renders = model.renders;
      await renderer.fireEvent(
        node,
        "pointerMove",
        tool === "move" ? pointer(0.5, 1, 180) : pointer(1, 0, 180),
      );
      await renderer.advanceFrames(1, 0.1);
      const position = (attached.instance as Group).position;
      expect(position.x).toBeCloseTo(tool === "move" ? 0.7 : 0);
      expect(position.z).toBeCloseTo(tool === "move" ? 0 : -0.2);
      expect(position.y).toBeCloseTo(0.6);
      expect(model.renders).toBe(renders);
      expect(editor.draft.getState().undo).toHaveLength(0);
      await renderer.fireEvent(node, "pointerUp", pointer(1, 0, 180));
      expect(editor.draft.getState().undo).toHaveLength(1);
      expect(editor.working().objects[1].transform.position[0]).toBeCloseTo(
        tool === "move" ? 0.7 : 0,
      );
      await act(async () => editor.travel("undo"));
      expect(editor.working().objects[1].transform).toEqual(child.transform);
    },
  );
});

it("omits debug selection boxes from production furniture", async () => {
  vi.stubEnv("DEV", false);
  try {
    const object = editor
      .working()
      .objects.find((o) => o.id === fixtureId(111))!;
    editor.select(object.id);
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    expect(
      renderer.scene.findAll((n) => n.instance instanceof LineSegments),
    ).toHaveLength(0);
  } finally {
    vi.unstubAllEnvs();
  }
});

it.each([false, true])(
  "toggles current collider overlays and keeps them attached during dragging (DEV=%s)",
  async (dev) => {
    vi.stubEnv("DEV", dev);
    try {
      const object = editor
        .working()
        .objects.find((o) => o.id === fixtureId(111))!;
      renderer = await ReactThreeTestRenderer.create(
        <Furniture object={object} />,
      );
      const node = renderer.scene.findByProps({
        name: `furniture-${object.id}`,
      });
      expect(
        renderer.scene.findAllByProps({ name: "collision-outline" }),
      ).toHaveLength(0);
      await act(async () =>
        editor.interaction.setState({ boundingBoxes: true }),
      );
      const overlay = renderer.scene.findByProps({ name: "collision-outline" })
        .instance as Group;
      expect(editor.hasDraft()).toBe(false);
      await renderer.fireEvent(node, "pointerDown", pointer(0.2, 1.75));
      await renderer.fireEvent(node, "pointerMove", pointer(0.6, 1.75, 180));
      (node.instance as Group).updateMatrixWorld(true);
      expect(overlay.getWorldPosition(new Vector3()).x).toBeCloseTo(0.6);
      await renderer.fireEvent(node, "pointerUp", pointer(0.6, 1.75, 180));
      expect(editor.draft.getState().undo).toHaveLength(1);
      await act(async () =>
        editor.interaction.setState({ boundingBoxes: false }),
      );
      expect(
        renderer.scene.findAllByProps({ name: "collision-outline" }),
      ).toHaveLength(0);
      expect(editor.draft.getState().undo).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  },
);
describe("tilted decor", () => {
  it("sizes the hit box and collider outline to the tilted size", async () => {
    const base = editor.scene
      .getState()
      .scene.objects.find((o) => o.id === fixtureId(111))!;
    const object = {
      ...base,
      dimensionsM: [0.18, 0.26, 0.03] as [number, number, number],
      tilt: { x: 1, z: 0 },
    };
    editor.scene.setState({
      scene: {
        ...editor.scene.getState().scene,
        objects: editor.scene
          .getState()
          .scene.objects.map((o) => (o.id === object.id ? object : o)),
      },
    });
    editor.interaction.setState({ boundingBoxes: true });
    renderer = await ReactThreeTestRenderer.create(
      <Furniture object={object} />,
    );
    const hit = renderer.scene.findAll(
      (n) =>
        n.instance instanceof Mesh &&
        n.instance.geometry instanceof BoxGeometry,
    )[0].instance as Mesh<BoxGeometry>;
    const { width, height, depth } = hit.geometry.parameters;
    expect([width, height, depth]).toEqual([0.18, 0.03, 0.26]);
    expect(hit.position.y).toBeCloseTo(0.015);
    const outline = renderer.scene.findAll(
      (n) => n.instance instanceof LineSegments,
    )[0].instance as LineSegments;
    outline.geometry.computeBoundingBox();
    const size = outline.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(0.18, 6);
    expect(size.y).toBeCloseTo(0.03, 6);
    expect(size.z).toBeCloseTo(0.26, 6);
  });
});
