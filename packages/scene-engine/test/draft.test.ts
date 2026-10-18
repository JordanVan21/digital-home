import { describe, expect, it } from 'vitest';
import type { SceneObject, SceneOp, SceneSpec } from '@house/contracts';
import {
  applyOps, diffScenes, diffToOps, expandCaseAsset, expandCaseObject, expandCaseShell, makeTransform, normalizeShell,
  resolveDraft, stableStringify, type CaseObject, type OpContext,
} from '../src';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const shell = normalizeShell(expandCaseShell({ polygonXZ: [[-3, -3], [-3, 3], [3, 3], [3, -3]] }));
const assets = new Map([
  expandCaseAsset({ id: id(500), category: 'sofa', dimensionsM: [2, 0.8, 0.9] }),
  expandCaseAsset({ id: id(501), category: 'sofa', dimensionsM: [1.8, 0.85, 0.95] }),
].map((a) => [a.id, a]));
const ctx: OpContext = { shell, assets: (a) => assets.get(a) };
const obj = (n: number, c: Omit<CaseObject, 'id'>, parent?: number): SceneObject =>
  expandCaseObject({ ...c, id: id(n), ...(parent !== undefined ? { parentId: id(parent) } : {}) });
const scene = (objects: SceneObject[]): SceneSpec => ({
  schemaVersion: 1, id: id(900), roomId: id(901), shellId: shell.id, revision: 3, objects, lightingPreset: 'day', updatedAt: '2026-10-17T00:00:00.000Z',
});
const get = (s: SceneSpec, n: number) => s.objects.find((o) => o.id === id(n))!;
/** Apply ops as a draft would: geometry conflicts allowed. */
const draftOf = (s: SceneSpec, ops: SceneOp[]) => {
  const r = applyOps({ ...ctx, geometry: 'report' }, s, ops);
  if (!r.ok) throw new Error(`${r.error.reason}: ${r.error.message}`);
  return r.scene;
};
const canon = (s: SceneSpec) => stableStringify([...s.objects].sort((a, b) => a.id.localeCompare(b.id)));
const move = (o: SceneObject, x: number, z: number, yawDeg = 0): SceneOp => ({
  type: 'move', objectId: o.id, transform: makeTransform([x, o.transform.position[1], z], (yawDeg * Math.PI) / 180),
});

const table = obj(1, { category: 'table', pos: [-1.5, 0, -1.5], dims: [1, 0.75, 0.6] });
const vase = obj(2, { category: 'vase', pos: [-1.5, 0.75, -1.5], dims: [0.15, 0.3, 0.15] }, 1);
const sofa = obj(3, { category: 'sofa', pos: [1.5, 0, 1.5], dims: [2, 0.8, 0.9], assetId: id(500) });
const chair = obj(4, { category: 'chair', pos: [1.5, 0, -1.5], dims: [0.5, 0.9, 0.5] });
const base = scene([table, vase, sofa, chair]);

describe('diffScenes', () => {
  it('classifies pieces and ignores lock state', () => {
    const d = draftOf(base, [
      move(chair, 0, -1.5),
      { type: 'setLock', objectId: sofa.id, locked: true },
      { type: 'delete', objectId: vase.id },
      { type: 'add', object: obj(5, { category: 'side_table', pos: [0, 0, 1.5], dims: [0.4, 0.5, 0.4] }) },
    ]);
    expect(diffScenes(base, d)).toEqual({
      untouched: [table.id, sofa.id], changed: [chair.id], added: [id(5)], removed: [vase.id],
    });
  });
});

describe('diffToOps', () => {
  const cases: [string, SceneOp[]][] = [
    ['a move', [move(chair, 0, -1.5, 30)]],
    ['a carried stack (child keeps its exact carried transform)', [move(table, -1, -1)]],
    ['a child moved independently after its parent', [move(table, -1, -1), move(vase, -0.8, -1)]],
    ['an asset swap', [{ type: 'replaceAsset', objectId: sofa.id, assetId: id(501), dimensionsM: [1.8, 0.85, 0.95] }]],
    ['a resize, finish and tilt', [
      { type: 'resize', objectId: chair.id, dimensionsM: [0.6, 0.9, 0.55] },
      { type: 'changeMaterial', objectId: chair.id, overrides: { seat: { colorHex: '#aa3300' } } },
      { type: 'add', object: obj(9, { category: 'book', pos: [-1.3, 0.75, -1.4], dims: [0.15, 0.03, 0.22] }, 1) },
      { type: 'setTilt', objectId: id(9), tilt: { x: 0, z: 1 } },
    ]],
    ['an add on top of another add', [
      { type: 'add', object: obj(6, { category: 'side_table', pos: [0, 0, 1.5], dims: [0.4, 0.5, 0.4] }) },
      { type: 'add', object: obj(7, { category: 'vase', pos: [0, 0.5, 1.5], dims: [0.1, 0.2, 0.1] }, 6) },
    ]],
    ['deleting a support after its child was re-parented to the floor', [
      { type: 'setPlacement', objectId: vase.id, placement: { support: 'floor' } },
      move(vase, -1.5, -0.8),
      { type: 'delete', objectId: table.id },
    ]],
    ['deleting a support together with its child', [{ type: 'delete', objectId: table.id }]],
    ['a physical replacement', [{
      type: 'replacePhysicalItem', oldObjectId: chair.id,
      newObject: { ...obj(8, { category: 'chair', pos: [1.5, 0, -1.5], dims: [0.55, 0.95, 0.5] }), replacesObjectId: chair.id },
    }]],
  ];
  for (const [name, ops] of cases) {
    it(`reproduces ${name} exactly`, () => {
      const target = draftOf(base, ops);
      const r = diffToOps(ctx, base, target);
      if (!r.ok) throw new Error(r.message);
      expect(canon(draftOf(base, r.ops))).toBe(canon(target));
    });
  }

  it('is empty for identical scenes', () => {
    const r = diffToOps(ctx, base, base);
    expect(r.ok && r.ops).toEqual([]);
  });

  it('emits a physical replacement as replacePhysicalItem, not delete + add', () => {
    const target = draftOf(base, [{
      type: 'replacePhysicalItem', oldObjectId: chair.id,
      newObject: obj(8, { category: 'chair', pos: [1.5, 0, -1.5], dims: [0.55, 0.95, 0.5] }),
    }]);
    const r = diffToOps(ctx, base, target);
    if (!r.ok) throw new Error(r.message);
    expect(r.ops.map((o) => o.type)).toEqual(['replacePhysicalItem']);
  });
});

