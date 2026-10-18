import { ReferencePhoto } from "./components/ReferencePhoto";
import { installEditorKeyboard } from "./state/keyboard";
import { PerfOverlay } from "./components/PerfOverlay";
import { WalkHint } from "./components/CameraViewMenu";
import { Component, useEffect, type ReactNode } from "react";
import { useStore } from "zustand";
import { X } from "lucide-react";
import { installHeightModifier } from "./state/movementModifier";
import { editor } from "./state/editor";
import { SceneCanvas } from "./scene/SceneCanvas";
import { TopBar } from "./components/TopBar";
import { SideNav } from "./components/SideNav";
import { SuggestionsBar } from "./components/SuggestionsBar";
import { ViewControls } from "./components/ViewControls";
import { useLighting } from "./theme";
import { usePanelTheme } from "./uiTheme";
import { InspectorPanel } from "./components/InspectorPanel";
import { AssetBrowser } from "./components/AssetBrowser";
import { Button } from "./components/Button";
import { readLastRoom, rememberRoom } from "./state/lastRoom";
function Keyboard() {
  useEffect(() => {
    const cleanupHeightModifier = installHeightModifier(editor);
    const cleanupKeyboard = installEditorKeyboard(editor);
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
      cleanupKeyboard();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("beforeunload", leave);
    };
  }, []);
  return null;
}
/** Syncs independent panel appearance and the room lighting backdrop. */
function ThemeSync() {
  const light = useLighting();
  const theme = usePanelTheme((s) => s.theme);
  useEffect(() => {
    document.documentElement.dataset.uiTheme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.lighting = light.id;
    const root = document.documentElement.style;
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
      <ReferencePhoto />
      <WalkHint />
      {new URLSearchParams(window.location.search).has("perf") && (
        <PerfOverlay />
      )}
      <InspectorPanel />
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
