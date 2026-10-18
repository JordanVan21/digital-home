import { describe, expect, it } from 'vitest';
import demoRoom from '@house/contracts/fixtures/demo-room.json';
import { RoomFixtureSchema } from '@house/contracts';
import { makeTransform, moveObject, normalizeShell } from '@house/scene-engine';
import { LocalScenePersistence, memoryStorage } from '../src/persistence/ScenePersistence';

/** Two-tab safety (from the codex sandbox; MERGE_INVENTORY 11.2). */
const fixture = RoomFixtureSchema.parse(demoRoom);
const shell = normalizeShell(fixture.shell);
const CHAIR = '0b1ec700-0000-4000-8000-000000000005';
const move = (x: number) => moveObject(CHAIR, makeTransform([x, 0, -1.412], Math.PI));

describe('two tabs on the same room', () => {
  it('a stale tab gets a conflict instead of overwriting the other tab\'s save', async () => {
    const shared = memoryStorage();
    const tabA = new LocalScenePersistence(shared, 0);
    const tabB = new LocalScenePersistence(shared, 0);
    const scene = await tabA.ensureScene(structuredClone(fixture.scene), shell);
    await tabB.getScene(scene.roomId); // tab B has the room open at revision 0
    const a = await tabA.saveScenePatch({ roomId: scene.roomId, baseRevision: 0, idempotencyKey: 'a-1', operations: move(0.05) });
    expect(a.ok).toBe(true);
    const b = await tabB.saveScenePatch({ roomId: scene.roomId, baseRevision: 0, idempotencyKey: 'b-1', operations: move(0.2) });
    expect(b).toEqual({ ok: false, code: 'CONFLICT', currentRevision: 1 });
    // Tab B sees tab A's save when it reloads.
    expect((await tabB.getScene(scene.roomId))?.revision).toBe(1);
  });
});
