/** Screen-space selection rectangle (Shift+drag on empty space), rendered by the DOM overlay. */
type Rect = { x0: number; y0: number; x1: number; y1: number } | null;
const listeners = new Set<() => void>();
let rect: Rect = null;

export const boxSelect = {
  get: () => rect,
  set(r: Rect) {
    rect = r;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
