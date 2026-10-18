// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createEditor } from "./editor";
import { installHeightModifier } from "./movementModifier";
describe("temporary height shortcut", () => {
  it("works during a drag and clears on keyup, blur and cleanup", () => {
    const e = createEditor();
    const object = e.working().objects.find((o) => !o.locked)!;
    e.select(object.id);
    e.interaction.setState({ dragging: true, tool: "move" });
    const cleanup = installHeightModifier(e);
    const down = new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      cancelable: true,
    });
    window.dispatchEvent(down);
    expect(e.interaction.getState().heightModifier).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
    expect(e.interaction.getState().heightModifier).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    window.dispatchEvent(new Event("blur"));
    expect(e.interaction.getState().heightModifier).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    cleanup();
    expect(e.interaction.getState().heightModifier).toBe(false);
    e.dispose();
  });
  it("ignores typing, rotation, dialogs, and locked selections", () => {
    const e = createEditor();
    const object = e.working().objects.find((o) => !o.locked)!;
    e.select(object.id);
    const cleanup = installHeightModifier(e);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    expect(e.interaction.getState().heightModifier).toBe(false);
    input.remove();
    e.interaction.setState({ tool: "rotate" });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(e.interaction.getState().heightModifier).toBe(false);
    e.interaction.setState({ tool: "move", browser: true });
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(e.interaction.getState().heightModifier).toBe(false);
    e.interaction.setState({ browser: false });
    e.select(e.working().objects.find((o) => o.locked)!.id);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(e.interaction.getState().heightModifier).toBe(false);
    cleanup();
    e.dispose();
  });
});
