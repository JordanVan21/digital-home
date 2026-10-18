import type { RefObject } from 'react';

/**
 * Stable mount point for drei <Html> labels (React 19 / drei 10). Without an explicit portal, <Html>
 * re-parents onto R3F's event container once pointer events connect, which unmounts its React root
 * mid-render ("Attempted to synchronously unmount a root…"). App points this at the canvas wrapper,
 * which covers exactly the same box as the canvas. Rules (from the codex sandbox): every <Html> passes
 * `portal={labelLayer}`, keeps a small `zIndexRange`, and never renders inside a Suspense fallback.
 */
export const labelLayer = { current: null } as unknown as RefObject<HTMLElement>;
