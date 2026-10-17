import { create } from "zustand";
import type { RoomShell, SceneObject, SceneOp, SceneSpec } from "@house/contracts";
import { applyOp, invertOp, validateOp } from "@house/scene-engine";
import { sampleObjects, sampleRoomShell, sampleScene } from "../fixtures/sampleRoom";

export type SaveStatus = "saved" | "saving" | "offline";

const UNDO_STACK_LIMIT = 50;
const AUTOSAVE_DEBOUNCE_MS = 500;

interface SceneState {
  shell: RoomShell;
  scene: SceneSpec;
  selectedId: string | null;
  undoStack: SceneOp[];
  redoStack: SceneOp[];
  saveStatus: SaveStatus;
  lastError: string | null;

  select: (objectId: string | null) => void;
  getSelectedObject: () => SceneObject | undefined;

  /** Validate + apply one op, push its inverse onto the undo stack, schedule autosave. */
  commitOp: (op: SceneOp) => boolean;
  moveObject: (objectId: string, transform: SceneObject["transform"]) => boolean;
  deleteObject: (objectId: string) => boolean;
  setLock: (objectId: string, locked: boolean) => boolean;

  undo: () => void;
  redo: () => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutosave(set: (partial: Partial<SceneState>) => void, get: () => SceneState) {
  set({ saveStatus: "saving" });
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    // No backend yet (apps/api owns saveScenePatch per CONTRACTS.md §5) — this
    // is a local stand-in that just bumps the revision and marks saved.
    set({
      scene: { ...get().scene, revision: get().scene.revision + 1, updatedAt: new Date().toISOString() },
      saveStatus: "saved",
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}

export const useSceneStore = create<SceneState>((set, get) => ({
  shell: sampleRoomShell,
  scene: sampleScene,
  selectedId: null,
  undoStack: [],
  redoStack: [],
  saveStatus: "saved",
  lastError: null,

  select: (objectId) => set({ selectedId: objectId }),

  getSelectedObject: () => {
    const { scene, selectedId } = get();
    return scene.objects.find((o) => o.id === selectedId);
  },

  commitOp: (op) => {
    const { scene, shell } = get();
    const result = validateOp(scene, shell, op);
    if (!result.valid) {
      set({ lastError: result.errors.join("; ") });
      return false;
    }
    const inverse = invertOp(scene, op);
    set((state) => ({
      scene: applyOp(scene, op),
      undoStack: inverse ? [...state.undoStack, inverse].slice(-UNDO_STACK_LIMIT) : state.undoStack,
      redoStack: [],
      lastError: null,
    }));
    scheduleAutosave(set, get);
    return true;
  },

  moveObject: (objectId, transform) => get().commitOp({ type: "move", objectId, transform }),

  deleteObject: (objectId) => {
    const didDelete = get().commitOp({ type: "delete", objectId });
    if (didDelete && get().selectedId === objectId) set({ selectedId: null });
    return didDelete;
  },

  setLock: (objectId, locked) => get().commitOp({ type: "setLock", objectId, locked }),

  undo: () => {
    const { undoStack, scene, shell } = get();
    const op = undoStack[undoStack.length - 1];
    if (!op) return;
    const result = validateOp(scene, shell, op);
    if (!result.valid) return;
    const redoInverse = invertOp(scene, op);
    set((state) => ({
      scene: applyOp(scene, op),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: redoInverse ? [...state.redoStack, redoInverse] : state.redoStack,
    }));
    scheduleAutosave(set, get);
  },

  redo: () => {
    const { redoStack, scene, shell } = get();
    const op = redoStack[redoStack.length - 1];
    if (!op) return;
    const result = validateOp(scene, shell, op);
    if (!result.valid) return;
    const undoInverse = invertOp(scene, op);
    set((state) => ({
      scene: applyOp(scene, op),
      redoStack: state.redoStack.slice(0, -1),
      undoStack: undoInverse ? [...state.undoStack, undoInverse] : state.undoStack,
    }));
    scheduleAutosave(set, get);
  },
}));

export const initialObjectCount = sampleObjects.length;
