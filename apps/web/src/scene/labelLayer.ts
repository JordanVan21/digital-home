import type { RefObject } from "react";
/**
 * Stable mount point for drei <Html> labels. Without an explicit portal, <Html>
 * re-parents onto R3F's event container once pointer events connect, which
 * unmounts its React root mid-render. SceneCanvas points this at its wrapper,
 * which covers exactly the same box as the canvas.
 */
export const labelLayer = {
  current: null,
} as unknown as RefObject<HTMLElement>;
