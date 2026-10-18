import { useState } from "react";
import { useStore } from "zustand";
import { Check, ChevronDown, RotateCcw, TriangleAlert, X } from "lucide-react";
import { editor, type Change, type ChangeKind } from "../state/editor";
import { Button } from "./Button";

const kindLabel: Record<ChangeKind, string> = {
  updated: "Updated",
  moved: "Moved",
  rotated: "Rotated",
  replaced: "Replaced",
  added: "Added",
  removed: "Removed",
};
const order: ChangeKind[] = [
  "updated",
  "moved",
  "rotated",
  "replaced",
  "added",
  "removed",
];

function magnitude(c: Change) {
  const parts = [];
  if (c.distanceM !== undefined) parts.push(`${c.distanceM.toFixed(2)} m`);
  if (c.degrees !== undefined)
    parts.push(`${c.degrees > 0 ? "+" : ""}${Math.round(c.degrees)}°`);
  return parts.join(" · ");
}

/** Pending-suggestion review: count, change list, Discard and Accept. */
export function SuggestionsBar() {
  // Subscribing to both scenes keeps the derived change list current.
  const draft = useStore(editor.draft, (s) => s.scene);
  useStore(editor.draft, (s) => s.conflicts);
  useStore(editor.scene, (s) => s.scene);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const [open, setOpen] = useState(false);
  if (!draft) return null;
  const changes = editor
    .changes()
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const conflicts = changes.filter((c) => c.conflict).length;
  return (
    <section className="suggestions glass" aria-label="Suggested changes">
      {open && (
        <ul className="change-list">
          {changes.map((c) => (
            <li key={c.id} className={c.conflict ? "has-conflict" : ""}>
              <button
                className="change-row"
                disabled={c.kind === "removed"}
                onClick={() => editor.select(c.id)}
              >
                <span className={`kind kind-${c.kind}`}>
                  {kindLabel[c.kind]}
                </span>
                <span className="change-name">{c.name}</span>
                <span className="change-amount">{magnitude(c)}</span>
                {c.conflict && (
                  <span className="change-conflict" title={c.conflict}>
                    <TriangleAlert size={13} /> {c.conflict}
                  </span>
                )}
              </button>
              <Button
                label={`Revert ${c.name}`}
                className="tiny-button"
                onClick={() => editor.revertPiece(c.id)}
              >
                <RotateCcw size={13} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="suggestions-row">
        <span className="pending-dot" />
        <button
          className="suggestions-summary"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <strong>
            {changes.length} suggested change{changes.length === 1 ? "" : "s"}
          </strong>
          {conflicts > 0 && (
            <span className="conflict-count">
              · {conflicts} conflict{conflicts === 1 ? "" : "s"}
            </span>
          )}
          <ChevronDown size={15} className={open ? "flip" : ""} />
        </button>
        <Button
          label="Discard suggestions (cannot be undone)"
          className="discard-button"
          disabled={dragging}
          onClick={() => editor.discard()}
        >
          <X size={15} />
          <span>Discard</span>
        </Button>
        <Button
          label="Accept suggestions (Return)"
          className="primary-pill accept-button"
          disabled={dragging}
          onClick={() => editor.accept()}
        >
          <Check size={16} />
          <span>Accept</span>
        </Button>
      </div>
    </section>
  );
}
