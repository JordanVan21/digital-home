import { describe, expect, it } from 'vitest';
import type { SceneObject, SceneSpec } from '@house/contracts';
import {
  angleDiff, applyOps, bodyAt, bodyOf, ceilingPose, deleteWithSettle, emptyHistory, expandCaseObject, expandCaseShell,
  findSupport, GridBroadPhase, groupTransformOps, makeTransform, moveWithSupport, normalizeShell, pushHistory,
  resolveTranslation, settleTarget, transformAbout, undo, validateScene, wallBodies, wallPose, YawDial,
  type Body, type CaseObject, type OpContext,
} from '../src';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shell = normalizeShell(expandCaseShell({ polygonXZ: [[-3, -3], [-3, 3], [3, 3], [3, -3]] }));
const ctx: OpContext = { shell };
const obj = (n: number, c: Omit<CaseObject, 'id'>, parent?: number): SceneObject =>
  expandCaseObject({ ...c, id: id(n), ...(parent !== undefined ? { parentId: id(parent) } : {}) });
const scene = (objects: SceneObject[]): SceneSpec => ({
  schemaVersion: 1, id: id(900), roomId: id(901), shellId: shell.id, revision: 0, objects, lightingPreset: 'day', updatedAt: '2026-10-17T00:00:00.000Z',
});
const get = (s: SceneSpec, n: number) => s.objects.find((o) => o.id === id(n))!;
const apply = (s: SceneSpec, ops: Parameters<typeof applyOps>[2]) => {
  const r = applyOps({ ...ctx, geometry: 'report' }, s, ops);
  if (!r.ok) throw new Error(`${r.error.reason}: ${r.error.message}`);
  return r;
};
const byIdMap = (s: SceneSpec) => Object.fromEntries(s.objects.map((o) => [o.id, o]));
const DEG = Math.PI / 180;

describe('yaw continuity', () => {
  for (const dir of [1, -1]) {
    it(`spins ${dir > 0 ? 'counter-clockwise' : 'clockwise'} through two full turns with no jumps`, () => {
      const start = 3.0; // just below +180°, so the first steps cross ±π
      const dial = new YawDial(start, 0);
      let prev = start;
      for (let i = 1; i <= 144; i++) {
        dial.update(Math.atan2(Math.sin(dir * i * 5 * DEG), Math.cos(dir * i * 5 * DEG))); // pointer bearing wraps at ±π
        const y = dial.yaw();
        expect(angleDiff(prev, y)).toBeCloseTo(5 * DEG, 9);
        expect(y).toBeGreaterThan(-Math.PI - 1e-12);
        expect(y).toBeLessThanOrEqual(Math.PI + 1e-12);
        prev = y;
      }
      expect(dial.accumulated).toBeCloseTo(dir * 4 * Math.PI, 9);
      expect(angleDiff(dial.yaw(), start)).toBeCloseTo(0, 9);
    });
  }

  it('snaps the accumulated angle to 15° steps', () => {
    const dial = new YawDial(0, 0);
    dial.update(22 * DEG);
    expect(dial.yaw(15 * DEG)).toBeCloseTo(15 * DEG, 9);
    dial.update(170 * DEG);
    dial.update(-170 * DEG); // crosses the seam: +20° more
    expect(dial.yaw(15 * DEG)).toBeCloseTo(-165 * DEG, 9);
  });
});

