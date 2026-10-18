import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icon = {
  select: () => <Svg><path d="M5 3l14 8-6 1.5L10 19z" /></Svg>,
  move: () => <Svg><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" /></Svg>,
  rotate: () => <Svg><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v5h-5" /></Svg>,
  add: () => <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  duplicate: () => <Svg><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>,
  trash: () => <Svg><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></Svg>,
  lock: () => <Svg><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>,
  unlock: () => <Svg><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-2" /></Svg>,
  undo: () => <Svg><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></Svg>,
  redo: () => <Svg><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></Svg>,
  top: () => <Svg><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></Svg>,
  iso: () => <Svg><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></Svg>,
  eye: () => <Svg><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>,
  reset: () => <Svg><path d="M4 4v6h6" /><path d="M20 12A8 8 0 0 0 5.3 7.4L4 10" /><path d="M4 12a8 8 0 0 0 14.7 4.6" /></Svg>,
  chevron: ({ open }: { open?: boolean }) => <Svg><path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></Svg>,
  close: () => <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  walk: () => <Svg><circle cx="13" cy="4" r="2" /><path d="M10 22l2-7 3 3v6M9 12l3-4 4 2 2 4M8 13l-2 3" /></Svg>,
  frame: () => <Svg><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" /></Svg>,
  swap: () => <Svg><path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" /></Svg>,
  /** Collisions on: two blocks touching. */
  collide: () => <Svg><rect x="3" y="8" width="8" height="8" rx="1.5" /><rect x="13" y="8" width="8" height="8" rx="1.5" /><path d="M12 5v14" /></Svg>,
  /** Collisions off: overlapping blocks. */
  collideOff: () => <Svg><rect x="3" y="6" width="10" height="10" rx="1.5" /><rect x="10" y="9" width="10" height="10" rx="1.5" strokeDasharray="2.5 2" /><path d="M3 21L21 3" /></Svg>,
};
