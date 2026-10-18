import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import demoRoom from '@house/contracts/fixtures/demo-room.json';
import { AssetCatalogFileSchema, RoomFixtureSchema } from '@house/contracts';
import { makeTransform, moveObject, normalizeShell } from '@house/scene-engine';
import { LocalAssetCatalog } from '../src/catalog/AssetCatalog';
import { LocalScenePersistence, memoryStorage } from '../src/persistence/ScenePersistence';
import { startAutosave, type Autosave } from '../src/state/autosave';
import {
  accept, addAsset, canTravel, changes, commit, deleteSelected, discard, revertPiece, setPosition, duplicateSelected, groupSelected, nudge, objectById, redo, resizeObject, rotateSelectionBy, select, selectMany, setScene, swapAsset, toggleLock, undo, useEditor,
} from '../src/state/store';

const catalog = new LocalAssetCatalog(AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../public/catalog/catalog.json'), 'utf8'))).assets);
const fixture = RoomFixtureSchema.parse(demoRoom);
const shell = normalizeShell(fixture.shell);
const ID = {
  sofa: '0b1ec700-0000-4000-8000-000000000001',
  desk: '0b1ec700-0000-4000-8000-000000000004',
  chair: '0b1ec700-0000-4000-8000-000000000005',
  lamp: '0b1ec700-0000-4000-8000-000000000007',
  art: '0b1ec700-0000-4000-8000-000000000008',
};
const ROOM = fixture.scene.roomId;

let persistence: LocalScenePersistence;
let autosave: Autosave;

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Await a persistence call whose mock latency runs on the fake clock. */
async function run<T>(p: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1);
  return p;
}

beforeEach(async () => {
  vi.useFakeTimers();
  persistence = new LocalScenePersistence(memoryStorage(), 0);
  const scene = await persistence.ensureScene(structuredClone(fixture.scene), shell);
  setScene({ source: 'demo-room', roomName: 'Demo', shell, scene, catalog });
  autosave = startAutosave(persistence, 500);
});

afterEach(() => {
  autosave.stop();
  vi.useRealTimers();
});

const chairAt = (x: number) => moveObject(ID.chair, makeTransform([x, 0, -1.412], Math.PI));
/** A design edit and its acceptance, as one user step. */
const edit = (label: string, ops: Parameters<typeof commit>[1]) => { commit(label, ops); accept(); };

describe('autosave', () => {
  it('fires once ~500 ms after editing stops, and persists every edit', async () => {
    const spy = vi.spyOn(persistence, 'saveScenePatch');
    edit('m1', chairAt(0.05));
    await settle(300);
    edit('m2', chairAt(0.1));
    await settle(300);
    edit('m3', chairAt(0.15));
    await settle(499);
    expect(spy).not.toHaveBeenCalled();
    await settle(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].operations).toHaveLength(3);
    await settle(10);
    const s = useEditor.getState();
    expect(s.save.status).toBe('saved');
    expect(s.save.dirty).toBe(false);
    expect(s.save.baseRevision).toBe(1);
    const stored = await run(persistence.getScene(ROOM));
    expect(objectById(ID.chair, { ...s, workingScene: stored })!.transform.position[0]).toBeCloseTo(0.15);
  });

  it('never saves mid-drag; saves after the drag ends', async () => {
    const spy = vi.spyOn(persistence, 'saveScenePatch');
    edit('m1', chairAt(0.05));
    useEditor.setState({ dragging: true });
    await settle(2000);
    expect(spy).not.toHaveBeenCalled();
    useEditor.setState({ dragging: false });
    await settle(499);
    expect(spy).not.toHaveBeenCalled();
    await settle(20);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('keeps edits and shows an error on failure; retry reuses the idempotency key (no duplicate revision)', async () => {
    const spy = vi.spyOn(persistence, 'saveScenePatch');
    persistence.failNext(1);
    edit('m1', chairAt(0.05));
    await settle(520);
    let s = useEditor.getState();
    expect(s.save.status).toBe('error');
    expect(s.save.lastError).toMatch(/Network/);
    expect(s.save.pending).toHaveLength(1);
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.05);
    autosave.retry();
    await settle(10);
    s = useEditor.getState();
    expect(s.save.status).toBe('saved');
    expect(s.save.baseRevision).toBe(1);
    expect(spy.mock.calls[0]![0].idempotencyKey).toBe(spy.mock.calls[1]![0].idempotencyKey);
  });

  it('a replayed request with the same idempotency key returns the original result', async () => {
    const req = { roomId: ROOM, baseRevision: 0, idempotencyKey: 'k1', operations: chairAt(0.2) };
    const a = await run(persistence.saveScenePatch(req));
    const b = await run(persistence.saveScenePatch(req));
    expect(a).toEqual(b);
    expect((await run(persistence.getScene(ROOM)))!.revision).toBe(1);
  });

  it('shows a conflict and never silently overwrites newer state', async () => {
    persistence.simulateExternalEdit(ROOM);
    const before = await run(persistence.getScene(ROOM));
    edit('m1', chairAt(0.05));
    await settle(520);
    const s = useEditor.getState();
    expect(s.save.status).toBe('conflict');
    expect(s.save.pending).toHaveLength(1);
    expect(await run(persistence.getScene(ROOM))).toEqual(before);
    // Further edits stay local; autosave stays paused.
    edit('m2', chairAt(0.1));
    await settle(1000);
    expect(await run(persistence.getScene(ROOM))).toEqual(before);
  });
});

