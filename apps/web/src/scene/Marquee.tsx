import { useRef, type PointerEvent } from "react";
import { useStore } from "zustand";
import { boxCorners } from "@house/scene-engine";
import { editor } from "../state/editor";
/** DOM rectangle stays mutable during the gesture; scene transforms stay untouched. */
export function useMarquee() {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    target: HTMLElement;
    ids: string[];
  } | null>(null);
  const end = (cancel = false, e?: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    if (
      !cancel &&
      e &&
      editor.motion.projectPoint &&
      Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4
    ) {
      const bounds = start.target.getBoundingClientRect();
      const minX = Math.min(start.x, e.clientX) - bounds.left,
        maxX = Math.max(start.x, e.clientX) - bounds.left;
      const minY = Math.min(start.y, e.clientY) - bounds.top,
        maxY = Math.max(start.y, e.clientY) - bounds.top;
      const ids = editor
        .working()
        .objects.filter((object) => {
          const wall =
            object.placement?.support === "wall"
              ? object.placement.parentId
              : undefined;
          if (wall && (editor.motion.wallVisibility.get(wall) ?? 1) <= 0.2)
            return false;
          const points = boxCorners(object).map(editor.motion.projectPoint!);
          return (
            Math.max(...points.map((p) => p[0])) >= minX &&
            Math.min(...points.map((p) => p[0])) <= maxX &&
            Math.max(...points.map((p) => p[1])) >= minY &&
            Math.min(...points.map((p) => p[1])) <= maxY
          );
        })
        .map((o) => o.id);
      editor.selectMany([...start.ids, ...ids]);
    }
    drag.current = null;
    if (box.current) box.current.style.display = "none";
    editor.interaction.setState({ dragging: false });
    if (e && start.target.hasPointerCapture(e.pointerId))
      start.target.releasePointerCapture(e.pointerId);
  };
  return {
    box,
    handlers: {
      onPointerDownCapture: () => {
        editor.motion.pointerHandled = false;
      },
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        if (
          editor.interaction.getState().navigationMode !== "edit" ||
          !e.shiftKey ||
          e.button !== 0 ||
          editor.motion.pointerHandled ||
          !(e.target instanceof HTMLCanvasElement) ||
          !editor.scene.getState().ready
        )
          return;
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          target,
          ids: [...editor.interaction.getState().selectedIds],
        };
        editor.interaction.setState({ dragging: true });
        e.preventDefault();
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        const start = drag.current,
          el = box.current;
        if (!start || !el) return;
        const rect = start.target.getBoundingClientRect();
        Object.assign(el.style, {
          display: "block",
          left: `${Math.min(start.x, e.clientX) - rect.left}px`,
          top: `${Math.min(start.y, e.clientY) - rect.top}px`,
          width: `${Math.abs(e.clientX - start.x)}px`,
          height: `${Math.abs(e.clientY - start.y)}px`,
        });
      },
      onPointerUp: (e: PointerEvent<HTMLDivElement>) => end(false, e),
      onPointerCancel: () => end(true),
      onLostPointerCapture: () => end(true),
    },
  };
}
export function SelectionSummary() {
  const ids = useStore(editor.interaction, (s) => s.selectedIds);
  const draft = useStore(editor.draft, (s) => s.scene),
    accepted = useStore(editor.scene, (s) => s.scene);
  const objects = (draft ?? accepted).objects.filter((o) => ids.includes(o.id));
  const grouped = objects.some((o) => o.groupId);
  const blocked = objects.some((o) => o.locked);
  return ids.length > 1 || grouped ? (
    <div className="selection-summary glass">
      <span role="status">
        {ids.length} {ids.length === 1 ? "object" : "objects"} selected
      </span>
      {ids.length > 1 && (
        <button
          className="secondary-button"
          disabled={blocked}
          onClick={() => editor.groupSelection()}
        >
          Group selection
        </button>
      )}
      {grouped && (
        <button
          className="secondary-button"
          disabled={blocked}
          onClick={() => editor.groupSelection(true)}
        >
          Ungroup selection
        </button>
      )}
    </div>
  ) : null;
}