describe('resolveDraft', () => {
  const resolve = (d: SceneSpec) => resolveDraft(ctx, base, d);

  it('applies a conflict-free draft unchanged and returns its patch', () => {
    const d = draftOf(base, [move(chair, 0, -1.5)]);
    const r = resolve(d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(canon(r.scene)).toBe(canon(d));
    expect(r.report).toEqual([{ objectId: chair.id, outcome: 'applied' }]);
    expect(canon(draftOf(base, r.ops))).toBe(canon(r.scene));
    expect(r.scene.revision).toBe(base.revision);
  });

  it('moves a dropped piece to the nearest valid spot and never moves untouched pieces', () => {
    // Chair dropped into the sofa.
    const d = draftOf(base, [move(chair, 1.5, 1.5)]);
    const r = resolve(d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    const entry = r.report.find((e) => e.objectId === chair.id)!;
    expect(entry.outcome).toBe('moved');
    expect(entry.distanceM).toBeGreaterThan(0.3);
    expect(entry.distanceM).toBeLessThan(1.5);
    expect(get(r.scene, 3)).toEqual(sofa);
    expect(get(r.scene, 4).transform.rotation).toEqual(get(d, 4).transform.rotation);
  });

  it('reverts a changed piece and drops an added piece when no spot is in range', () => {
    // Everything wedged in a tiny room: nothing fits anywhere.
    const tiny = normalizeShell(expandCaseShell({ polygonXZ: [[0, 0], [0, 1], [1.1, 1], [1.1, 0]] }));
    const c: OpContext = { shell: tiny, assets: ctx.assets };
    const a = obj(10, { category: 'side_table', pos: [0.3, 0, 0.5], dims: [0.5, 0.5, 0.9] });
    const b = obj(11, { category: 'side_table', pos: [0.8, 0, 0.5], dims: [0.5, 0.5, 0.9] });
    const s = scene([a, b]);
    const added = obj(12, { category: 'side_table', pos: [0.6, 0, 0.5], dims: [0.5, 0.5, 0.9] });
    const d = draftOf(s, [move(b, 0.4, 0.5), { type: 'add', object: added }]);
    const r = resolveDraft(c, s, d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(r.report).toEqual(expect.arrayContaining([
      { objectId: b.id, outcome: 'reverted' }, { objectId: added.id, outcome: 'dropped' },
    ]));
    expect(get(r.scene, 11)).toEqual(b);
    expect(r.scene.objects.some((o) => o.id === added.id)).toBe(false);
  });

  it('does not move a piece for conflicts it already had before the edit', () => {
    // Pre-existing overlap; the user only changes the chair's finish.
    const s = scene([sofa, { ...chair, transform: makeTransform([1.5, 0, 1.5], 0) }]);
    const d = draftOf(s, [{ type: 'changeMaterial', objectId: chair.id, overrides: { seat: { colorHex: '#123456' } } }]);
    const r = resolveDraft(ctx, s, d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(r.report).toEqual([{ objectId: chair.id, outcome: 'applied' }]);
    expect(get(r.scene, 4).transform).toEqual(get(s, 4).transform);
  });

  it('resolves a support and its carried items as one assembly', () => {
    // Table (with vase) dropped into the chair.
    const d = draftOf(base, [move(table, 1.5, -1.5)]);
    const r = resolve(d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    const t = get(r.scene, 1).transform.position;
    const v = get(r.scene, 2).transform.position;
    expect(r.report.find((e) => e.objectId === table.id)!.outcome).toBe('moved');
    expect(v[0] - t[0]).toBeCloseTo(0, 9);
    expect(v[1] - t[1]).toBeCloseTo(0.75, 9);
    expect(v[2] - t[2]).toBeCloseTo(0, 9);
    expect(get(r.scene, 4)).toEqual(chair);
  });

  it('never moves a locked piece; it reverts instead', () => {
    const d0 = draftOf(base, [move(chair, 1.5, 1.5)]);
    const d = draftOf(d0, [{ type: 'setLock', objectId: chair.id, locked: true }]);
    const r = resolve(d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(r.report).toEqual([{ objectId: chair.id, outcome: 'reverted' }]);
    expect(get(r.scene, 4).transform).toEqual(chair.transform);
  });

  it('reports removals and keeps the patch faithful', () => {
    const d = draftOf(base, [{ type: 'delete', objectId: chair.id }]);
    const r = resolve(d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(r.report).toEqual([{ objectId: chair.id, outcome: 'removed' }]);
    expect(r.ops).toEqual([{ type: 'delete', objectId: chair.id }]);
  });
});

describe('contact snapping (a placement aid while suggesting)', () => {
  it('snaps a lifted piece onto the exposed top of a table within 12 cm, and the floor near it', async () => {
    const { snapToSurface, exposedTops, localBoxes } = await import('../src');
    const near = snapToSurface(ctx, base.objects, vase, makeTransform([-1.5, 0.68, -1.5], 0));
    expect(near.transform.position[1]).toBeCloseTo(0.75, 9);
    expect(near.surface?.ownerId).toBe(table.id);
    const far = snapToSurface(ctx, base.objects, vase, makeTransform([-1.5, 0.4, -1.5], 0));
    expect(far.surface).toBeUndefined();
    expect(far.transform.position[1]).toBe(0.4);
    const floor = snapToSurface(ctx, base.objects, chair, makeTransform([0, 0.07, 0], 0));
    expect(floor.surface?.ownerId).toBeNull();
    // Table legs are covered by the top: only the top slab is exposed.
    const tops = exposedTops(localBoxes(table).boxes);
    expect(tops.every((t) => Math.abs(t.y - 0.75) < 1e-9)).toBe(true);
  });

  it('never snaps a piece onto something it cannot rest on (large furniture stays on the floor)', async () => {
    const { snapToSurface } = await import('../src');
    const r = snapToSurface(ctx, base.objects, sofa, makeTransform([-1.5, 0.7, -1.5], 0));
    expect(r.surface).toBeUndefined();
  });
});

describe('Accept turns gravity back on', () => {
  it('a piece left in the air settles onto the surface beneath it, re-parented', () => {
    const lamp = obj(20, { category: 'lamp', pos: [1.5, 0, -0.5], dims: [0.2, 0.4, 0.2] });
    const s = scene([...base.objects, lamp]);
    const d = draftOf(s, [{ type: 'move', objectId: lamp.id, transform: makeTransform([-1.3, 1.4, -1.5], 0) }]);
    expect(get(d, 20).transform.position[1]).toBe(1.4); // the draft keeps exactly what the user did
    const r = resolveDraft(ctx, s, d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    const settled = get(r.scene, 20);
    expect(settled.transform.position[1]).toBeCloseTo(0.75, 9);
    expect(settled.placement).toEqual({ support: 'object', parentId: table.id });
    expect(r.report[0]).toMatchObject({ objectId: lamp.id, outcome: 'applied' });
    expect(r.report[0]!.settledM).toBeCloseTo(0.65, 9);
  });

  it('a piece in mid-air over the floor falls to the floor; Float keeps it up', () => {
    const d = draftOf(base, [{ type: 'move', objectId: chair.id, transform: makeTransform([0, 0.8, 0], 0) }]);
    const r = resolveDraft(ctx, base, d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(get(r.scene, 4).transform.position[1]).toBe(0);
    const f = draftOf(d, [{ type: 'setPlacement', objectId: chair.id, placement: { support: 'floor', float: true } }]);
    const rf = resolveDraft(ctx, base, f);
    if (!rf.ok) throw new Error(rf.unresolved[0]!.message);
    expect(get(rf.scene, 4).transform.position[1]).toBe(0.8);
  });

  it('a support lowered by gravity takes what it carries along; a finish change never moves anything', () => {
    const d = draftOf(base, [{ type: 'move', objectId: table.id, transform: makeTransform([-1.5, 0.3, -1.5], 0) }]);
    expect(get(d, 2).transform.position[1]).toBeCloseTo(1.05, 9);
    const r = resolveDraft(ctx, base, d);
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(get(r.scene, 1).transform.position[1]).toBe(0);
    expect(get(r.scene, 2).transform.position[1]).toBeCloseTo(0.75, 9);
    const floating = scene([{ ...chair, transform: makeTransform([1.5, 0.02, -1.5], 0) }]);
    const m = draftOf(floating, [{ type: 'changeMaterial', objectId: chair.id, overrides: { seat: { colorHex: '#000000' } } }]);
    const rm = resolveDraft(ctx, floating, m);
    if (!rm.ok) throw new Error(rm.unresolved[0]!.message);
    expect(get(rm.scene, 4).transform.position[1]).toBe(0.02);
  });
});
