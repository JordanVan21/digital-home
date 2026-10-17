import { MousePointer2, Move, RotateCw, Lock, Unlock, Trash2, Undo2, Redo2 } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";
import { useInteractionStore, type EditorTool } from "../state/interactionStore";

const TOOLS: { id: EditorTool; label: string; Icon: typeof MousePointer2 }[] = [
  { id: "select", label: "Select (V)", Icon: MousePointer2 },
  { id: "move", label: "Move (G)", Icon: Move },
  { id: "rotate", label: "Rotate (R)", Icon: RotateCw },
];

export function FloatingToolbar() {
  const tool = useInteractionStore((s) => s.tool);
  const setTool = useInteractionStore((s) => s.setTool);

  const selected = useSceneStore((s) => s.getSelectedObject());
  const setLock = useSceneStore((s) => s.setLock);
  const deleteObject = useSceneStore((s) => s.deleteObject);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const canUndo = useSceneStore((s) => s.undoStack.length > 0);
  const canRedo = useSceneStore((s) => s.redoStack.length > 0);

  return (
    <div className="toolbar-left">
      {TOOLS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`icon-btn ${tool === id ? "active" : ""}`}
          title={label}
          onClick={() => setTool(id)}
        >
          <Icon size={17} />
        </button>
      ))}

      <div className="toolbar-divider" />

      <button
        className="icon-btn"
        title={selected?.locked ? "Unlock (L)" : "Lock (L)"}
        disabled={!selected}
        onClick={() => selected && setLock(selected.id, !selected.locked)}
      >
        {selected?.locked ? <Lock size={17} /> : <Unlock size={17} />}
      </button>
      <button
        className="icon-btn danger"
        title="Delete (Del)"
        disabled={!selected || selected.locked}
        onClick={() => selected && deleteObject(selected.id)}
      >
        <Trash2 size={17} />
      </button>

      <div className="toolbar-divider" />

      <button className="icon-btn" title="Undo (Cmd+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 size={17} />
      </button>
      <button className="icon-btn" title="Redo (Shift+Cmd+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 size={17} />
      </button>
    </div>
  );
}
