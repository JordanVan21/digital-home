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
import { rooms } from "../state/rooms";
import { Button } from "./Button";
import { CloudAccount } from "./CloudAccount";

export const searchInputId = "global-search";

function SaveStatus() {
  const status = useStore(editor.save, (s) => s.status);
  const error = useStore(editor.save, (s) => s.error);
  const ready = useStore(editor.scene, (s) => s.ready);
  const pending = useStore(editor.draft, (s) => s.scene !== null);
  useStore(editor.draft, (s) => s.scene);
  if (status === "conflict")
    return (
      <button
        className="save-error"
        onClick={() => window.location.reload()}
        title={error ?? "Reload saved room"}
      >
        Room changed elsewhere · Reload
      </button>
    );
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
  if (pending) {
    const n = editor.changes().length;
    return (
      <span className="save-status pending" role="status">
        <span className="pending-dot" /> {n} unsaved suggestion
        {n === 1 ? "" : "s"}
      </span>
    );
  }
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

function RoomSwitcher({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const current = useStore(editor.room, (s) => s.room);
  const container = useRef<HTMLDivElement>(null);
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
    <div className="menu-container" ref={container}>
      <button
        className="room-switcher glass-inset"
        aria-label={`Switch room (current: ${current.name})`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <House size={16} />
        <span>{current.name}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="room-menu room-list glass" role="menu">
          {rooms.map((r) => (
            <button
              key={r.roomId}
              role="menuitemradio"
              aria-checked={r === current}
              onClick={() => {
                setOpen(false);
                void editor.switchRoom(r.roomId);
              }}
            >
              <House size={14} />
              <span>{r.name}</span>
              {r === current && <Check size={14} className="room-current" />}
            </button>
          ))}
        </div>
      )}
    </div>
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
          {import.meta.env.DEV && (
            <>
              <button
                onClick={() => {
                  void editor.devAction("failure");
                  setOpen(false);
                }}
              >
                Simulate save failure
              </button>
              <button
                onClick={() => {
                  void editor.devAction("external");
                  setOpen(false);
                }}
              >
                Simulate another session edit
              </button>
            </>
          )}
          <p>Changes are saved on this device.</p>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const history = useStore(editor.history, (s) => s.history);
  // Undo/redo step through the draft first, then accepted history (see editor.travel).
  const draftActive = useStore(editor.draft, (s) => s.scene !== null);
  const draftUndo = useStore(editor.draft, (s) => s.undo.length);
  const draftRedo = useStore(editor.draft, (s) => s.redo.length);
  const canUndo =
    draftActive || draftUndo ? draftUndo > 0 : history.undo.length > 0;
  const canRedo =
    draftActive || draftRedo ? draftRedo > 0 : history.redo.length > 0;
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
      <CloudAccount />
      <RoomSwitcher disabled={locked} />
      <div className="history-buttons">
        <Button
          label="Undo (⌘/Ctrl+Z)"
          className="round glass-button"
          disabled={locked || !canUndo}
          onClick={() => editor.travel("undo")}
        >
          <Undo2 size={17} />
        </Button>
        <Button
          label="Redo (⇧⌘/Ctrl+Z)"
          className="round glass-button"
          disabled={locked || !canRedo}
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
