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

/** Timestamp of the last gizmo release — Canvas onPointerMissed ignores clicks right after it. */
export const interaction = { lastDragEndAt: 0 };
