// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureId } from "@house/contracts";
import { rotationDegrees, rotationFromDegrees } from "@house/scene-engine";
import { createEditor } from "./editor";
import { installEditorKeyboard } from "./keyboard";
let editor: ReturnType<typeof createEditor>, cleanup: () => void;
const press = (
  key: string,
  options: KeyboardEventInit = {},
  target: Element = document.body,
) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
};
beforeEach(() => {
  editor = createEditor();
  editor.select(fixtureId(111));
  cleanup = installEditorKeyboard(editor);
});
afterEach(() => {
  cleanup();
  editor.dispose();
  document.body.replaceChildren();
});
describe("keyboard editing", () => {
  it("nudges relative to the camera, with Shift times ten, as undoable suggestions", () => {
    editor.motion.cameraDirection = [1, 0, 0];
    const before = structuredClone(editor.selected()!);
    press("ArrowUp");
    expect(editor.selected()!.transform.position[0]).toBeCloseTo(
      before.transform.position[0] + 0.02,
    );
    press("ArrowRight", { shiftKey: true });
    expect(editor.selected()!.transform.position[2]).toBeCloseTo(
      before.transform.position[2] + 0.2,
    );
    expect(
      editor.scene.getState().scene.objects.find((o) => o.id === before.id),
    ).toEqual(before);
    expect(editor.draft.getState().undo).toHaveLength(2);
    press("z", { ctrlKey: true });
    expect(editor.selected()!.transform.position[2]).toBe(
      before.transform.position[2],
    );
  });
  it("uses the absolute turn grid without erasing pitch or roll", () => {
    const o = editor.selected()!;
    editor.suggest(
      {
        type: "move",
        objectId: o.id,
        transform: {
          ...o.transform,
          rotation: rotationFromDegrees([25, 19, 10]),
        },
      },
      { snap: false },
    );
    press("e");
    const degrees = rotationDegrees(editor.selected()!.transform.rotation);
    expect(degrees[0]).toBeCloseTo(25);
    expect(degrees[1]).toBeCloseTo(30);
    expect(degrees[2]).toBeCloseTo(10);
    press("q");
    expect(
      rotationDegrees(editor.selected()!.transform.rotation)[1],
    ).toBeCloseTo(15);
  });
  it("keeps view shortcuts out of history and ignores typing and active gestures", () => {
    press("f");
    expect(editor.interaction.getState().cameraView).toBe("selection");
    press("Home");
    expect(editor.interaction.getState().cameraView).toBe("room");
    press("p");
    expect(editor.interaction.getState().walk).toBe(true);
    press("Escape");
    expect(editor.interaction.getState().walk).toBe(false);
    expect(editor.hasDraft()).toBe(false);
    const input = document.createElement("input");
    document.body.append(input);
    press("ArrowUp", {}, input);
    press("e", {}, input);
    expect(editor.hasDraft()).toBe(false);
    editor.interaction.setState({ dragging: true });
    press("ArrowUp");
    expect(editor.hasDraft()).toBe(false);
  });
});