describe('vase on a table', () => {
  const table = obj(1, { category: 'coffee_table', pos: [0, 0, 0], dims: [1, 0.45, 0.6] });
  const vase = obj(2, { category: 'vase', pos: [1.5, 0, 0], dims: [0.15, 0.3, 0.15] });
  const s0 = scene([table, vase]);

  it('drops onto the table top, rests on it without colliding, slides off the edge and falls, and goes back', () => {
    // Drag over the table (pointer ray hits the top surface): land on it, become its child.
    const hit = findSupport(s0.objects, vase, {}, { point: [0.1, 0] });
    expect(hit).toEqual({ ownerId: table.id, surfaceId: 'top', y: 0.45 });
    let s = apply(s0, moveWithSupport(ctx, s0, vase.id, makeTransform([0.1, 0.45, 0], 0), { support: hit })).scene;
    expect(get(s, 2).placement).toEqual({ support: 'object', parentId: table.id });
    expect(validateScene(ctx, s).violations).toEqual([]);

    // Moving around on the table stays on it (settle finds the same surface).
    s = apply(s, moveWithSupport(ctx, s, vase.id, makeTransform([-0.3, 0.45, 0.1], 0))).scene;
    expect(get(s, 2).placement?.parentId).toBe(table.id);
    expect(get(s, 2).transform.position[1]).toBeCloseTo(0.45);

    // Pushed off the edge: detaches and settles to the floor.
    s = apply(s, moveWithSupport(ctx, s, vase.id, makeTransform([0.8, 0.45, 0], 0))).scene;
    expect(get(s, 2).placement).toEqual({ support: 'floor' });
    expect(get(s, 2).transform.position[1]).toBe(0);
    expect(validateScene(ctx, s).violations).toEqual([]);

    // Lifted (Alt) above the table and released: settles back onto the top.
    s = apply(s, moveWithSupport(ctx, s, vase.id, makeTransform([0, 0.7, 0], 0))).scene;
    expect(get(s, 2).placement?.parentId).toBe(table.id);
    expect(get(s, 2).transform.position[1]).toBeCloseTo(0.45);
  });

  it('collides with another item on the same table, never with the table itself', () => {
    const a = obj(3, { category: 'vase', pos: [0, 0.45, 0], dims: [0.15, 0.3, 0.15] }, 1);
    const b = obj(4, { category: 'vase', pos: [0.5, 0.45, 0], dims: [0.15, 0.3, 0.15] }, 1);
    // Drag b toward a across the table top; obstacles exclude b's support (the table).
    const obstacles = [bodyOf(a)];
    const r = resolveTranslation([bodyOf(b)], obstacles, [0, 0], [-0.5, 0]);
    expect(r.offset[0]).toBeCloseTo(-0.35, 2); // stops touching a (0.15 apart), not inside it
    expect(r.blockers.map((x) => x.otherId)).toEqual([a.id]);
    const moved = { ...b, transform: makeTransform([0.5 + r.offset[0], 0.45, 0], 0) };
    expect(validateScene(ctx, scene([table, a, moved])).violations).toEqual([]);
  });
});

