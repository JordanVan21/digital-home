// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createFixtureScene, fixtureId } from "@house/contracts";
import { editor } from "./editor";
import { InspectorPanel } from "../components/InspectorPanel";
beforeEach(() => {
  editor.scene.setState({ scene: createFixtureScene(), ready: true });
  editor.discard();
  editor.interaction.setState({ inspector: true, dragging: false });
  editor.select(fixtureId(111));
});
afterEach(() => {
  cleanup();
  editor.discard();
  editor.select(null);
});
it("edits dimensions with optional proportions as undoable suggestions", () => {
  render(<InspectorPanel />);
  const width = screen.getByRole("spinbutton", {
    name: "Width dimension in meters",
  });
  fireEvent.change(width, { target: { value: "0.72" } });
  fireEvent.blur(width);
  expect(editor.selected()?.dimensionsM).toEqual([0.72, 0.96, 0.72]);
  expect(
    editor.scene.getState().scene.objects.find((o) => o.id === fixtureId(111))!
      .dimensionsM,
  ).toEqual([0.36, 0.48, 0.36]);
  fireEvent.click(screen.getByLabelText("Keep proportions"));
  const height = screen.getByRole("spinbutton", {
    name: "Height dimension in meters",
  });
  fireEvent.change(height, { target: { value: "0.7" } });
  fireEvent.blur(height);
  expect(editor.selected()?.dimensionsM).toEqual([0.72, 0.7, 0.72]);
  editor.travel("undo");
  expect(editor.selected()?.dimensionsM).toEqual([0.72, 0.96, 0.72]);
});
