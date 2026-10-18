import { describe, expect, it } from 'vitest';
import type { SceneObject, SceneSpec } from '@house/contracts';
import {
  bodyOf, expandCaseObject, expandCaseShell, makeTransform, normalizeShell, resolveTranslation, validateScene, wallBodies,
  type CaseObject, type OpContext,
} from '../src';

/**
 * The collision checks agreed for the jordan + codex merge (agent_docs/MERGE_INVENTORY.md §3, §15):
 * jordan's collision is the base (flush walls and corners), codex's exceptions are plugged in.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shell = normalizeShell(expandCaseShell({ polygonXZ: [[-3, -3], [-3, 3], [3, 3], [3, -3]] }));
const ctx: OpContext = { shell };
const obj = (n: number, c: Omit<CaseObject, 'id'>, parent?: number): SceneObject =>
  expandCaseObject({ ...c, id: id(n), ...(parent !== undefined ? { parentId: id(parent) } : {}) });
const scene = (objects: SceneObject[]): Pick<SceneSpec, 'objects'> => ({ objects });
const at = (o: SceneObject, x: number, y: number, z: number, yawDeg = 0): SceneObject => ({ ...o, transform: makeTransform([x, y, z], (yawDeg * Math.PI) / 180) });

describe('merge check 1: flush against a wall and into a corner shows no collision', () => {
  // A 2 × 0.9 m sofa facing +X (back toward the west wall at x = −3).
  const sofa = obj(1, { category: 'sofa', pos: [0, 0, 0], yawDeg: 90, dims: [2, 0.85, 0.9] });

  it('pushed west, it stops flush on the wall (within 1 mm) with no violations', () => {
    const r = resolveTranslation([bodyOf(sofa)], wallBodies(shell), [0, 0], [-4, 0]);
    expect(r.blockers.some((b) => b.wall)).toBe(true);
    const moved = at(sofa, r.offset[0], 0, r.offset[1], 90);
    expect(moved.transform.position[0] - 0.45).toBeCloseTo(-3, 2); // back face on the wall
    expect(Math.abs(moved.transform.position[0] - 0.45 + 3)).toBeLessThan(0.002);
    expect(validateScene(ctx, scene([moved])).violations).toEqual([]);
  });

  it('pushed diagonally into the south-west corner, it ends touching both walls with no violations', () => {
    const r = resolveTranslation([bodyOf(sofa)], wallBodies(shell), [0, 0], [-4, -4]);
    const moved = at(sofa, r.offset[0], 0, r.offset[1], 90);
    const [x, , z] = moved.transform.position;
    expect(Math.abs(x - 0.45 + 3)).toBeLessThan(0.002); // west wall
    expect(Math.abs(z - 1 + 3)).toBeLessThan(0.002); // south wall (half length 1 m)
    expect(validateScene(ctx, scene([moved])).violations).toEqual([]);
  });
});

describe('merge check 2: a vase on a table never collides with the table, but does with another item on it', () => {
  const table = obj(1, { category: 'coffee_table', pos: [0, 0, 0], dims: [1.2, 0.45, 0.6] });
  const vase = obj(2, { category: 'vase', pos: [-0.2, 0.45, 0], dims: [0.15, 0.3, 0.15] }, 1);
  const bowl = obj(3, { category: 'bowl', pos: [0.3, 0.45, 0], dims: [0.2, 0.08, 0.2] }, 1);

  it('resting on the table: no violations at all', () => {
    expect(validateScene(ctx, scene([table, vase, bowl])).violations).toEqual([]);
  });

  it('dragged across the top into the bowl: blocked by the bowl only (the table is its support)', () => {
    const r = resolveTranslation([bodyOf(vase)], [bodyOf(bowl)], [0, 0], [0.5, 0]);
    expect(r.blockers.map((b) => b.otherId)).toEqual([bowl.id]);
    expect(r.offset[0]).toBeCloseTo(0.325, 2); // stops touching the bowl (0.075 + 0.1 from its centre)
  });

  it('overlapping the bowl is flagged against the bowl, never against the table', () => {
    const overlapping = at(vase, 0.25, 0.45, 0);
    const v = validateScene(ctx, scene([table, overlapping, bowl])).violations.filter((x) => x.rule === 'overlap');
    expect(v).toHaveLength(1);
    expect([v[0]!.objectId, v[0]!.otherId].sort()).toEqual([vase.id, bowl.id].sort());
  });
});

describe('codex collision exception: wall-mounted items vs furniture', () => {
  // A picture on the west wall (back on the wall, facing +X) and a cabinet pushed under it.
  const art = obj(1, { category: 'wall_art', support: 'wall', pos: [-3 + 0.015, 0.7, 0], yawDeg: 90, dims: [0.8, 0.6, 0.03] });
  const cabinet = obj(2, { category: 'cabinet', pos: [-3 + 0.22, 0, 0], yawDeg: 90, dims: [1.6, 0.9, 0.44] });
  const art2 = obj(3, { category: 'wall_art', support: 'wall', pos: [-3 + 0.015, 0.8, 0.3], yawDeg: 90, dims: [0.8, 0.6, 0.03] });

  it('a picture may hang over a cabinet (no collision, no block)', () => {
    expect(validateScene(ctx, scene([art, cabinet])).violations.filter((v) => v.rule === 'overlap')).toEqual([]);
    const r = resolveTranslation([bodyOf(cabinet)], [bodyOf(art)], [0, 0], [0, 0.4]);
    expect(r.blockers).toEqual([]);
  });

  it('two wall items still collide with each other', () => {
    expect(validateScene(ctx, scene([art, art2])).violations.some((v) => v.rule === 'overlap')).toBe(true);
  });
});
