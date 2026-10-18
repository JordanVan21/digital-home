import type { ReactNode } from 'react';
import { deleteSelected, duplicateSelected, frameCamera, redo, requestCamera, setMode, toggleLock, undo, useEditor } from '../state/store';
import { Icon } from './icons';

function ToolButton({ label, keys, onClick, active, disabled, children }: {
  label: string; keys?: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode;
}) {
  return (
    <button className={`tool ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={active} title={keys ? `${label} (${keys})` : label}>
      {children}
    </button>
  );
}

export function FloatingToolbar() {
  const mode = useEditor((s) => s.mode);
  const selected = useEditor((s) => (s.selectedId ? s.workingScene?.objects.find((o) => o.id === s.selectedId) : undefined));
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const libraryOpen = useEditor((s) => s.libraryOpen);
  const walk = useEditor((s) => s.walkMode);
  const locked = !!selected?.locked;
  return (
    <nav className="toolbar panel" aria-label="Editor tools">
      <ToolButton label="Select" keys="V" active={mode === 'select'} onClick={() => setMode('select')}><Icon.select /></ToolButton>
      <ToolButton label="Move" keys="G" active={mode === 'translate'} onClick={() => setMode('translate')}><Icon.move /></ToolButton>
      <ToolButton label="Rotate" keys="R" active={mode === 'rotate'} onClick={() => setMode('rotate')}><Icon.rotate /></ToolButton>
      <div className="sep" />
      <ToolButton label="Add furniture" active={libraryOpen} onClick={() => useEditor.setState({ libraryOpen: !libraryOpen })}><Icon.add /></ToolButton>
      <ToolButton label="Duplicate" keys="Ctrl+D" disabled={!selected} onClick={duplicateSelected}><Icon.duplicate /></ToolButton>
      <ToolButton label="Delete" keys="Del" disabled={!selected || locked} onClick={deleteSelected}><Icon.trash /></ToolButton>
      <ToolButton label={locked ? 'Unlock' : 'Lock'} keys="L" active={locked} disabled={!selected} onClick={() => toggleLock()}>
        {locked ? <Icon.lock /> : <Icon.unlock />}
      </ToolButton>
      <div className="sep" />
      <ToolButton label="Undo" keys="Ctrl+Z" disabled={!canUndo} onClick={undo}><Icon.undo /></ToolButton>
      <ToolButton label="Redo" keys="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}><Icon.redo /></ToolButton>
      <div className="sep" />
      <ToolButton label="Top view" onClick={() => requestCamera('top')}><Icon.top /></ToolButton>
      <ToolButton label="Isometric view" onClick={() => requestCamera('iso')}><Icon.iso /></ToolButton>
      <ToolButton label="Eye-level view" onClick={() => requestCamera('eye')}><Icon.eye /></ToolButton>
      <ToolButton label="Frame selection" keys="F" onClick={() => frameCamera('selection')}><Icon.frame /></ToolButton>
      <ToolButton label={walk ? 'Exit walk mode' : 'Walk mode'} keys="P" active={walk} onClick={() => useEditor.setState({ walkMode: !walk, selectedIds: [], selectedId: null })}><Icon.walk /></ToolButton>
    </nav>
  );
}
