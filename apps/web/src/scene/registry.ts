import type { Group } from 'three';

/**
 * objectId → root Three group of each rendered instance. Imperative access for TransformControls,
 * overlays and drag validation without routing per-frame data through React/Zustand.
 */
const groups = new Map<string, Group>();
const listeners = new Set<() => void>();

export const registry = {
  get: (id: string) => groups.get(id),
  set(id: string, g: Group | null) {
    if (g) groups.set(id, g);
    else groups.delete(id);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};

/** Timestamp of the last drag release — a click right after it doesn't deselect. */
export const interaction = { lastDragEndAt: 0 };

/**
 * Ids whose groups a gesture is driving imperatively. Everything else eases toward its stored
 * transform each frame, so undo, discard and resolver moves glide instead of jumping.
 */
export const driven = new Set<string>();
