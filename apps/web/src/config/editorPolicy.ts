/**
 * Editor policy — the one place drag-end, autosave, snapping and asset-budget behavior is tuned.
 */
import { DEFAULT_COLLISION_POLICY, type CollisionPolicy } from '@house/scene-engine';

export const EDITOR_POLICY = {
  /**
   * Collision policy while dragging / nudging / rotating: 'block-and-slide' (default) resolves
   * penetrations with minimum translation vectors so things slide along obstacles;
   * 'allow-with-warning' lets them overlap and flags the result. Holding Ctrl/Cmd ignores
   * collisions for one drag either way (result flagged).
   */
  collision: DEFAULT_COLLISION_POLICY as CollisionPolicy,
  /** Alignment snaps while dragging (Shift disables): capture distance (m). */
  smartSnapM: 0.05,
  /** Back-to-wall snap capture distance (m) and yaw tolerance (rad). */
  wallSnapM: 0.12,
  wallSnapYawRad: (10 * Math.PI) / 180,
  /** Nudge step (arrow keys / PageUp-Down), and with Shift. */
  nudgeM: 0.01,
  nudgeBigM: 0.1,
  /** Drag-time validation budget; slower ticks are logged (dev). */
  dragBudgetMs: 4,
  /**
   * Max number of lamps that cast shadows (the sun always does). Point-light shadows re-render the
   * scene into 6 cube faces each, so this is the biggest GPU cost on integrated graphics.
   * Overridable with ?lampShadows=N for benchmarking.
   */
  /** Evening preset: lamps are the key light, so one may cast shadows (≈−10 FPS on integrated GPUs). */
  eveningLampShadows: 1,
  maxLampShadows: (() => {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lampShadows') : null;
    return q !== null && Number.isFinite(Number(q)) ? Number(q) : 0;
  })(),
  /**
   * Drag-end policy. Error-severity violations (footprint outside the room, locked, …) snap the
   * object back with a toast; warning-severity violations (overlap, clearances, support) commit
   * and stay flagged.
   */
  dragEnd: { onError: 'snap-back', onWarning: 'commit-flagged' } as const,
  autosaveDebounceMs: 500,
  /** Ignore Canvas onPointerMissed this long after a gizmo drag ends (release would deselect). */
  pointerMissedIgnoreMs: 150,
  /** A click selects only if the pointer moved less than this (px) — orbit drags don't select. */
  clickMaxDeltaPx: 4,
  snap: { translateM: 0.05, rotateRad: (15 * Math.PI) / 180 },
  historyCap: 100,
  /** Fit: per-axis non-uniform scale allowed while max/min ratio ≤ 1 + this; else uniform fit-inside. */
  maxNonUniformScale: 0.15,
  /** Dev-only warning thresholds per GLB. */
  assetBudget: { maxBytes: 10 * 1024 * 1024, maxTriangles: 150_000 },
  /** Local decoder paths — nothing is fetched from a CDN at runtime. */
  dracoDecoderPath: '/decoders/draco/',
  hdrFile: '/hdr/warm-interior.hdr',
  /** Default mounting height (center) for wall items added from the library (m). */
  wallItemCenterHeightM: 1.45,
} as const;
