import { useState } from "react";
import { useStore } from "zustand";
import { editor } from "../state/editor";
export function EditLogPanel() {
  const [open, setOpen] = useState(false);
  const entries = useStore(editor.log, (s) => s.entries);
  return (
    <div className="edit-log">
      <button
        className="secondary-button glass"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Edit log ({entries.length})
      </button>
      {open && (
        <aside className="glass" aria-label="Edit log">
          <h3>Edit history</h3>
          {!entries.length && <p>Edits will appear here.</p>}
          {[...entries].reverse().map((entry) => (
            <details key={entry.id}>
              <summary>
                {entry.kind} · {entry.operations.length} operation
                {entry.operations.length === 1 ? "" : "s"} ·{" "}
                {new Date(entry.at).toLocaleTimeString()}
              </summary>
              <pre>{JSON.stringify(entry.operations, null, 2)}</pre>
            </details>
          ))}
        </aside>
      )}
    </div>
  );
}
