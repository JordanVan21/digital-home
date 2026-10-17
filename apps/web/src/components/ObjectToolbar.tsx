import { useStore } from "zustand";
import {
  Copy,
  Ellipsis,
  LockKeyhole,
  Move,
  RotateCw,
  Trash2,
  UnlockKeyhole,
} from "lucide-react";
import type { SceneObject } from "@house/contracts";
import { editor } from "../state/editor";
import { Button } from "./Button";

/** Floating glass toolbar pinned above the selected object in the 3D view. */
export function ObjectToolbar({ object }: { object: SceneObject }) {
  const tool = useStore(editor.interaction, (s) => s.tool);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const blocked = dragging || object.locked;
  return (
    <div
      className="object-toolbar glass"
      role="toolbar"
      aria-label={`${object.displayName} tools`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Button
        label="Move (G)"
        className="round"
        active={tool !== "rotate" && !object.locked}
        disabled={blocked}
        onClick={() => editor.interaction.setState({ tool: "move" })}
      >
        <Move size={15} />
      </Button>
      <Button
        label="Rotate 15° (R)"
        className="round"
        active={tool === "rotate"}
        disabled={blocked}
        onClick={() => {
          editor.interaction.setState({ tool: "rotate" });
          editor.rotate();
        }}
      >
        <RotateCw size={15} />
      </Button>
      <Button
        label="Duplicate"
        className="round"
        disabled={blocked}
        onClick={() => editor.notify("Duplicating pieces is coming soon.")}
      >
        <Copy size={15} />
      </Button>
      <Button
        label="Delete (Backspace)"
        className="round"
        disabled={blocked}
        onClick={() => editor.remove()}
      >
        <Trash2 size={15} />
      </Button>
      <span className="rule" />
      <Button
        label={object.locked ? "Unlock (L)" : "Lock (L)"}
        className="round"
        active={object.locked}
        disabled={dragging}
        onClick={() => editor.toggleLock()}
      >
        {object.locked ? (
          <LockKeyhole size={15} />
        ) : (
          <UnlockKeyhole size={15} />
        )}
      </Button>
      <Button
        label="Show details"
        className="round"
        onClick={() =>
          editor.interaction.setState((s) => ({ inspector: !s.inspector }))
        }
      >
        <Ellipsis size={16} />
      </Button>
    </div>
  );
}
