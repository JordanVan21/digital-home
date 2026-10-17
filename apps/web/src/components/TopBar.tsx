import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  Check,
  ChevronDown,
  Ellipsis,
  House,
  LoaderCircle,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";
import { editor } from "../state/editor";
import { Button } from "./Button";

export const searchInputId = "global-search";

function SaveStatus() {
  const status = useStore(editor.save, (s) => s.status);
  const error = useStore(editor.save, (s) => s.error);
  const ready = useStore(editor.scene, (s) => s.ready);
  if (status === "error")
    return (
      <button
        className="save-error"
        onClick={() => editor.retry()}
        title={error ?? "Retry save"}
      >
        <RefreshCw size={13} />
        Save failed — Retry
      </button>
    );
  return (
    <span className="save-status" role="status">
      {status === "saving" ? (
        <LoaderCircle className="spin" size={13} />
      ) : (
        <Check size={13} />
      )}{" "}
      {ready ? (status === "saving" ? "Saving…" : "Saved") : "Loading…"}
    </span>
  );
}

function RoomMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-container">
      <Button
        label="Room menu"
        className="round glass-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <Ellipsis size={18} />
      </Button>
      {open && (
        <div className="room-menu glass">
          <button
            onClick={() => {
              editor.reset();
              setOpen(false);
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
  );
}

export function TopBar() {
  const history = useStore(editor.history, (s) => s.history);
  const dragging = useStore(editor.interaction, (s) => s.dragging);
  const ready = useStore(editor.scene, (s) => s.ready);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const locked = !ready || dragging;
  return (
    <header className="topbar glass">
      <a className="brand" href="/" aria-label="House home">
        <House size={22} strokeWidth={1.8} />
        <span>House</span>
      </a>
      {/* Visual only for now: global search has no backend yet. */}
      <label className="search-pill glass-inset">
        <Search size={16} />
        <input
          id={searchInputId}
          ref={search}
          type="search"
          placeholder="Search furniture, styles, or rooms…"
          aria-label="Search"
        />
        <kbd>⌘ K</kbd>
      </label>
      <span className="spacer" />
      {/* Visual only: a single fixture room for now. */}
      <button className="room-switcher glass-inset" aria-label="Switch room">
        <House size={16} />
        <span>Living room</span>
        <ChevronDown size={15} />
      </button>
      <div className="history-buttons">
        <Button
          label="Undo (⌘/Ctrl+Z)"
          className="round glass-button"
          disabled={locked || !history.undo.length}
          onClick={() => editor.travel("undo")}
        >
          <Undo2 size={17} />
        </Button>
        <Button
          label="Redo (⇧⌘/Ctrl+Z)"
          className="round glass-button"
          disabled={locked || !history.redo.length}
          onClick={() => editor.travel("redo")}
        >
          <Redo2 size={17} />
        </Button>
      </div>
      <SaveStatus />
      <Button
        label="Open furniture library"
        className="primary-pill"
        disabled={locked}
        onClick={() =>
          editor.interaction.setState({ browser: true, replacing: false })
        }
      >
        <Plus size={17} />
        <span>Add furniture</span>
      </Button>
      <RoomMenu />
    </header>
  );
}
