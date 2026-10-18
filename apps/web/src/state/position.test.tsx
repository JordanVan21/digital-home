// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fixtureId, createFixtureScene } from "@house/contracts";
import { editor } from "./editor";
import { InspectorPanel } from "../components/InspectorPanel";
beforeEach(() => {
  editor.scene.setState({ scene: createFixtureScene(), ready: true });
  editor.interaction.setState({ inspector: true, dragging: false });
});
afterEach(() => {
  cleanup();
  editor.discard();
  editor.select(null);
});
it("edits all three position coordinates as exact suggestions with undo", () => {
  editor.select(fixtureId(111));
  const original = structuredClone(editor.selected()!);
  render(<InspectorPanel />);
  for (const [label, value] of [
    ["X position in meters", "1.123"],
    ["Height in meters", "0.731"],
    ["Z position in meters", "1.456"],
  ]) {
    const field = screen.getByRole("spinbutton", { name: label });
    fireEvent.change(field, { target: { value } });
    fireEvent.blur(field);
  }
  expect(editor.selected()!.transform.position).toEqual([1.123, 0.731, 1.456]);
  expect(
    editor.scene.getState().scene.objects.find((o) => o.id === original.id),
  ).toEqual(original);
  expect(editor.changes().find((c) => c.id === original.id)?.kind).toBe(
    "moved",
  );
  editor.travel("undo");
  expect(editor.selected()!.transform.position[2]).toBe(
    original.transform.position[2],
  );
});
it("reports a height-only change as movement and guards locked position fields", () => {
  editor.select(fixtureId(111));
  const o = editor.selected()!;
  editor.suggest(
    {
      type: "move",
      objectId: o.id,
      transform: {
        ...o.transform,
        position: [o.transform.position[0], 0.731, o.transform.position[2]],
      },
    },
    { snap: false },
  );
  expect(editor.changes().find((c) => c.id === o.id)).toMatchObject({
    kind: "moved",
    distanceM: 0.731,
  });
  editor.discard();
  editor.toggleLock();
  render(<InspectorPanel />);
  expect(
    (
      screen.getByRole("spinbutton", {
        name: "X position in meters",
      }) as HTMLInputElement
    ).disabled,
  ).toBe(true);
  editor.toggleLock();
});
