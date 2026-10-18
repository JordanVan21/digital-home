import { describe, expect, it } from 'vitest';
import demoRoom from '../fixtures/demo-room.json';
import demoScan from '../fixtures/demo-scan.json';
import { RoomFixtureSchema, ScanFixtureSchema, SceneOpSchema } from '../src';

describe('contract fixtures', () => {
  it('demo-room.json parses as a RoomFixture', () => {
    const f = RoomFixtureSchema.parse(demoRoom);
    expect(f.scene.shellId).toBe(f.shell.id);
    expect(new Set(f.scene.objects.map((o) => o.id)).size).toBe(f.scene.objects.length);
    expect(f.scene.objects.some((o) => o.assetId === null)).toBe(true);
    expect(f.scene.objects.every((o) => o.transform.scale.every((s) => s === 1))).toBe(true);
  });

  it('demo-scan.json parses as a ScanFixture with RoomPlan categories only', () => {
    const f = ScanFixtureSchema.parse(demoScan);
    expect(f.scanObjects.length).toBeGreaterThan(0);
  });

  it('rejects unknown op types (no shell mutation op exists)', () => {
    expect(SceneOpSchema.safeParse({ type: 'moveWall', wallId: 'x' }).success).toBe(false);
  });
});