describe('multi-level stacks', () => {
  const table = obj(1, { category: 'coffee_table', pos: [0, 0, 0], dims: [1, 0.45, 0.6] });
  const book1 = obj(2, { category: 'book', pos: [0.2, 0.45, 0], tilt: { x: 1, z: 0 }, dims: [0.16, 0.24, 0.03] }, 1);
  const book2 = obj(3, { category: 'book', pos: [0.2, 0.48, 0], tilt: { x: 1, z: 0 }, dims: [0.15, 0.22, 0.03] }, 2);
  const bowl = obj(4, { category: 'bowl', pos: [0.2, 0.51, 0], dims: [0.12, 0.05, 0.12] }, 3);
  const s0 = scene([table, book1, book2, bowl]);

  it('the stack is valid', () => {
    expect(validateScene(ctx, s0).violations).toEqual([]);
  });

  it('moving and rotating the table carries every level; undo is exact', () => {
    let h = emptyHistory();
    const mOps = moveWithSupport(ctx, s0, table.id, makeTransform([1, 0, 0.5], 0));
    const m = apply(s0, mOps);
    h = pushHistory(h, { label: 'move', forward: mOps, inverse: m.inverse });
    expect(get(m.scene, 4).transform.position).toEqual([1.2, 0.51, 0.5]);
    const rOps = moveWithSupport(ctx, m.scene, table.id, transformAbout(get(m.scene, 1), [0, 0], Math.PI / 2, [1, 0.5]));
    const r = apply(m.scene, rOps);
    h = pushHistory(h, { label: 'rotate', forward: rOps, inverse: r.inverse });
    // Bowl was 0.2 along the table's +X; after +90° yaw, local +X maps to world −Z.
    expect(get(r.scene, 4).transform.position[0]).toBeCloseTo(1, 9);
    expect(get(r.scene, 4).transform.position[2]).toBeCloseTo(0.3, 9);
    expect(validateScene(ctx, r.scene).violations).toEqual([]);
    const u1 = undo(ctx, r.scene, h);
    if (!u1.ok) throw new Error();
    const u2 = undo(ctx, u1.scene, u1.history);
    if (!u2.ok) throw new Error();
    expect(byIdMap(u2.scene)).toEqual(byIdMap(s0));
  });

  it('deleting the table settles the books (with the bowl) to the floor in one undoable entry', () => {
    const d = deleteWithSettle(ctx, s0, table.id);
    if (!d.ok) throw new Error(d.error.message);
    const r = apply(s0, d.ops);
    expect(get(r.scene, 2).transform.position[1]).toBe(0);
    expect(get(r.scene, 2).placement).toEqual({ support: 'floor' });
    expect(get(r.scene, 3).transform.position[1]).toBeCloseTo(0.03);
    expect(get(r.scene, 3).placement?.parentId).toBe(book1.id);
    expect(get(r.scene, 4).transform.position[1]).toBeCloseTo(0.06);
    expect(validateScene(ctx, r.scene).violations).toEqual([]);
    const back = apply(r.scene, r.inverse);
    expect(byIdMap(back.scene)).toEqual(byIdMap(s0));
  });

  it('deleting is refused when something on it is locked', () => {
    const locked = scene([table, book1, { ...book2, locked: true }, bowl]);
    const d = deleteWithSettle(ctx, locked, table.id);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.reason).toBe('CHILD_LOCKED');
  });
});

describe('chair under a desk', () => {
  it('slides in until the back meets the desk top, then stops', () => {
    const desk = obj(1, { category: 'desk', pos: [0, 0, 0], dims: [1.2, 0.75, 0.7] });
    const chair = obj(2, { category: 'chair', pos: [0, 0, 1.2], yawDeg: 180, dims: [0.45, 0.95, 0.5] });
    const r = resolveTranslation([bodyOf(chair)], [bodyOf(desk), ...wallBodies(shell)], [0, 0], [0, -1.2]);
    const z = 1.2 + r.offset[1];
    // Back slab spans the chair's rear 7 cm (+Z side when facing −Z): it stops at the top's edge (z = 0.35).
    expect(z).toBeGreaterThan(0.1);
    expect(z).toBeLessThan(0.2);
    const tucked = { ...chair, transform: makeTransform([0, 0, z], Math.PI) };
    expect(validateScene(ctx, scene([desk, tucked])).violations).toEqual([]);
  });
});

