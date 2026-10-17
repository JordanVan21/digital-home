import { Component, useEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import { ArrowUpRight, Plus, X, MousePointer2, Sun } from "lucide-react";
import { editor } from "./state/editor";
import { SceneCanvas } from "./scene/SceneCanvas";
import { TopBar } from "./components/TopBar";
import { FloatingToolbar } from "./components/FloatingToolbar";
import { InspectorPanel } from "./components/InspectorPanel";
import { AssetBrowser } from "./components/AssetBrowser";
import { Button } from "./components/Button";
function Keyboard() {
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      const state = editor.interaction.getState();
      if (e.key === "Escape") {
        editor.interaction.setState({
          selectedId: null,
          browser: false,
          replacing: false,
          dragging: false,
        });
        return;
      }
      if (state.dragging || !editor.scene.getState().ready || state.browser)
        return;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        editor.travel(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key === "v") editor.interaction.setState({ tool: "select" });
      if (key === "g") editor.interaction.setState({ tool: "move" });
      if (key === "r") {
        editor.interaction.setState({ tool: "rotate" });
        editor.rotate(e.shiftKey ? -1 : 1);
      }
      if (key === "l") editor.toggleLock();
      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        editor.remove();
      }
    };
    window.addEventListener("keydown", handle);
    const hide = () => {
      if (document.visibilityState === "hidden") void editor.flush();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (editor.pending()) {
        void editor.flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("keydown", handle);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  return null;
}
class CanvasBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="canvas-error">
        <h2>The room couldn’t open.</h2>
        <p>Check that WebGL is enabled, then reload your room.</p>
        <button onClick={() => window.location.reload()}>Reload room</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const browser = useStore(editor.interaction, (s) => s.browser),
    toast = useStore(editor.interaction, (s) => s.toast);
  const tool = useStore(editor.interaction, (s) => s.tool),
    selected = useStore(editor.interaction, (s) => s.selectedId);
  const ready = useStore(editor.scene, (s) => s.ready),
    error = useStore(editor.save, (s) => s.error);
  useEffect(() => {
    void editor.load();
  }, []);
  return (
    <main className="app-shell">
      <Keyboard />
      <CanvasBoundary>
        <SceneCanvas />
      </CanvasBoundary>
      <TopBar />
      <FloatingToolbar />
      <InspectorPanel />
      <div className="workspace-caption">
        <span className="eyebrow">A LITTLE ROOM FOR POSSIBILITY</span>
        <h1>
          Your space.
          <br />
          <em>Your way.</em>
        </h1>
        <p>
          Living room <span>·</span> 5.2 × 4.4 m
        </p>
      </div>
      <div className="lighting-label">
        <Sun size={14} />
        <span>Golden hour</span>
        <span className="label-dot" />
      </div>
      <footer className="bottom-bar">
        <div className="canvas-hints">
          <MousePointer2 size={14} />
          <span>
            {selected
              ? tool === "rotate"
                ? "R to rotate · Shift+R to reverse"
                : "Drag to move · Shift to snap"
              : "Drag to orbit · Right drag to pan"}
          </span>
          <span className="hint-separator" />
          <span>Scroll to zoom</span>
        </div>
        <Button
          label="Open furniture library"
          className="add-furniture glass"
          onClick={() =>
            editor.interaction.setState({ browser: true, replacing: false })
          }
        >
          <Plus size={17} />
          Add furniture
          <ArrowUpRight size={14} />
        </Button>
      </footer>
      {toast && (
        <div className="toast glass" role="status">
          <span>{toast}</span>
          <Button
            label="Dismiss notification"
            className="tiny-button"
            onClick={() => editor.interaction.setState({ toast: null })}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {!ready && error && (
        <div className="load-error glass" role="alert">
          <strong>We couldn’t load your room.</strong>
          <p>{error}</p>
          <button onClick={() => editor.reset()}>Reset room to fixture</button>
        </div>
      )}
      {browser && <AssetBrowser />}
    </main>
  );
}
