import { useEffect } from "react";
import { SceneCanvas } from "./scene/SceneCanvas";
import { TopBar } from "./ui/TopBar";
import { FloatingToolbar } from "./ui/FloatingToolbar";
import { InspectorPanel } from "./ui/InspectorPanel";
import { useSceneStore } from "./state/sceneStore";
import { useInteractionStore } from "./state/interactionStore";
import "./styles/ui.css";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function App() {
  const selectedId = useSceneStore((s) => s.selectedId);
  const select = useSceneStore((s) => s.select);
  const deleteObject = useSceneStore((s) => s.deleteObject);
  const setLock = useSceneStore((s) => s.setLock);
  const undo = useSceneStore((s) => s.undo);
  const redo = useSceneStore((s) => s.redo);
  const getSelectedObject = useSceneStore((s) => s.getSelectedObject);
  const setTool = useInteractionStore((s) => s.setTool);
  const lastError = useSceneStore((s) => s.lastError);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      switch (e.key) {
        case "Escape":
          select(null);
          break;
        case "Delete":
        case "Backspace":
          if (selectedId) deleteObject(selectedId);
          break;
        case "v":
        case "V":
          setTool("select");
          break;
        case "g":
        case "G":
          setTool("move");
          break;
        case "r":
        case "R":
          setTool("rotate");
          break;
        case "l":
        case "L": {
          const obj = getSelectedObject();
          if (obj) setLock(obj.id, !obj.locked);
          break;
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, select, deleteObject, setLock, undo, redo, setTool, getSelectedObject]);

  return (
    <div className="app-shell">
      <div className="canvas-layer">
        <SceneCanvas />
      </div>
      <TopBar />
      <FloatingToolbar />
      <InspectorPanel />
      {lastError && <div className="error-toast">{lastError}</div>}
    </div>
  );
}
