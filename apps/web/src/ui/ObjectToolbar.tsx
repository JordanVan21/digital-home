import { ArrowUpDown, Copy, Ellipsis, LockKeyhole, LockKeyholeOpen, Move, RotateCw, Trash2 } from 'lucide-react';
import type { SceneObject } from '@house/contracts';
import { deleteSelected, duplicateSelected, setMode, toggleLock, useEditor } from '../state/store';
import { Button } from './Button';

/** Floating glass toolbar pinned above the selected piece in the 3D view. */
export function ObjectToolbar({ object }: { object: SceneObject }) {
  const mode = useEditor((s) => s.mode);
  const plane = useEditor((s) => s.movePlane);
  const dragging = useEditor((s) => s.dragging);
  const blocked = dragging || object.locked;
  const moving = mode === 'translate' && !object.locked;
  return (
    <div className="object-toolbar glass" role="toolbar" aria-label={`${object.displayName} tools`} onPointerDown={(e) => e.stopPropagation()}>
      <Button label="Move (G)" className="round" active={moving && plane === 'floor'} aria-pressed={moving && plane === 'floor'} disabled={blocked} onClick={() => setMode('translate')}>
        <Move size={15} />
      </Button>
      <Button label="Move up or down (Y, or hold Space)" className="round" active={moving && plane === 'height'} aria-pressed={moving && plane === 'height'} disabled={blocked} onClick={() => setMode('translate', 'height')}>
        <ArrowUpDown size={15} />
      </Button>
      <Button label="Rotate freely (R; Shift snaps to 15°)" className="round" active={mode === 'rotate'} aria-pressed={mode === 'rotate'} disabled={blocked} onClick={() => setMode('rotate')}>
        <RotateCw size={15} />
      </Button>
      <Button label="Duplicate (⌘/Ctrl+D)" className="round" disabled={dragging} onClick={duplicateSelected}>
        <Copy size={15} />
      </Button>
      <Button label="Delete (Backspace)" className="round" disabled={blocked} onClick={deleteSelected}>
        <Trash2 size={15} />
      </Button>
      <span className="rule" />
      <Button label={object.locked ? 'Unlock (L)' : 'Lock (L)'} className="round" active={object.locked} disabled={dragging} onClick={() => toggleLock()}>
        {object.locked ? <LockKeyhole size={15} /> : <LockKeyholeOpen size={15} />}
      </Button>
      <Button label="Show details" className="round" onClick={() => useEditor.setState((s) => ({ inspectorOpen: !s.inspectorOpen }))}>
        <Ellipsis size={16} />
      </Button>
    </div>
  );
}
