import { SCENE_SOURCES } from '../state/loader';
import { photoCamera } from '../scene/photoCamera';
import { hasReference } from './Overlays';
import { useState } from 'react';
import { requestCamera, useEditor, type SceneSource } from '../state/store';
import { Icon } from './icons';

export type DevActions = {
  retrySave: () => void;
  failNextSave: () => void;
  simulateConflict: () => void;
  resetRoom: () => void;
  loadSource: (s: SceneSource) => void;
};

export function SaveStatusIndicator({ onRetry }: { onRetry: () => void }) {
  const save = useEditor((s) => s.save);
  const dragging = useEditor((s) => s.dragging);
  const label =
    save.status === 'conflict' ? 'Conflict'
      : save.status === 'error' ? 'Not saved'
        : save.status === 'saving' ? 'Saving…'
          : save.dirty || dragging ? 'Unsaved changes'
            : save.status === 'saved' ? 'Saved' : 'Up to date';
  return (
    <div className={`save-status ${save.status} ${save.dirty ? 'dirty' : ''}`} role="status" aria-live="polite" title={save.lastError ?? `Revision ${save.baseRevision}`}>
      <span className="dot" />
      {label}
      {save.status === 'error' && <button className="link" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function TopBar({ actions }: { actions: DevActions }) {
  const roomName = useEditor((s) => s.roomName);
  const source = useEditor((s) => s.source);
  const reference = useEditor((s) => s.reference);
  const [devOpen, setDevOpen] = useState(false);
  return (
    <header className="topbar panel">
      <div className="brand">House</div>
      <div className="room-name" title={roomName}>{roomName || 'Loading…'}</div>
      <span className="mode-chip">Edit</span>
      <div className="segmented" role="tablist" aria-label="Scene source">
        {SCENE_SOURCES.map(({ id, label }) => (
          <button key={id} role="tab" aria-selected={source === id} className={source === id ? 'on' : ''} onClick={() => actions.loadSource(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <SaveStatusIndicator onRetry={actions.retrySave} />
      {photoCamera.current && (
        <button className="btn ghost" onClick={() => requestCamera('match')} title="Camera matching the reference photo">Match photo</button>
      )}
      {hasReference() && (
        <button className={`btn ghost ${reference.open ? 'on' : ''}`} onClick={() => useEditor.setState({ reference: { ...reference, open: !reference.open } })} title="Compare with the reference photo">
          Reference
        </button>
      )}
      <button className="btn ghost" onClick={() => requestCamera('reset')} title="Reset view (Home)">
        <Icon.reset /> Reset View
      </button>
      <div className="dev">
        <button className="btn ghost small" onClick={() => setDevOpen((v) => !v)} aria-expanded={devOpen}>Dev</button>
        {devOpen && (
          <div className="menu panel" onMouseLeave={() => setDevOpen(false)} onClick={() => setDevOpen(false)}>
            <button onClick={actions.failNextSave}>Simulate next save failing</button>
            <button onClick={actions.simulateConflict}>Simulate edit from another session</button>
            <button onClick={actions.resetRoom}>Reset this room to its fixture</button>
            <a href="?perf">Show frame stats</a>
          </div>
        )}
      </div>
    </header>
  );
}
