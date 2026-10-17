import { useStore } from "zustand";
import {
  MousePointer2,
  Move,
  RotateCw,
  Plus,
  Trash2,
  LockKeyhole,
  UnlockKeyhole,
  Undo2,
  Redo2,
} from "lucide-react";
import { editor } from "../state/editor";
import { Button } from "./Button";
export function FloatingToolbar() {
  const tool = useStore(editor.interaction, (s) => s.tool),
    selectedId = useStore(editor.interaction, (s) => s.selectedId);
  const object = useStore(editor.scene, (s) =>
    s.scene.objects.find((o) => o.id === selectedId),
  );
  const history = useStore(editor.history, (s) => s.history);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const ready = useStore(editor.scene, (s) => s.ready);
  const disabled = !ready || dragging;
  return (
    <nav className="toolbar glass" aria-label="Object tools">
      <Button
        label="Select (V)"
        disabled={disabled}
        active={tool === "select"}
        onClick={() => editor.interaction.setState({ tool: "select" })}
      >
        <MousePointer2 size={19} />
      </Button>
      <Button
        label="Move (G)"
        disabled={disabled || object?.locked}
        active={tool === "move"}
        onClick={() => editor.interaction.setState({ tool: "move" })}
      >
        <Move size={19} />
      </Button>
      <Button
        label="Rotate 15° (R / Shift+R)"
        disabled={disabled || !object || object.locked}
        active={tool === "rotate"}
        onClick={() => {
          editor.interaction.setState({ tool: "rotate" });
          editor.rotate();
        }}
      >
        <RotateCw size={19} />
      </Button>
      <span className="toolbar-rule" />
      <Button
        label="Add furniture"
        className="add-tool"
        disabled={disabled}
        onClick={() =>
          editor.interaction.setState({ browser: true, replacing: false })
        }
      >
        <Plus size={20} />
      </Button>
      <Button
        label="Delete (Backspace)"
        disabled={disabled || !object || object.locked}
        onClick={() => editor.remove()}
      >
        <Trash2 size={18} />
      </Button>
      <Button
        label={object?.locked ? "Unlock (L)" : "Lock (L)"}
        disabled={disabled || !object}
        active={object?.locked}
        onClick={() => editor.toggleLock()}
      >
        {object?.locked ? (
          <LockKeyhole size={18} />
        ) : (
          <UnlockKeyhole size={18} />
        )}
      </Button>
      <span className="toolbar-rule" />
      <Button
        label="Undo (⌘/Ctrl+Z)"
        disabled={disabled || !history.undo.length}
        onClick={() => editor.travel("undo")}
      >
        <Undo2 size={18} />
      </Button>
      <Button
        label="Redo (⇧⌘/Ctrl+Z)"
        disabled={disabled || !history.redo.length}
        onClick={() => editor.travel("redo")}
      >
        <Redo2 size={18} />
      </Button>
    </nav>
  );
}