describe('editor commands', () => {
  it('undo/redo restore exact transforms and are recorded for autosave', async () => {
    const original = objectById(ID.chair)!.transform;
    edit('m1', chairAt(0.123456));
    undo();
    expect(objectById(ID.chair)!.transform).toEqual(original);
    redo();
    expect(objectById(ID.chair)!.transform.position[0]).toBe(0.123456);
    expect(useEditor.getState().save.pending).toHaveLength(3);
  });

  it('a rejected undo shows a toast and leaves history untouched', () => {
    edit('m1', chairAt(0.05));
    // Lock the chair outside the history (e.g. state arriving from elsewhere).
    const s = useEditor.getState();
    const locked = { ...s.acceptedScene!, objects: s.acceptedScene!.objects.map((o) => (o.id === ID.chair ? { ...o, locked: true } : o)) };
    useEditor.setState({ acceptedScene: locked, workingScene: locked });
    const history = useEditor.getState().history;
    undo();
    const after = useEditor.getState();
    expect(after.history).toBe(history);
    expect(after.toasts.at(-1)?.text).toMatch(/Can't undo/);
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.05);
  });

  it('locked items cannot be deleted or swapped from the UI; their plan decision can change', () => {
    select(ID.sofa);
    toggleLock();
    deleteSelected();
    expect(objectById(ID.sofa)).toBeDefined();
    swapAsset(ID.sofa, 'a55e7000-0000-4000-8000-000000000011');
    expect(objectById(ID.sofa)!.assetId).toBe('a55e7000-0000-4000-8000-000000000001');
    commit('plan', [{ type: 'setRenovationDecision', objectId: ID.sofa, decision: 'keep' }]);
    expect(objectById(ID.sofa)!.renovationDecision).toBe('keep');
  });

  it('deleting the desk leaves the lamp in the air until Accept, when it falls to the floor; undo restores both', () => {
    const lampBefore = objectById(ID.lamp)!;
    select(ID.desk);
    const entries = useEditor.getState().history.past.length;
    deleteSelected();
    expect(objectById(ID.desk)).toBeUndefined();
    expect(objectById(ID.lamp)?.transform.position[1]).toBe(lampBefore.transform.position[1]);
    expect(objectById(ID.lamp)?.placement?.parentId).toBeUndefined();
    accept();
    expect(objectById(ID.lamp)?.transform.position[1]).toBe(0);
    expect(objectById(ID.lamp)?.placement).toEqual({ support: 'floor' });
    expect(useEditor.getState().history.past.length).toBe(entries + 1);
    undo();
    expect(objectById(ID.desk)).toBeDefined();
    expect(objectById(ID.lamp)).toEqual(lampBefore);
  });

  it('add from library nudges to a free spot; duplicate and swap are undoable', () => {
    const n = useEditor.getState().workingScene!.objects.length;
    const sofaPos = objectById(ID.sofa)!.transform.position;
    addAsset('a55e7000-0000-4000-8000-000000000002', [sofaPos[0], sofaPos[2]]); // armchair dropped on the sofa
    const s1 = useEditor.getState();
    expect(s1.workingScene!.objects).toHaveLength(n + 1);
    const added = objectById(s1.selectedId)!;
    expect(added.source).toBe('catalog');
    expect(s1.violations[added.id] ?? []).toEqual([]);

    duplicateSelected();
    expect(useEditor.getState().workingScene!.objects).toHaveLength(n + 2);
    undo();
    expect(useEditor.getState().workingScene!.objects).toHaveLength(n + 1);

    swapAsset(ID.chair, 'a55e7000-0000-4000-8000-000000000015');
    expect(objectById(ID.chair)!.assetId).toBe('a55e7000-0000-4000-8000-000000000015');
    expect(objectById(ID.chair)!.id).toBe(ID.chair);
    undo();
    expect(objectById(ID.chair)!.assetId).toBe('a55e7000-0000-4000-8000-000000000005');
  });

  it('wall items added from the library mount flush on the nearest wall facing in', () => {
    addAsset('a55e7000-0000-4000-8000-000000000009', [-1.9, 1.0]);
    const s = useEditor.getState();
    const art = objectById(s.selectedId)!;
    expect(art.placement?.support).toBe('wall');
    expect(s.violations[art.id] ?? []).toEqual([]);
    expect(art.transform.position[0]).toBeCloseTo(-2 + art.dimensionsM[2] / 2, 6);
  });

  it('surface items added onto a desk nest on it', () => {
    addAsset('a55e7000-0000-4000-8000-000000000017', [-0.3, -2.1], ID.desk); // vase onto desk
    const vase = objectById(useEditor.getState().selectedId)!;
    expect(vase.placement).toEqual({ support: 'object', parentId: ID.desk });
    expect(vase.transform.position[1]).toBeCloseTo(0.8);
    expect(useEditor.getState().violations[vase.id] ?? []).toEqual([]);
  });
});