describe('slide, don\'t stick', () => {
  const cab = obj(1, { category: 'cabinet', pos: [0, 0, 0], dims: [0.5, 0.5, 0.5] });

  it('ends against a wall and keeps sliding along it', () => {
    const r = resolveTranslation([bodyOf(cab)], wallBodies(shell), [0, 0], [3.5, 1]);
    expect(r.offset[0]).toBeCloseTo(2.75, 2);
    expect(r.offset[1]).toBeCloseTo(1, 2);
    expect(r.blockers[0]?.wall).toBe(true);
  });

  it('ends against a sofa and slides along its edge', () => {
    const sofa = obj(2, { category: 'sofa', pos: [0, 0, 0], dims: [2, 0.8, 0.9] });
    const box = obj(3, { category: 'cabinet', pos: [0, 0, 2], dims: [0.5, 0.5, 0.5] });
    const r = resolveTranslation([bodyOf(box)], [bodyOf(sofa)], [0, 0], [0.5, -2]);
    expect(2 + r.offset[1]).toBeCloseTo(0.7, 2);
    expect(r.offset[0]).toBeCloseTo(0.5, 2);
  });

  it('does not tunnel through a thin obstacle on a big jump', () => {
    const panel = obj(2, { category: 'cabinet', pos: [0, 0, 0], dims: [0.04, 1, 2] });
    const box = obj(3, { category: 'cabinet', pos: [-1, 0, 0], dims: [0.5, 0.5, 0.5] });
    const r = resolveTranslation([bodyOf(box)], [bodyOf(panel)], [0, 0], [2, 0]);
    expect(-1 + r.offset[0]).toBeLessThanOrEqual(-0.27 + 1e-3);
  });

  it('moves a group as a whole: no member ends inside the obstacle', () => {
    const sofa = obj(2, { category: 'sofa', pos: [0, 0, 0], dims: [2, 0.8, 0.9] });
    const a = obj(3, { category: 'cabinet', pos: [-0.4, 0, 2], dims: [0.5, 0.5, 0.5] });
    const b = obj(4, { category: 'cabinet', pos: [0.4, 0, 2.6], dims: [0.5, 0.5, 0.5] });
    const r = resolveTranslation([bodyOf(a), bodyOf(b)], [bodyOf(sofa)], [0, 0], [0, -2.5]);
    const za = 2 + r.offset[1];
    expect(za).toBeCloseTo(0.7, 2); // the leading member touches
    const moved = [a, b].map((o) => ({ ...o, transform: makeTransform([o.transform.position[0], 0, o.transform.position[2] + r.offset[1]], 0) }));
    expect(validateScene(ctx, scene([sofa, ...moved])).violations).toEqual([]);
    // groupTransformOps produces one move per root; applying them keeps the arrangement.
    const s = scene([sofa, a, b]);
    const ops = groupTransformOps(ctx, s, [a.id, b.id], r.offset, 0, [0, 0]);
    const after = apply(s, ops).scene;
    expect(get(after, 4).transform.position[2] - get(after, 3).transform.position[2]).toBeCloseTo(0.6, 9);
  });
});

describe('gravity', () => {
  const shelf = obj(1, { category: 'shelf', pos: [0, 0, 0], dims: [1, 1.6, 0.35] });
  const table = obj(2, { category: 'coffee_table', pos: [2, 0, 0], dims: [1, 0.45, 0.6] });
  const vase = (pos: [number, number, number], float = false) => obj(3, { category: 'vase', pos, dims: [0.15, 0.3, 0.15], float });

  it('settles onto the highest shelf board below it', () => {
    const v = vase([0.1, 1.0, 0]);
    expect(settleTarget([shelf, table, v], v)).toEqual({ ownerId: shelf.id, surfaceId: 'board-2', y: 0.8 });
  });

  it('settles onto a table top, or the floor when nothing is below', () => {
    expect(settleTarget([shelf, table], vase([2, 1.0, 0]))?.ownerId).toBe(table.id);
    expect(settleTarget([shelf, table], vase([-2, 1.0, 1]))).toEqual({ ownerId: null, surfaceId: 'floor', y: 0 });
  });

  it('won\'t fit a tall item into a short shelf gap (but the open top board takes it)', () => {
    const tall = obj(3, { category: 'vase', pos: [0.1, 1.0, 0], dims: [0.15, 0.5, 0.15] });
    expect(settleTarget([shelf, tall], tall)?.surfaceId).toBe('floor');
    const above = obj(3, { category: 'vase', pos: [0.1, 1.7, 0], dims: [0.15, 0.5, 0.15] });
    expect(settleTarget([shelf, above], above)).toEqual({ ownerId: shelf.id, surfaceId: 'board-4', y: 1.6 });
  });

  it('Float disables settling', () => {
    const v = vase([2, 1.0, 0], true);
    expect(settleTarget([table, v], v)).toBeNull();
    const ops = moveWithSupport(ctx, scene([table, v]), v.id, makeTransform([2, 1.2, 0], 0));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'move', transform: { position: [2, 1.2, 0] } });
  });
});

