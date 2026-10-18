import type { createEditor } from "./editor";
type Editor = ReturnType<typeof createEditor>;
/** Keyboard commands share the editor's suggestion and view paths. */
export function installEditorKeyboard(editor: Editor) {
  const handle = (e: KeyboardEvent) => {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest(
        'input,textarea,select,[contenteditable="true"],[role="menu"]',
      )
    )
      return;
    const state = editor.interaction.getState();
    if (e.key === "Escape") {
      if (state.walk) {
        editor.setWalk(false);
        return;
      }
      if (!state.selectedId && !state.browser && !state.dragging)
        editor.discard();
      editor.select(null);
      editor.interaction.setState({
        browser: false,
        replacing: false,
        dragging: false,
      });
      return;
    }
    if (state.dragging || !editor.scene.getState().ready || state.browser)
      return;
    if (e.key === "Enter" && editor.hasDraft()) {
      e.preventDefault();
      editor.accept();
      return;
    }
    const key = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && key === "z") {
      e.preventDefault();
      editor.travel(e.shiftKey ? "redo" : "undo");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "d" && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      editor.duplicate();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && key === "g" && !e.altKey) {
      e.preventDefault();
      editor.groupSelection(e.shiftKey);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const arrows: Record<string, [number, number]> = {
      arrowup: [1, 0],
      arrowdown: [-1, 0],
      arrowleft: [0, -1],
      arrowright: [0, 1],
    };
    if (arrows[key]) {
      e.preventDefault();
      editor.nudge(...arrows[key], e.shiftKey ? 10 : 1);
      return;
    }
    if (key === "q" || key === "e") {
      e.preventDefault();
      editor.rotate(key === "q" ? -1 : 1);
      return;
    }
    if (key === "f") {
      e.preventDefault();
      editor.requestView("selection");
      return;
    }
    if (key === "home") {
      e.preventDefault();
      editor.requestView("room");
      return;
    }
    if (key === "p" && !e.repeat) {
      e.preventDefault();
      editor.setWalk(!state.walk);
      return;
    }
    if (key === "v") editor.interaction.setState({ tool: "select" });
    if (key === "g")
      editor.interaction.setState({ tool: "move", movePlane: "floor" });
    if (key === "r") {
      editor.interaction.setState({ tool: "rotate" });
      editor.rotate(e.shiftKey ? -1 : 1);
    }
    if (key === "l") editor.toggleLock();
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      editor.remove();
    }
  };
  window.addEventListener("keydown", handle);
  return () => window.removeEventListener("keydown", handle);
}
