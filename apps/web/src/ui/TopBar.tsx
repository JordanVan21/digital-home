import { useRef, useState } from "react";
import { Home, Search, ChevronDown, Undo2, Redo2, Sparkles, ScanLine } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";
import { importScanFile } from "../lib/scanImport";

export function TopBar() {
  const saveStatus = useSceneStore((s) => s.saveStatus);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const canUndo = useSceneStore((s) => s.undoStack.length > 0);
  const canRedo = useSceneStore((s) => s.redoStack.length > 0);
  const loadImportedRoom = useSceneStore((s) => s.loadImportedRoom);
  const fileInput = useRef<HTMLInputElement>(null);
  const [importNote, setImportNote] = useState<string | null>(null);

  async function onScanFile(file: File | undefined) {
    if (!file) return;
    const result = await importScanFile(file);
    if (result.ok) {
      loadImportedRoom(result.shell, result.scene);
      setImportNote(result.warnings[0] ?? null);
    } else {
      setImportNote(result.error);
    }
  }

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

      {importNote && <span className="save-status" title={importNote} style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{importNote}</span>}
      <input ref={fileInput} type="file" accept="application/json,.json" hidden
        onChange={(e) => { void onScanFile(e.target.files?.[0]); e.target.value = ""; }} />
      <button className="btn" title="Open a room scan exported from the iPhone app" onClick={() => fileInput.current?.click()}>
        <ScanLine size={14} /> Import scan
      </button>

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
