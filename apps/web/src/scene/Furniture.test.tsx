// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { Group, LineBasicMaterial, LineSegments, Ray, Vector3 } from "three";
import { createFixtureScene, fixtureId } from "@house/contracts";
import { createHistory } from "@house/scene-engine";
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
    editor.discard();
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
});
