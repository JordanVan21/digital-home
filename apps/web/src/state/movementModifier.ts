import type { Editor } from "./editor";
/** Temporary height mode is view state; it may change during a captured drag. */
export function installHeightModifier(editor: Editor) {
  const clear = () => editor.interaction.setState({ heightModifier: false });
  const down = (e: KeyboardEvent) => {
    if (e.code !== "Space" || e.metaKey || e.ctrlKey) return;
    if (
      e.target instanceof Element &&
      e.target.closest(
        'input,textarea,select,[contenteditable="true"],button,[role="dialog"]',
      )
    )
      return;
    const state = editor.interaction.getState();
    const object = editor.selected();
    if (
      !editor.scene.getState().ready ||
      state.browser ||
      state.tool === "rotate" ||
      !object ||
      object.locked
    )
      return;
    e.preventDefault();
    if (!state.heightModifier)
      editor.interaction.setState({ heightModifier: true });
  };
  const up = (e: KeyboardEvent) => {
    if (e.code === "Space") clear();
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", clear);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", clear);
    clear();
  };
}
