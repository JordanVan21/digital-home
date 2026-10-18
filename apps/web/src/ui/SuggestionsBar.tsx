import { useState } from 'react';
import { Check, ChevronDown, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { accept, changes, discard, revertPiece, select, useEditor, type Change, type ChangeKind } from '../state/store';
import { Button } from './Button';

const KIND_LABEL: Record<ChangeKind, string> = {
  moved: 'Moved', rotated: 'Rotated', replaced: 'Replaced', edited: 'Edited', added: 'Added', removed: 'Removed',
};
const ORDER: ChangeKind[] = ['moved', 'rotated', 'replaced', 'edited', 'added', 'removed'];

function magnitude(c: Change) {
  const parts = [];
  if (c.distanceM !== undefined) parts.push(`${c.distanceM.toFixed(2)} m`);
  if (c.degrees !== undefined) parts.push(`${c.degrees > 0 ? '+' : ''}${Math.round(c.degrees)}°`);
  return parts.join(' · ');
}

/** Pending-suggestion review: count, change list, Discard and Accept (Return). */
export function SuggestionsBar() {
  const hasDraft = useEditor((s) => s.hasDraft);
  const rows = useEditor((s) => s.workingScene && s.draft); // re-render on draft changes
  const dragging = useEditor((s) => s.dragging);
  const walk = useEditor((s) => s.walkMode);
  const [open, setOpen] = useState(false);
  if (!hasDraft || !rows || walk) return null;
  const list = changes().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const conflicts = list.filter((c) => c.conflict).length;
  return (
    <section className="suggestions glass" aria-label="Suggested changes">
      {open && (
        <ul className="change-list">
          {list.map((c) => (
            <li key={c.id} className={c.conflict ? 'has-conflict' : ''}>
              <button className="change-row" disabled={c.kind === 'removed'} onClick={() => select(c.id)}>
                <span className={`kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                <span className="change-name">{c.name}</span>
                <span className="change-amount">{magnitude(c)}</span>
                {c.conflict && <span className="change-conflict" title={c.conflict}><TriangleAlert size={13} /> {c.conflict}</span>}
              </button>
              <Button label={`Revert ${c.name}`} className="tiny-button" onClick={() => revertPiece(c.id)}><RotateCcw size={13} /></Button>
            </li>
          ))}
        </ul>
      )}
      <div className="suggestions-row">
        <span className="pending-dot" />
        <button className="suggestions-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong>{list.length} suggested change{list.length === 1 ? '' : 's'}</strong>
          {conflicts > 0 && <span className="conflict-count">· {conflicts} conflict{conflicts === 1 ? '' : 's'}</span>}
          <ChevronDown size={15} className={open ? 'flip' : ''} />
        </button>
        <Button label="Discard suggestions (cannot be undone)" className="discard-button" disabled={dragging} onClick={discard}>
          <X size={15} /><span>Discard</span>
        </Button>
        <Button label="Accept suggestions (Return)" className="primary-pill accept-button" disabled={dragging} onClick={() => accept()}>
          <Check size={16} /><span>Accept</span>
        </Button>
      </div>
    </section>
  );
}
