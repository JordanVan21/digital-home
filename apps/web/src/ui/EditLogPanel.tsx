import { useState } from "react";
import { Terminal, ChevronDown, ChevronUp } from "lucide-react";
import { useSceneStore } from "../state/sceneStore";

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

const SOURCE_LABEL: Record<string, string> = { user: "edit", undo: "undo", redo: "redo" };

/**
 * Visible proof that every mutation — gizmo drag, coordinates popup, lock,
 * delete, duplicate, undo/redo — flows through the one commitOp path and
 * produces a typed SceneOp. Mirrors what's printed to the console.
 */
export function EditLogPanel() {
  const opLog = useSceneStore((s) => s.opLog);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="edit-log glass">
      <button className="edit-log-header" onClick={() => setCollapsed((v) => !v)}>
        <Terminal size={13} />
        <span>Edit log</span>
        <span className="count">{opLog.length}</span>
        {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {!collapsed && (
        <div className="edit-log-body">
          {opLog.length === 0 ? (
            <p className="empty-hint">No edits yet. Every scene operation — schema-typed, validated — will appear here as it's committed.</p>
          ) : (
            opLog.map((entry) => (
              <div key={entry.id} className="edit-log-row">
                <span className="edit-log-time">{timeOf(entry.at)}</span>
                <span className={`edit-log-source ${entry.source}`}>{SOURCE_LABEL[entry.source]}</span>
                <span className="edit-log-summary">{entry.summary}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
