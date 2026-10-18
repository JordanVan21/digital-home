import { useEffect, useRef, useState } from 'react';
import {
  Camera, Check, ChevronDown, Ellipsis, House, Image, LoaderCircle, Plus, Redo2, RefreshCw, RotateCcw, Search, TriangleAlert, Undo2,
} from 'lucide-react';
import { SCENE_SOURCES } from '../state/loader';
import { photoCamera } from '../scene/photoCamera';
import { canTravel, changes, redo, requestCamera, undo, useEditor, type SceneSource } from '../state/store';
import { hasReference } from './Overlays';
import { Button } from './Button';

export type DevActions = {
  retrySave: () => void;
  failNextSave: () => void;
  simulateConflict: () => void;
  resetRoom: () => void;
  loadSource: (s: SceneSource) => void;
};

export const searchInputId = 'global-search';

function SaveStatus({ onRetry }: { onRetry: () => void }) {
  const save = useEditor((s) => s.save);
  const hasDraft = useEditor((s) => s.hasDraft);
  const n = useEditor((s) => (s.hasDraft ? changes(s).length : 0));
  if (save.status === 'error') {
    return (
      <button className="save-error" onClick={onRetry} title={save.lastError ?? 'Retry save'}>
        <RefreshCw size={13} /> Save failed — Retry
      </button>
    );
  }
  if (save.status === 'conflict') {
    return <span className="save-error" title={save.lastError ?? undefined}><TriangleAlert size={13} /> Changed elsewhere</span>;
  }
  if (hasDraft) {
    return (
      <span className="save-status pending" role="status">
        <span className="pending-dot" /> {n} unsaved suggestion{n === 1 ? '' : 's'}
      </span>
    );
  }
  const saving = save.status === 'saving' || save.dirty;
  return (
    <span className="save-status" role="status" title={`Revision ${save.baseRevision}`}>
      {saving ? <LoaderCircle className="spin" size={13} /> : <Check size={13} />} {saving ? 'Saving…' : 'Saved'}
    </span>
  );
}

/** Room switcher: the scenes this sandbox can load (fixtures standing in for scans). */
function RoomSwitcher({ onPick }: { onPick: (s: SceneSource) => void }) {
  const [open, setOpen] = useState(false);
  const source = useEditor((s) => s.source);
  const roomName = useEditor((s) => s.roomName);
  return (
    <div className="menu-container">
      <button className="room-switcher glass-inset" aria-label="Switch room" aria-expanded={open} onClick={() => setOpen(!open)} title={roomName}>
        <House size={16} />
        <span>{SCENE_SOURCES.find((x) => x.id === source)?.label ?? 'Room'}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="room-menu room-switcher-menu glass" onMouseLeave={() => setOpen(false)}>
          <div className="menu-label">ROOMS</div>
          {SCENE_SOURCES.map(({ id, label }) => (
            <button key={id} className={source === id ? 'on' : ''} onClick={() => { setOpen(false); onPick(id); }}>
              {source === id ? <Check size={14} /> : <span style={{ width: 14 }} />} {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoomMenu({ actions }: { actions: DevActions }) {
  const [open, setOpen] = useState(false);
  const run = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <div className="menu-container">
      <Button label="Room menu" className="round glass-button" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Ellipsis size={18} />
      </Button>
      {open && (
        <div className="room-menu glass" onMouseLeave={() => setOpen(false)}>
          <button onClick={run(() => requestCamera('reset'))}><RotateCcw size={14} /> Reset view</button>
          <button onClick={run(actions.resetRoom)}><RefreshCw size={14} /> Reset room to its fixture</button>
          <div className="menu-rule" />
          <div className="menu-label">DEVELOPER</div>
          <button onClick={run(actions.failNextSave)}>Simulate next save failing</button>
          <button onClick={run(actions.simulateConflict)}>Simulate edit from another session</button>
          <button onClick={run(() => { location.search = '?perf'; })}>Show frame stats</button>
          <p>Changes are saved on this device.</p>
        </div>
      )}
    </div>
  );
}

export function TopBar({ actions }: { actions: DevActions }) {
  const ready = useEditor((s) => !!s.workingScene);
  const dragging = useEditor((s) => s.dragging);
  const canUndo = useEditor((s) => canTravel('undo', s));
  const canRedo = useEditor((s) => canTravel('redo', s));
  const query = useEditor((s) => s.libraryQuery);
  const reference = useEditor((s) => s.reference);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);
  const locked = !ready || dragging;
  return (
    <header className="topbar glass">
      <a className="brand" href="/" aria-label="House home">
        <House size={22} strokeWidth={1.8} />
        <span>House</span>
      </a>
      <label className="search-pill glass-inset">
        <Search size={16} />
        <input
          id={searchInputId}
          ref={search}
          type="search"
          placeholder="Search furniture, styles, or rooms…"
          aria-label="Search the furniture library"
          value={query}
          onChange={(e) => useEditor.setState({ libraryQuery: e.target.value, libraryOpen: true, replacing: false })}
          onKeyDown={(e) => { if (e.key === 'Enter') useEditor.setState({ libraryOpen: true, replacing: false }); }}
        />
        <kbd>⌘ K</kbd>
      </label>
      <span className="spacer" />
      <RoomSwitcher onPick={actions.loadSource} />
      {photoCamera.current && (
        <Button label="Camera matching the reference photo" className="top-pill" onClick={() => requestCamera('match')}>
          <Camera size={15} />
        </Button>
      )}
      {hasReference() && (
        <Button
          label="Compare with the reference photo"
          className="top-pill"
          active={reference.open}
          onClick={() => useEditor.setState({ reference: { ...reference, open: !reference.open } })}
        >
          <Image size={15} />
        </Button>
      )}
      <div className="history-buttons">
        <Button label="Undo (⌘/Ctrl+Z)" className="round glass-button" disabled={locked || !canUndo} onClick={undo}>
          <Undo2 size={17} />
        </Button>
        <Button label="Redo (⇧⌘/Ctrl+Z)" className="round glass-button" disabled={locked || !canRedo} onClick={redo}>
          <Redo2 size={17} />
        </Button>
      </div>
      <SaveStatus onRetry={actions.retrySave} />
      <Button
        label="Open furniture library"
        className="primary-pill"
        disabled={locked}
        onClick={() => useEditor.setState({ libraryOpen: true, replacing: false })}
      >
        <Plus size={17} />
        <span>Add furniture</span>
      </Button>
      <RoomMenu actions={actions} />
    </header>
  );
}