describe('wall and ceiling items', () => {
  it('a wall item dragged past a corner moves onto the adjacent wall', () => {
    const dims: [number, number, number] = [0.6, 0.5, 0.04];
    const onNorth = wallPose(shell, dims, [2.0, -2.9], 1.4)!;
    expect(onNorth.yaw).toBeCloseTo(0, 9); // north wall (z = −3) faces +Z
    const pastCorner = wallPose(shell, dims, [2.95, -2.3], 1.4)!;
    expect(pastCorner.yaw).toBeCloseTo(-Math.PI / 2, 9); // east wall (x = 3) faces −X
    expect(pastCorner.position[0]).toBeCloseTo(3 - 0.02, 9);
  });

  it('ceiling items hang below the ceiling within limits', () => {
    const p = ceilingPose(shell, [0.4, 0.5, 0.4], [0, 0], 5);
    expect(p.position[1]).toBeCloseTo(0.6); // clamped: bottom ≥ 0.6 m above the floor
    const q = ceilingPose(shell, [0.4, 0.5, 0.4], [0, 0], -1);
    expect(q.position[1] + 0.5).toBeCloseTo(2.6); // top at the ceiling
  });
});

describe('broad-phase', () => {
  it('returns only nearby bodies and re-bins only changed ones', () => {
    const bodies: Body[] = [0, 1, 2, 3].map((i) => bodyOf(obj(10 + i, { category: 'cabinet', pos: [i * 2 - 3, 0, 0], dims: [0.5, 0.5, 0.5] })));
    const g = new GridBroadPhase(1);
    g.sync(bodies);
    expect(g.query([-3.3, 0, -0.3], [-2.7, 1, 0.3]).map((b) => b.id)).toEqual([bodies[0]!.id]);
    const moved = bodyAt({ ...obj(10, { category: 'cabinet', pos: [1, 0, 0], dims: [0.5, 0.5, 0.5] }) });
    g.sync([moved, ...bodies.slice(1)]);
    expect(g.query([-3.3, 0, -0.3], [-2.7, 1, 0.3])).toEqual([]);
    expect(g.query([0.8, 0, -0.1], [1.2, 1, 0.1]).map((b) => b.id).sort()).toEqual([bodies[0]!.id, bodies[2]!.id].sort());
  });
});

describe('absolute angle snapping (codex)', () => {
  it('Shift-swivel lands on the 15° grid from any starting angle', async () => {
    const { YawDial: Dial } = await import('../src');
    const from = 7 * DEG;
    const dial = new Dial(0, 0);
    dial.update(9 * DEG); // turned 9°: 16° → nearest grid angle is 15°
    expect((from + dial.delta(from, 15 * DEG)) / DEG).toBeCloseTo(15, 9);
    dial.update(20 * DEG); // turned 20°: 27° → 30°
    expect((from + dial.delta(from, 15 * DEG)) / DEG).toBeCloseTo(30, 9);
    expect(dial.delta(from)).toBeCloseTo(20 * DEG, 12); // free swivel is unchanged
  });

  it('steps move to the next grid angle (7° → 15° → 30°; down from 7° → 0°)', async () => {
    const { stepYaw } = await import('../src');
    expect(stepYaw(7 * DEG, 1, 15 * DEG) / DEG).toBeCloseTo(15, 9);
    expect(stepYaw(15 * DEG, 1, 15 * DEG) / DEG).toBeCloseTo(30, 9);
    expect(stepYaw(7 * DEG, -1, 15 * DEG) / DEG).toBeCloseTo(0, 9);
    expect(Math.abs(stepYaw(170 * DEG, 1, 15 * DEG)) / DEG).toBeCloseTo(180, 9);
  });
});
