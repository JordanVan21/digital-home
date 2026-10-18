import { useEffect } from 'react';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { cameraAxisXZ } from '../scene/canvasBridge';
import {
  deleteSelected, duplicateSelected, frameCamera, groupSelected, nudge, nudgeVertical, redo, rotateSelectionBy, select,
  setMode, toggleCollisions, toggleLock, undo, ungroupSelected, useEditor,
} from '../state/store';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

const DEG = Math.PI / 180;

/**
 * V select · G/T move · M 3D move · R rotate · C collisions on/off · Q/E turn 15° (Shift 90°) · arrows nudge 1 cm (Shift 10 cm,
 * camera-relative) · PageUp/PageDown raise/lower · F frame selection · Home frame room ·
 * P walk mode · Esc deselect / exit walk · Delete/Backspace delete · L lock · Ctrl/Cmd+D duplicate ·
 * Ctrl/Cmd+G group (Shift: ungroup) · Ctrl/Cmd+Z undo · Shift+Ctrl/Cmd+Z or Ctrl+Y redo ·
 * While dragging (sessions.ts): Shift = 10 cm grid · Alt = no snapping · Ctrl/Cmd = ignore collisions ·
 * scroll wheel = raise/lower. Ignored while typing; walk mode owns WASD/arrows.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
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
        case 'm': setMode('move3d'); break;
        case 'r': setMode('rotate'); break;
        case 'c': toggleCollisions(); break;
        case 'q': rotateSelectionBy((e.shiftKey ? 90 : 15) * DEG); break;
        case 'e': rotateSelectionBy(-(e.shiftKey ? 90 : 15) * DEG); break;
        case 'f': frameCamera('selection'); break;
        case 'p': useEditor.setState({ walkMode: true, selectedIds: [], selectedId: null }); break;
        case 'l': toggleLock(); break;
        case 'escape': select(null); break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          deleteSelected();
          break;
        default:
      }
    };
    window.addEventListener('keydown', down);
    return () => {
      window.removeEventListener('keydown', down);
    };
  }, []);
}
