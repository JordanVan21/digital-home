import { useState } from "react";
import { useStore } from "zustand";
import {
  Check,
  ChevronDown,
  House,
  LoaderCircle,
  RotateCcw,
  Ellipsis,
  RefreshCw,
  PanelRight,
} from "lucide-react";
import { editor } from "../state/editor";
import { Button } from "./Button";
export function TopBar() {
  const [menu, setMenu] = useState(false);
  const status = useStore(editor.save, (s) => s.status);
  const error = useStore(editor.save, (s) => s.error);
  const ready = useStore(editor.scene, (s) => s.ready);
  return (
    <header className="topbar glass">
      <a className="brand" href="/" aria-label="House home">
        <House size={22} strokeWidth={1.7} />
        <span>
          house<span className="brand-dot">.</span>
        </span>
      </a>
      <span className="divider" />
      <div className="room-title">
        <span className="room-eyebrow">YOUR SPACE</span>
        <span>
          Living room <ChevronDown size={12} />
        </span>
      </div>
      <span className="mode-pill">
        <span /> Edit mode
      </span>
      <div className="topbar-right">
        {status === "error" ? (
          <button
            className="save-error"
            onClick={() => editor.retry()}
            title={error ?? "Retry save"}
          >
            <RefreshCw size={13} />
            Save failed — Retry
          </button>
        ) : (
          <span className="save-status" role="status">
            {status === "saving" ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <Check size={14} />
            )}{" "}
            {ready ? (status === "saving" ? "Saving…" : "Saved") : "Loading…"}
          </span>
        )}
        <span className="divider" />
        <Button
          label="Reset View"
          className="text-button"
          onClick={() =>
            editor.interaction.setState((s) => ({ resetView: s.resetView + 1 }))
          }
        >
          <RotateCcw size={15} />
          <span>Reset view</span>
        </Button>
        <Button
          label="Toggle inspector"
          className="icon-button inspector-toggle"
          onClick={() =>
            editor.interaction.setState((s) => ({ inspector: !s.inspector }))
          }
        >
          <PanelRight size={17} />
        </Button>
        <div className="menu-container">
          <Button
            label="Room menu"
            className="icon-button"
            onClick={() => setMenu(!menu)}
            aria-expanded={menu}
          >
            <Ellipsis size={20} />
          </Button>
          {menu && (
            <div className="room-menu glass">
              <button
                onClick={() => {
                  editor.reset();
                  setMenu(false);
                }}
              >
                <RefreshCw size={14} /> Reset room to fixture
              </button>
              <button onClick={() => window.location.reload()}>
                <RotateCcw size={14} /> Reload saved room
              </button>
              <p>Changes are saved on this device.</p>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
