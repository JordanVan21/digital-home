import { Component, useEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import { X } from "lucide-react";
import { installHeightModifier } from "./state/movementModifier";
import { editor } from "./state/editor";
import { SceneCanvas } from "./scene/SceneCanvas";
import { TopBar } from "./components/TopBar";
import { SideNav } from "./components/SideNav";
import { SuggestionsBar } from "./components/SuggestionsBar";
import { MeasurementsToggle, ViewControls } from "./components/ViewControls";
import { useLighting } from "./theme";
import { InspectorPanel } from "./components/InspectorPanel";
import { AssetBrowser } from "./components/AssetBrowser";
import { Button } from "./components/Button";
import { readLastRoom, rememberRoom } from "./state/lastRoom";
function Keyboard() {
  useEffect(() => {
    const cleanupHeightModifier = installHeightModifier(editor);
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]'))
        return;
      const state = editor.interaction.getState();
      if (e.key === "Escape") {
        // Esc deselects or closes first; with nothing to close it discards suggestions.
        if (!state.selectedId && !state.browser && !state.dragging)
          editor.discard();
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
      if (e.key === "Enter" && editor.hasDraft()) {
        e.preventDefault();
        editor.accept();
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        e.preventDefault();
        editor.travel(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (key === "v") editor.interaction.setState({ tool: "select" });
      if (key === "g")
        editor.interaction.setState({ tool: "move", movePlane: "floor" });
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
      if (editor.hasDraft()) e.preventDefault();
      if (editor.pending()) {
        void editor.flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("beforeunload", leave);
    return () => {
      cleanupHeightModifier();
      window.removeEventListener("keydown", handle);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  return null;
}
/** Publishes the active lighting preset's colours as CSS variables for the chrome. */
function ThemeSync() {
  const light = useLighting();
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--accent", light.accent);
    root.setProperty("--accent-ink", light.accentInk);
    root.setProperty("--backdrop", light.backdrop);
  }, [light]);
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
  const ready = useStore(editor.scene, (s) => s.ready),
    error = useStore(editor.save, (s) => s.error);
  useEffect(() => {
    void editor.load(readLastRoom());
    return editor.room.subscribe((s) => rememberRoom(s.room.roomId));
  }, []);
  return (
    <main className="app-shell">
      <Keyboard />
      <ThemeSync />
      <CanvasBoundary>
        <SceneCanvas />
      </CanvasBoundary>
      <TopBar />
      <SideNav />
      <ViewControls />
      <InspectorPanel />
      <MeasurementsToggle />
      <SuggestionsBar />
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
