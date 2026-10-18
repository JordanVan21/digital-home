/**
 * Editor policy — the one place drag, autosave, snapping and asset-budget behavior is tuned.
 */
export const EDITOR_POLICY = {
  /**
   * Edits are suggestions: drags, nudges and turns are never blocked. New conflicts show red live
   * and the draft's Accept resolves them (scene-engine resolveDraft).
   */
  /** Shift-drag grid for positions and heights (m). */
  gridSnapM: 0.1,
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
  autosaveDebounceMs: 500,
  /** Ignore empty-space clicks this long after a drag ends (release would deselect). */
  pointerMissedIgnoreMs: 150,
  /** A click selects only if the pointer moved less than this (px); beyond it a drag starts. */
  clickMaxDeltaPx: 3,
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
