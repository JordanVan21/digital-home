import { create } from "zustand";
import type { RoomShell, SceneObject, SceneOp, SceneSpec } from "@house/contracts";
import { applyOp, invertOp, validateOp } from "@house/scene-engine";
import { sampleObjects, sampleRoomShell, sampleScene } from "../fixtures/sampleRoom";
import { makeLogEntry, type OpLogEntry, type OpSource } from "./opLog";

export type SaveStatus = "saved" | "saving" | "offline";

const UNDO_STACK_LIMIT = 50;
const OP_LOG_LIMIT = 200;
const AUTOSAVE_DEBOUNCE_MS = 500;

interface SceneState {
  shell: RoomShell;
  scene: SceneSpec;
  selectedId: string | null;
  undoStack: SceneOp[];
  redoStack: SceneOp[];
  saveStatus: SaveStatus;
  lastError: string | null;
  opLog: OpLogEntry[];

  select: (objectId: string | null) => void;
  getSelectedObject: () => SceneObject | undefined;

  /** Validate + apply one op, push its inverse onto the undo stack, schedule autosave. */
  commitOp: (op: SceneOp) => boolean;
  moveObject: (objectId: string, transform: SceneObject["transform"]) => boolean;
  deleteObject: (objectId: string) => boolean;
  setLock: (objectId: string, locked: boolean) => boolean;
  duplicateObject: (objectId: string) => boolean;

  /** Not a SceneOp (CONTRACTS.md's op union has no scene-level settings op) —
   * a direct room-setting edit, not an undoable object operation. */
  setLightingPreset: (preset: string) => void;

  /** Replace the working room with a freshly imported scan (clears history). */
  loadImportedRoom: (shell: RoomShell, scene: SceneSpec) => void;

  undo: () => void;
  redo: () => void;
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Every committed op is logged here, regardless of caller (gizmo drag,
 * coordinates popup, undo/redo). This is the client-side stand-in for the
 * optional `scene_operations` durable log in SYSTEM_ARCHITECTURE.md §6.1 —
 * the same op shape an agent planner will eventually write.
 */
function appendLog(
  set: (partial: Partial<SceneState>) => void,
  get: () => SceneState,
  sceneBefore: SceneSpec,
  op: SceneOp,
  source: OpSource
) {
  const entry = makeLogEntry(sceneBefore, op, source);
  // eslint-disable-next-line no-console
  console.log(`[scene-op:${source}]`, entry.summary, entry.op);
  set({ opLog: [entry, ...get().opLog].slice(0, OP_LOG_LIMIT) });
}

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
  opLog: [],

  select: (objectId) => set({ selectedId: objectId }),

  loadImportedRoom: (shell, scene) => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    set({ shell, scene, selectedId: null, undoStack: [], redoStack: [], opLog: [], lastError: null, saveStatus: "saved" });
  },

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
    appendLog(set, get, scene, op, "user");
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

  duplicateObject: (objectId) => {
    const source = get().scene.objects.find((o) => o.id === objectId);
    if (!source) return false;
    const clone: SceneObject = {
      ...source,
      id: crypto.randomUUID(),
      locked: false,
      transform: {
        ...source.transform,
        // Offset by the object's own width, not a flat nudge — a flat
        // offset would land the duplicate overlapping the original now
        // that object-object overlap is validated (see scene-engine).
        position: [
          source.transform.position[0] + source.dimensionsM[0] + 0.15,
          source.transform.position[1],
          source.transform.position[2],
        ],
      },
    };
    const didAdd = get().commitOp({ type: "add", object: clone });
    if (didAdd) set({ selectedId: clone.id });
    return didAdd;
  },

  setLightingPreset: (preset) => {
    set((state) => ({ scene: { ...state.scene, lightingPreset: preset } }));
    scheduleAutosave(set, get);
  },

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
    appendLog(set, get, scene, op, "undo");
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
    appendLog(set, get, scene, op, "redo");
    scheduleAutosave(set, get);
  },
}));

export const initialObjectCount = sampleObjects.length;
