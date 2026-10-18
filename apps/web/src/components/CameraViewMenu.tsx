import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { useStore } from "zustand";
import { editor, type CameraView } from "../state/editor";
import { Button } from "./Button";
const views: [CameraView, string][] = [
  ["iso", "Isometric view"],
  ["top", "Top view"],
  ["eye", "Eye-level view"],
  ["selection", "Frame selection"],
  ["room", "Frame room"],
];
export function CameraViewMenu() {
  const [open, setOpen] = useState(false),
    container = useRef<HTMLDivElement>(null),
    walk = useStore(editor.interaction, (s) => s.walk),
    selected = useStore(editor.interaction, (s) => s.selectedId),
    dragging = useStore(editor.interaction, (s) => s.dragging);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !container.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="camera-menu-container" ref={container}>
      <Button
        label="Camera views"
        className="round glass glass-button"
        disabled={dragging}
        active={walk}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Camera size={19} />
      </Button>
      {open && (
        <div
          className="camera-menu glass"
          role="menu"
          aria-label="Camera views"
        >
          {views.map(([id, label]) => (
            <button
              role="menuitem"
              key={id}
              disabled={dragging || (id === "selection" && !selected)}
              onClick={() => {
                editor.requestView(id);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
          <button
            role="menuitem"
            disabled={dragging}
            onClick={() => {
              editor.setWalk(!walk);
              setOpen(false);
            }}
          >
            {walk ? "Leave walk mode" : "Walk through room"}
          </button>
        </div>
      )}
    </div>
  );
}

export function WalkHint() {
  const walk = useStore(editor.interaction, (s) => s.walk);
  return walk ? (
    <div className="walk-hint glass">
      Walk · WASD to move · drag to look · P or Escape to leave
    </div>
  ) : null;
}