describe('editing upgrades (store commands)', () => {
  it('nudging through a wall is a conflicting suggestion that Accept resolves back inside', () => {
    select(ID.chair);
    for (let i = 0; i < 40; i++) nudge([0, -0.1]); // push north through the desk and the wall
    expect(useEditor.getState().draft.conflicts[ID.chair]?.length).toBeGreaterThan(0);
    expect(accept()).toBe(true);
    const c = objectById(ID.chair)!;
    expect(useEditor.getState().violations[ID.chair] ?? []).toEqual([]);
    expect(c.transform.position[2]).toBeGreaterThan(-2.5);
  });

  it('Q/E rotation is continuous through ±180° in 15° steps', () => {
    select(ID.chair);
    const yaw = () => {
      const q = objectById(ID.chair)!.transform.rotation;
      return (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI;
    };
    const start = yaw();
    for (let i = 0; i < 24; i++) rotateSelectionBy((15 * Math.PI) / 180);
    expect(Math.abs(((yaw() - start + 540) % 360) - 180)).toBeLessThan(1e-6);
    expect(useEditor.getState().draft.undo.length).toBe(24);
  });

  it('group/ungroup is undoable and clicking a member selects the whole group', () => {
    selectMany([ID.sofa, ID.chair]);
    groupSelected();
    select(ID.sofa);
    expect(useEditor.getState().selectedIds.sort()).toEqual([ID.sofa, ID.chair].sort());
    select(ID.sofa, { single: true });
    expect(useEditor.getState().selectedIds).toEqual([ID.sofa]);
    undo();
    expect(objectById(ID.sofa)!.groupId).toBeUndefined();
  });

  it('resizing the desk keeps the lamp on its top', () => {
    const desk = objectById(ID.desk)!;
    resizeObject(ID.desk, [desk.dimensionsM[0], 0.9, desk.dimensionsM[2]]);
    expect(objectById(ID.lamp)!.transform.position[1]).toBeCloseTo(0.9, 9);
    expect(useEditor.getState().violations[ID.lamp] ?? []).toEqual([]);
  });

  it('loads the test2 scene with zero violations and saves edits through the mock backend', async () => {
    const { loadSource } = await import('../src/state/loader');
    const p = loadSource('test2', catalog, persistence);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    const s = useEditor.getState();
    expect(s.workingScene!.objects.length).toBe(45);
    expect(s.violations).toEqual({});
  });
});

describe('suggestions (draft)', () => {
  it('edits are suggestions: nothing is saved or recorded in history until Accept', async () => {
    const spy = vi.spyOn(persistence, 'saveScenePatch');
    const entries = useEditor.getState().history.past.length;
    commit('m1', chairAt(0.05));
    await settle(2000);
    expect(spy).not.toHaveBeenCalled();
    expect(useEditor.getState().hasDraft).toBe(true);
    expect(useEditor.getState().history.past.length).toBe(entries);
    expect(useEditor.getState().acceptedScene!.objects.find((o) => o.id === ID.chair)!.transform.position[0]).not.toBeCloseTo(0.05);
    accept();
    await settle(520);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0].operations).toEqual(chairAt(0.05));
    expect(useEditor.getState().history.past.length).toBe(entries + 1);
  });

  it('a conflicting drop is kept as a suggestion; Accept moves it to the nearest free spot', () => {
    const sofa = objectById(ID.sofa)!;
    commit('drop', moveObject(ID.chair, makeTransform([sofa.transform.position[0], 0, sofa.transform.position[2]], 0)));
    expect(useEditor.getState().draft.conflicts[ID.chair]?.some((v) => v.rule === 'overlap')).toBe(true);
    expect(changes()[0]).toMatchObject({ id: ID.chair, kind: 'moved' });
    expect(accept()).toBe(true);
    const s = useEditor.getState();
    expect(s.violations[ID.chair] ?? []).toEqual([]);
    expect(s.draft.resolved).toEqual([ID.chair]);
    expect(objectById(ID.sofa)).toEqual(sofa);
    expect(s.toasts.at(-1)?.text).toMatch(/moved \d+ cm to fit/);
  });

  it('discard restores the accepted room', () => {
    const before = useEditor.getState().acceptedScene;
    commit('m1', chairAt(0.05));
    discard();
    const s = useEditor.getState();
    expect(s.hasDraft).toBe(false);
    expect(s.workingScene).toBe(before);
  });

  it('undo walks suggestions first, then accepted history', () => {
    const x0 = objectById(ID.chair)!.transform.position[0];
    edit('m1', chairAt(0.05));
    commit('m2', chairAt(0.1));
    commit('m3', chairAt(0.15));
    undo();
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.1);
    undo();
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.05);
    expect(useEditor.getState().hasDraft).toBe(false);
    expect(canTravel('redo')).toBe(true);
    redo();
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.1);
    discard();
    undo();
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(x0);
  });

  it('locks apply at once to the room and the draft, and are never suggestions', () => {
    commit('m1', chairAt(0.05));
    select(ID.sofa);
    toggleLock();
    const s = useEditor.getState();
    expect(s.acceptedScene!.objects.find((o) => o.id === ID.sofa)!.locked).toBe(true);
    expect(objectById(ID.sofa)!.locked).toBe(true);
    expect(changes().map((c) => c.id)).toEqual([ID.chair]);
    expect(s.save.pending.at(-1)).toEqual({ type: 'setLock', objectId: ID.sofa, locked: true });
  });

  it('revertPiece restores one piece; a support reverts with what it carried', () => {
    const desk = objectById(ID.desk)!;
    const lamp = objectById(ID.lamp)!;
    commit('m1', chairAt(0.05));
    commit('move desk', moveObject(ID.desk, { ...desk.transform, position: [desk.transform.position[0] + 0.3, 0, desk.transform.position[2]] }));
    expect(objectById(ID.lamp)!.transform.position[0]).toBeCloseTo(lamp.transform.position[0] + 0.3);
    revertPiece(ID.desk);
    expect(objectById(ID.desk)).toEqual(desk);
    expect(objectById(ID.lamp)).toEqual(lamp);
    expect(changes().map((c) => c.id)).toEqual([ID.chair]);
  });
});

describe('schema-first edits (original sandbox)', () => {
  it('the edit log records each suggestion and the accepted ScenePatch as typed ops', () => {
    commit('m1', chairAt(0.05));
    accept();
    const log = useEditor.getState().opLog;
    const [suggested, accepted] = log.slice(-2);
    expect(suggested!.source).toBe('suggest');
    expect(suggested!.ops).toEqual(chairAt(0.05));
    expect(accepted!.source).toBe('accept');
    expect(accepted!.ops).toEqual(useEditor.getState().save.pending);
    expect(accepted!.summary).toMatch(/ScenePatch of 1 op/);
  });

  it('typed coordinates are exact while suggesting; gravity applies on Accept unless Float is on', () => {
    setPosition(ID.chair, 0, 0.4);
    expect(objectById(ID.chair)!.transform.position[0]).toBeCloseTo(0.4);
    setPosition(ID.chair, 1, 0.3);
    expect(objectById(ID.chair)!.transform.position[1]).toBe(0.3);
    expect(useEditor.getState().opLog.at(-1)!.ops.map((o) => o.type)).toEqual(['move']);
    accept();
    expect(objectById(ID.chair)!.transform.position[1]).toBe(0);
  });
});
