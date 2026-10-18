import { describe, expect, it } from 'vitest';
import { bodyOf, expandCaseObject, expandCaseShell, normalizeShell, validateScene, type OpContext } from '@house/scene-engine';
import { contactGuides, wallSnap } from '../src/scene/interaction/snaps';

/** Merge check 3 (agent_docs/MERGE_INVENTORY.md §15): snapping to a wall ends flush, with no false collision. */
const shell = normalizeShell(expandCaseShell({ polygonXZ: [[-3, -3], [-3, 3], [3, 3], [3, -3]] }));
const ctx: OpContext = { shell };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('wall snap', () => {
  it('a sofa backed toward the west wall within reach snaps flush, shows a guide, and has no violations', () => {
    // Back face 4 cm from the wall (sofa depth 0.9, facing +X); the drag moves it 2 cm closer (within 3 cm).
    const sofa = expandCaseObject({ id: id(1), category: 'sofa', pos: [-3 + 0.45 + 0.04, 0, 0], yawDeg: 90, dims: [2, 0.85, 0.9] });
    const { delta, guides } = wallSnap(ctx, sofa, [-0.02, 0]);
    const x = sofa.transform.position[0] + delta[0];
    expect(Math.abs(x - 0.45 + 3)).toBeLessThan(1e-6); // back face exactly on the wall
    expect(guides.length).toBeGreaterThan(0);
    const snapped = { ...sofa, transform: { ...sofa.transform, position: [x, 0, sofa.transform.position[2] + delta[1]] as [number, number, number] } };
    expect(validateScene(ctx, { objects: [snapped] }).violations).toEqual([]);
  });

  it('pressed against another piece, a contact guide marks the touching side', () => {
    const chair = expandCaseObject({ id: id(2), category: 'chair', pos: [0, 0, 0], dims: [0.5, 0.9, 0.5] });
    const sofa = expandCaseObject({ id: id(3), category: 'sofa', pos: [1.25, 0, 0], dims: [2, 0.85, 0.9] });
    const [g] = contactGuides(chair, [bodyOf(sofa)]);
    expect(g!.from[0]).toBeCloseTo(0.25); // the chair's +X side, facing the sofa
    expect(g!.to[0]).toBeCloseTo(0.25);
    expect(Math.abs(g!.to[2] - g!.from[2])).toBeGreaterThan(0.5);
  });

  it('a piece 5 cm from the wall is left alone (you can place things close without them locking on)', () => {
    const sofa = expandCaseObject({ id: id(1), category: 'sofa', pos: [-3 + 0.45 + 0.07, 0, 0], yawDeg: 90, dims: [2, 0.85, 0.9] });
    const { delta, guides } = wallSnap(ctx, sofa, [-0.02, 0]);
    expect(delta).toEqual([-0.02, 0]);
    expect(guides).toEqual([]);
  });

  it('a piece facing the wall (wrong way round) does not snap', () => {
    const sofa = expandCaseObject({ id: id(1), category: 'sofa', pos: [-3 + 0.45 + 0.08, 0, 0], yawDeg: -90, dims: [2, 0.85, 0.9] });
    const { delta } = wallSnap(ctx, sofa, [-0.02, 0]);
    expect(delta).toEqual([-0.02, 0]);
  });
});
