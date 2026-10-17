import { Home, Search, ChevronDown, Undo2, Redo2, Sparkles } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";

export function TopBar() {
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const canUndo = useSceneStore((s) => s.undoStack.length > 0);
  const canRedo = useSceneStore((s) => s.redoStack.length > 0);

  return (
    <div className="top-bar glass">
      <span className="brand">
        <Home size={17} strokeWidth={2.4} />
        House
      </span>

      <div className="search-stub" title="Coming in a later phase">
        <Search size={14} />
        <span className="placeholder">Search furniture, styles, or rooms…</span>
        <kbd>⌘K</kbd>
      </div>

      <button className="room-select" disabled title="Single-room MVP for now">
        <Home size={13} />
        Living Room
        <ChevronDown size={13} />
      </button>

      <div className="spacer" />

      <button className="icon-btn-sm" title="Undo (Cmd+Z)" disabled={!canUndo} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button className="icon-btn-sm" title="Redo (Shift+Cmd+Z)" disabled={!canRedo} onClick={redo}>
        <Redo2 size={16} />
      </button>

      <div className={`save-status ${saveStatus}`}>
        <span className="dot" />
        {saveStatus === "saving" ? "Saving…" : saveStatus === "offline" ? "Offline changes" : "Saved"}
      </div>

      <button className="btn" disabled title="Coming in a later phase">
        Save Version
      </button>
      <button className="btn-hero" disabled title="Coming in a later phase">
        <Sparkles size={14} /> Design
      </button>
    </div>
  );
}
