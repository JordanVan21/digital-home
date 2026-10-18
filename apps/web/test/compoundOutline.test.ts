import { describe, expect, it } from 'vitest';
import { compoundExteriorPositions } from '../src/scene/compoundOutline';

const segments = (p: Float32Array) => p.length / 6;

describe('compound collider outline (ported from the codex sandbox)', () => {
  it('a single box draws its 12 edges', () => {
    expect(segments(compoundExteriorPositions([[[0, 0, 0], [1, 1, 1]]]))).toBe(12);
  });

  it('two touching boxes forming one box draw no seam', () => {
    expect(segments(compoundExteriorPositions([[[0, 0, 0], [1, 1, 1]], [[1, 0, 0], [2, 1, 1]]]))).toBe(12);
  });

  it('an L-shape draws its exterior creases only', () => {
    const p = compoundExteriorPositions([[[0, 0, 0], [2, 1, 1]], [[0, 0, 1], [1, 1, 2]]]);
    expect(segments(p)).toBe(18);
  });
});
