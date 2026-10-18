import type { Vec3 } from '@house/contracts';
import type { Blocker, Violation } from '@house/scene-engine';

/**
 * Transient drag preview state. Lives outside Zustand: written at most once per frame during a
 * drag, read imperatively by overlays (useFrame) and by small labels via useSyncExternalStore.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export type Guide = { from: Vec3; to: Vec3 };
export type HeightReadout = { at: Vec3; baseY: number; floorY: number; surfaceY: number; surfaceLabel: string | null; down: Vec3 };

type FeedbackState = {
  objectId: string | null;
  violations: Violation[];
  blockers: Blocker[];
  guides: Guide[];
  height: HeightReadout | null;
  note: string | null;
  /** The face the dragged piece is snapped onto (codex snap guide). */
  surface: { y: number; polygon: [number, number][] } | null;
  /** Live swivel angle, shown at the ring handle. */
  angle: string | null;
};

type DragFeedback = FeedbackState & {
  signature: string;
  set(patch: Partial<FeedbackState>): void;
  clear(): void;
  subscribe(l: Listener): () => void;
};

export const dragFeedback: DragFeedback = {
  objectId: null as string | null,
  /** Live violations of the dragged object (e.g. when collisions are ignored with Ctrl). */
  violations: [] as Violation[],
  /** Obstacles currently blocking the drag (block-and-slide), outlined red with a reason. */
  blockers: [] as Blocker[],
  /** Alignment guide lines (floor-level). */
  guides: [] as Guide[],
  /** Vertical move readout. */
  height: null as HeightReadout | null,
  /** Short text shown near the dragged object (e.g. "Collisions off"). */
  note: null as string | null,
  surface: null as FeedbackState['surface'],
  angle: null as string | null,
  signature: '',
  set(patch) {
    Object.assign(this, patch);
    const h = this.height;
    const sig = [
      this.objectId ?? '',
      this.violations.map((v) => `${v.rule}:${v.otherId ?? ''}`).join(','),
      this.blockers.map((b) => b.otherId).join(','),
      this.guides.map((g) => `${g.from.map((n) => n.toFixed(3))}`).join(';'),
      h ? `${h.baseY.toFixed(3)}|${h.surfaceY.toFixed(3)}` : '',
      this.note ?? '',
      this.surface ? `${this.surface.y.toFixed(3)}:${this.surface.polygon[0]?.join(',')}` : '',
      this.angle ?? '',
    ].join('#');
    if (sig !== this.signature) {
      this.signature = sig;
      notify();
    }
  },
  clear() {
    this.set({ objectId: null, violations: [], blockers: [], guides: [], height: null, note: null, surface: null, angle: null });
  },
  subscribe(l) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
