import { useEffect } from 'react';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { cameraAxisXZ } from '../scene/canvasBridge';
import {
  accept, deleteSelected, discard, duplicateSelected, frameCamera, groupSelected, nudge, nudgeVertical, redo, rotateSelectionBy, select,
  setMode, toggleLock, undo, ungroupSelected, useEditor,
} from '../state/store';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const DEG = Math.PI / 180;

/**
 * V select · G/T move · R rotate · Q/E turn 15° (Shift 90°) · arrows nudge 1 cm (Shift 10 cm,
 * camera-relative) · PageUp/PageDown raise/lower · F frame selection · Home frame room ·
 * P walk mode · Return accept suggestions · Esc deselect, then discard suggestions / exit walk · Delete/Backspace delete · L lock · Ctrl/Cmd+D duplicate ·
 * Ctrl/Cmd+G group (Shift: ungroup) · Ctrl/Cmd+Z undo · Shift+Ctrl/Cmd+Z or Ctrl+Y redo ·
 * hold Shift for 15° / 5 cm gizmo snaps. Ignored while typing; walk mode owns WASD/arrows.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') useEditor.setState({ snapping: true });
      if (isTyping(e.target)) return;
      const st = useEditor.getState();
      if (st.walkMode) {
        if (e.key.toLowerCase() === 'p') useEditor.setState({ walkMode: false });
        return; // WASD / arrows / Esc handled by walk mode
      }
      if (st.dragging) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); return; }
      if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
      if (mod || e.altKey) return;
      const step = e.shiftKey ? EDITOR_POLICY.nudgeBigM : EDITOR_POLICY.nudgeM;
      const ax = () => cameraAxisXZ();
      switch (e.key) {
        case 'ArrowUp': e.preventDefault(); { const a = ax(); nudge([a.forward[0] * step, a.forward[1] * step]); } return;
        case 'ArrowDown': e.preventDefault(); { const a = ax(); nudge([-a.forward[0] * step, -a.forward[1] * step]); } return;
        case 'ArrowRight': e.preventDefault(); { const a = ax(); nudge([a.right[0] * step, a.right[1] * step]); } return;
        case 'ArrowLeft': e.preventDefault(); { const a = ax(); nudge([-a.right[0] * step, -a.right[1] * step]); } return;
        case 'PageUp': e.preventDefault(); nudgeVertical(step); return;
        case 'PageDown': e.preventDefault(); nudgeVertical(-step); return;
        case 'Home': e.preventDefault(); frameCamera('room'); return;
        default:
      }
      switch (k) {
        case 'v': setMode('select'); break;
        case 'g':
        case 't': setMode('translate'); break;
        case 'r': setMode('rotate'); break;
        case 'q': rotateSelectionBy((e.shiftKey ? 90 : 15) * DEG); break;
        case 'e': rotateSelectionBy(-(e.shiftKey ? 90 : 15) * DEG); break;
        case 'f': frameCamera('selection'); break;
        case 'p': useEditor.setState({ walkMode: true, selectedIds: [], selectedId: null }); break;
        case 'l': toggleLock(); break;
        case 'enter': if (st.hasDraft) { e.preventDefault(); accept(); } break;
        case 'escape':
          if (st.selectedIds.length) select(null);
          else if (st.hasDraft) discard();
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          deleteSelected();
          break;
        default:
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') useEditor.setState({ snapping: false });
    };
    const blur = () => useEditor.setState({ snapping: false });
    const unload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().hasDraft) e.preventDefault();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}
