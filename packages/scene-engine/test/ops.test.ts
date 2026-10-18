import { describe, expect, it } from 'vitest';
import demo from '@house/contracts/fixtures/demo-room.json';
import { RoomFixtureSchema, type SceneObject, type SceneOp, type SceneSpec } from '@house/contracts';
import {
  applyOp, applyOps, duplicateObject, emptyHistory, makeTransform, normalizeShell, pushHistory,
  redo, rotateObject, undo, validateScene, yawFromQuat, type OpContext,
} from '../src';

const fixture = RoomFixtureSchema.parse(demo);
const shell = normalizeShell(fixture.shell);
const ctx: OpContext = { shell };
const scene0: SceneSpec = fixture.scene;

const ID = {
  sofa: '0b1ec700-0000-4000-8000-000000000001',
  rug: '0b1ec700-0000-4000-8000-000000000002',
  coffee: '0b1ec700-0000-4000-8000-000000000003',
  desk: '0b1ec700-0000-4000-8000-000000000004',
  chair: '0b1ec700-0000-4000-8000-000000000005',
  lamp: '0b1ec700-0000-4000-8000-000000000007',
  art: '0b1ec700-0000-4000-8000-000000000008',
};
const get = (s: SceneSpec, id: string) => s.objects.find((o) => o.id === id)!;
const byId = (s: SceneSpec) => Object.fromEntries(s.objects.map((o) => [o.id, o]));
const ok = (r: ReturnType<typeof applyOp>) => {
  if (!r.ok) throw new Error(`${r.error.reason}: ${r.error.message}`);
  return r;
};
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};
let n = 0;
const newId = () => `dddddddd-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('demo room', () => {
  it('validates with no violations (rug does not flag sofa/coffee table; art not flagged for floor support)', () => {
    const res = validateScene(ctx, scene0);
    expect(res.violations).toEqual([]);
  });
});

describe('purity', () => {
  it('ops never mutate their input', () => {
    const frozen = deepFreeze(structuredClone(scene0));
    const ops: SceneOp[] = [
      { type: 'move', objectId: ID.desk, transform: makeTransform([0.3, 0, -2.0], 0) },
      { type: 'setLock', objectId: ID.sofa, locked: true },
      { type: 'delete', objectId: ID.coffee },
      { type: 'setRenovationDecision', objectId: ID.sofa, decision: 'remove' },
    ];
    expect(() => applyOps(ctx, frozen, ops)).not.toThrow();
    expect(frozen).toEqual(scene0);
  });
});

describe('shell immutability', () => {
  it('rejects shell-modifying operation types', () => {
    for (const type of ['moveWall', 'updateShell', 'deleteOpening', 'setFloor']) {
      const r = applyOp(ctx, scene0, { type } as unknown as SceneOp);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.reason).toBe('SHELL_IMMUTABLE');
    }
  });

  it('no op changes shellId or the shell object', () => {
    const before = structuredClone(shell);
    const r = ok(applyOps(ctx, scene0, [
      { type: 'move', objectId: ID.desk, transform: makeTransform([0.2, 0, -2.0], 0) },
      { type: 'delete', objectId: ID.sofa },
    ]));
    expect(r.scene.shellId).toBe(scene0.shellId);
    expect(shell).toEqual(before);
    expect(Object.keys(r.scene).sort()).toEqual(Object.keys(scene0).sort());
  });

  it('ignores smuggled shell fields on ops', () => {
    const r = ok(applyOp(ctx, scene0, { type: 'setLock', objectId: ID.sofa, locked: true, shell: { walls: [] } } as unknown as SceneOp));
    expect('shell' in r.scene).toBe(false);
  });
});

describe('locks', () => {
  const locked = ok(applyOp(ctx, scene0, { type: 'setLock', objectId: ID.sofa, locked: true })).scene;

  it.each<[string, SceneOp]>([
    ['move', { type: 'move', objectId: ID.sofa, transform: makeTransform([1.4, 0, -0.6], -Math.PI / 2) }],
    ['delete', { type: 'delete', objectId: ID.sofa }],
    ['replaceAsset', { type: 'replaceAsset', objectId: ID.sofa, assetId: null, dimensionsM: [2, 0.85, 0.9] }],
    ['changeMaterial', { type: 'changeMaterial', objectId: ID.sofa, overrides: { body: { colorHex: '#fff' } } }],
  ])('rejects %s on a locked object', (_name, op) => {
    const r = applyOp(ctx, locked, op);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('LOCKED');
  });

  it('rejects rotate (move with new yaw) on a locked object', () => {
    const r = applyOps(ctx, locked, rotateObject(locked, ID.sofa, 0));
    expect(r.ok).toBe(false);
  });

  it('allows setLock and setRenovationDecision on a locked object', () => {
    const r1 = ok(applyOp(ctx, locked, { type: 'setRenovationDecision', objectId: ID.sofa, decision: 'replace' }));
    expect(get(r1.scene, ID.sofa).renovationDecision).toBe('replace');
    const r2 = ok(applyOp(ctx, locked, { type: 'setLock', objectId: ID.sofa, locked: false }));
    expect(get(r2.scene, ID.sofa).locked).toBe(false);
  });

  it('setLock is undoable through its inverse', () => {
    const r = ok(applyOp(ctx, scene0, { type: 'setLock', objectId: ID.sofa, locked: true }));
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(byId(back.scene)).toEqual(byId(scene0));
  });
});

describe('nesting', () => {
  it('moving the desk carries the lamp; undo restores both exactly', () => {
    const desk = get(scene0, ID.desk);
    const lamp = get(scene0, ID.lamp);
    const r = ok(applyOp(ctx, scene0, { type: 'move', objectId: ID.desk, transform: makeTransform([0.3, 0, -1.9], 0) }));
    expect(get(r.scene, ID.lamp).transform.position[0]).toBeCloseTo(lamp.transform.position[0] + 0.3, 12);
    expect(get(r.scene, ID.lamp).transform.position[2]).toBeCloseTo(lamp.transform.position[2] + (-1.9 - desk.transform.position[2]), 12);
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(get(back.scene, ID.lamp)).toEqual(lamp);
    expect(get(back.scene, ID.desk)).toEqual(desk);
  });

  it('rotating the desk rotates the lamp around it; undo is exact', () => {
    const lamp = get(scene0, ID.lamp);
    const desk = get(scene0, ID.desk);
    const relX = lamp.transform.position[0] - desk.transform.position[0];
    const relZ = lamp.transform.position[2] - desk.transform.position[2];
    const r = ok(applyOp(ctx, scene0, { type: 'move', objectId: ID.desk, transform: makeTransform([-0.5, 0, 0.0], Math.PI / 2) }));
    const l = get(r.scene, ID.lamp);
    // Desk yaw 0 → 90°: the desk's local +X maps to world −Z and local +Z to world +X.
    expect(l.transform.position[0]).toBeCloseTo(-0.5 + relZ, 9);
    expect(l.transform.position[2]).toBeCloseTo(0 - relX, 9);
    expect(yawFromQuat(l.transform.rotation)).toBeCloseTo(Math.PI / 2, 9);
    expect(l.transform.position[1]).toBe(lamp.transform.position[1]);
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(get(back.scene, ID.lamp)).toEqual(lamp);
  });

  it('deleting the desk deletes the lamp; undo restores both', () => {
    const r = ok(applyOp(ctx, scene0, { type: 'delete', objectId: ID.desk }));
    expect(r.scene.objects.find((o) => o.id === ID.lamp)).toBeUndefined();
    expect(r.affected.sort()).toEqual([ID.desk, ID.lamp].sort());
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(byId(back.scene)).toEqual(byId(scene0));
  });

  it('rejects deleting or moving a parent whose child is locked', () => {
    const s = ok(applyOp(ctx, scene0, { type: 'setLock', objectId: ID.lamp, locked: true })).scene;
    for (const op of [
      { type: 'delete', objectId: ID.desk },
      { type: 'move', objectId: ID.desk, transform: makeTransform([0.2, 0, -2], 0) },
    ] as SceneOp[]) {
      const r = applyOp(ctx, s, op);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.reason).toBe('CHILD_LOCKED');
    }
  });
});

describe('validation errors', () => {
  it('rejects a move that puts the footprint outside the room', () => {
    const r = applyOp(ctx, scene0, { type: 'move', objectId: ID.chair, transform: makeTransform([3, 0, 0], 0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('GEOMETRY');
  });

  it('allows a move that only produces warnings (overlap)', () => {
    const coffee = get(scene0, ID.coffee);
    const r = ok(applyOp(ctx, scene0, { type: 'move', objectId: ID.chair, transform: makeTransform(coffee.transform.position, 0) }));
    expect(validateScene(ctx, r.scene).violations.some((v) => v.rule === 'overlap')).toBe(true);
  });

  it('rejects non-yaw rotation and non-unit scale', () => {
    const t = makeTransform([0, 0, 0], 0);
    expect(applyOp(ctx, scene0, { type: 'move', objectId: ID.chair, transform: { ...t, rotation: [0.7071, 0, 0, 0.7071] } }).ok).toBe(false);
    expect(applyOp(ctx, scene0, { type: 'move', objectId: ID.chair, transform: { ...t, scale: [2, 2, 2] } }).ok).toBe(false);
  });

  it('rejects duplicate ids and unknown parents on add', () => {
    const sofa = get(scene0, ID.sofa);
    expect(applyOp(ctx, scene0, { type: 'add', object: sofa }).ok).toBe(false);
    const orphan: SceneObject = { ...get(scene0, ID.lamp), id: newId(), placement: { support: 'object', parentId: newId() } };
    const r = applyOp(ctx, scene0, { type: 'add', object: orphan });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.reason).toBe('INVALID_PARENT');
  });

  it('rejects non-verified or unknown assets when a catalog is supplied', () => {
    const assets = (id: string) => (id === 'a55e7000-0000-4000-8000-000000000099'
      ? { id, category: 'sofa', licenseStatus: 'pending' } as never
      : undefined);
    const r = applyOp({ ...ctx, assets }, scene0, { type: 'replaceAsset', objectId: ID.sofa, assetId: 'a55e7000-0000-4000-8000-000000000099', dimensionsM: [2, 0.85, 0.9] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ASSET_UNAVAILABLE');
  });

  it('applyOps is all-or-nothing and reports the failing op index', () => {
    const r = applyOps(ctx, scene0, [
      { type: 'setLock', objectId: ID.sofa, locked: true },
      { type: 'delete', objectId: ID.sofa },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.opIndex).toBe(1);
  });
});

describe('replaceAsset keeps identity', () => {
  it('swaps the model, keeps the id, and inverts to the placeholder', () => {
    const placeholder = scene0.objects.find((o) => o.assetId === null)!;
    const r = ok(applyOp(ctx, scene0, { type: 'replaceAsset', objectId: placeholder.id, assetId: 'a55e7000-0000-4000-8000-000000000006', dimensionsM: [0.8, 1.8, 0.35] }));
    expect(get(r.scene, placeholder.id).assetId).toBe('a55e7000-0000-4000-8000-000000000006');
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(get(back.scene, placeholder.id)).toEqual(placeholder);
  });
});

describe('duplicate', () => {
  it('duplicates the desk with its lamp under new ids and correct parent link', () => {
    const d = duplicateObject(scene0, ID.desk, newId, [0, 1])!;
    expect(d.ops).toHaveLength(2);
    const [deskOp, lampOp] = d.ops as [Extract<SceneOp, { type: 'add' }>, Extract<SceneOp, { type: 'add' }>];
    expect(deskOp.object.id).not.toBe(ID.desk);
    expect(lampOp.object.placement?.parentId).toBe(deskOp.object.id);
    expect(lampOp.object.source).toBe('user');
    const r = ok(applyOps({ ...ctx, geometry: 'report' }, scene0, d.ops));
    expect(r.scene.objects).toHaveLength(scene0.objects.length + 2);
    const back = ok(applyOps(ctx, r.scene, r.inverse));
    expect(byId(back.scene)).toEqual(byId(scene0));
  });
});

describe('history', () => {
  it('undo/redo restores exact transforms; redo cleared by a new command; cap respected', () => {
    let s = scene0;
    let h = emptyHistory(2);
    const steps: SceneOp[][] = [
      [{ type: 'move', objectId: ID.chair, transform: makeTransform([0.123456789, 0, -1.4], 0.3) }],
      [{ type: 'move', objectId: ID.desk, transform: makeTransform([0.2, 0, -2.0], 0.1) }],
      [{ type: 'setLock', objectId: ID.sofa, locked: true }],
    ];
    const snapshots = [s];
    for (const ops of steps) {
      const r = ok(applyOps(ctx, s, ops));
      s = r.scene;
      h = pushHistory(h, { label: 'x', forward: ops, inverse: r.inverse });
      snapshots.push(s);
    }
    expect(h.past).toHaveLength(2);
    const u1 = undo(ctx, s, h);
    if (!u1.ok) throw new Error();
    expect(byId(u1.scene)).toEqual(byId(snapshots[2]!));
    const u2 = undo(ctx, u1.scene, u1.history);
    if (!u2.ok) throw new Error();
    expect(byId(u2.scene)).toEqual(byId(snapshots[1]!));
    expect(undo(ctx, u2.scene, u2.history).ok).toBe(false); // capped at 2
    const r1 = redo(ctx, u2.scene, u2.history);
    if (!r1.ok) throw new Error();
    expect(byId(r1.scene)).toEqual(byId(snapshots[2]!));
    const fresh = pushHistory(r1.history, { label: 'y', forward: [], inverse: [] });
    expect(fresh.future).toHaveLength(0);
  });

  it('a rejected undo keeps the entry in place and leaves the scene unchanged', () => {
    const op: SceneOp = { type: 'move', objectId: ID.chair, transform: makeTransform([0.2, 0, -1.3], 0) };
    const r = ok(applyOp(ctx, scene0, op));
    let h = pushHistory(emptyHistory(), { label: 'move', forward: [op], inverse: r.inverse });
    // Lock the chair afterwards (not recorded, simulating a later lock).
    const locked = ok(applyOp(ctx, r.scene, { type: 'setLock', objectId: ID.chair, locked: true })).scene;
    const u = undo(ctx, locked, h);
    expect(u.ok).toBe(false);
    expect(u.history).toBe(h);
    if (!u.ok) expect((u.error as { reason: string }).reason).toBe('LOCKED');
    h = u.history;
    expect(h.past).toHaveLength(1);
  });
});
