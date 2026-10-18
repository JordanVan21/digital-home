import { describe, expect, it } from 'vitest';
import { releaseSettles } from '../src/state/store';

/** Tryout switch for letting go of a piece (MERGE_INVENTORY §14). */
describe('release modes', () => {
  it("'mix': ordinary drags fall, deliberately raised pieces stay up", () => {
    expect(releaseSettles(false, 'mix')).toBe(true);
    expect(releaseSettles(true, 'mix')).toBe(false);
  });
  it("'fall': everything falls", () => {
    expect(releaseSettles(false, 'fall')).toBe(true);
    expect(releaseSettles(true, 'fall')).toBe(true);
  });
  it("'stay': nothing falls (codex)", () => {
    expect(releaseSettles(false, 'stay')).toBe(false);
    expect(releaseSettles(true, 'stay')).toBe(false);
  });
});
