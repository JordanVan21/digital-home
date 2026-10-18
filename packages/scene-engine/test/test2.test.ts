import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import test2 from '@house/contracts/fixtures/test2-room.json';
import { AssetCatalogFileSchema, RoomFixtureSchema } from '@house/contracts';
import { normalizeShell, restingSurface, settleTarget, validateScene } from '../src';

// The catalog is data shared with the web app (apps/web/public/catalog); read it as JSON.
const catalog = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../apps/web/public/catalog/catalog.json'), 'utf8')));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const fixture = RoomFixtureSchema.parse(test2);
const shell = normalizeShell(fixture.shell);
const ctx = { shell, assets: (id: string) => byId.get(id) };

describe('test2-room fixture', () => {
  it('parses, references only known verified assets, and every object loads with zero error-severity violations', () => {
    for (const o of fixture.scene.objects) {
      const a = o.assetId ? byId.get(o.assetId) : undefined;
      expect(a, o.displayName).toBeDefined();
      expect(a!.licenseStatus).toBe('verified');
      expect(a!.category).toBe(o.category);
    }
    const res = validateScene(ctx, fixture.scene);
    expect(res.violations.filter((v) => v.severity === 'error')).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('has no warnings either (the reference room is a clean starting point)', () => {
    expect(validateScene(ctx, fixture.scene).violations.map((v) => `${v.rule}: ${v.objectId.slice(-4)} ${v.detail}`)).toEqual([]);
  });

  it('every stacked item rests on a real surface of its parent, and nothing would fall on release', () => {
    const index = new Map(fixture.scene.objects.map((o) => [o.id, o]));
    for (const o of fixture.scene.objects) {
      const pid = o.placement?.parentId;
      if (pid) expect(restingSurface(index.get(pid)!, o, ctx.assets), o.displayName).toBeDefined();
      const settle = settleTarget(fixture.scene.objects, o, { assets: ctx.assets });
      if (settle) {
        expect(settle.ownerId ?? null, `${o.displayName} settles onto its parent`).toBe(pid ?? null);
        expect(Math.abs(settle.y - o.transform.position[1]), `${o.displayName} height`).toBeLessThan(1e-3);
      }
    }
  });

  it('is big enough to be a stress test (~45 objects, multi-level stacks)', () => {
    expect(fixture.scene.objects.length).toBeGreaterThanOrEqual(40);
    const depth = (id: string, idx = new Map(fixture.scene.objects.map((o) => [o.id, o]))): number => {
      const p = idx.get(id)?.placement?.parentId;
      return p ? 1 + depth(p, idx) : 0;
    };
    expect(Math.max(...fixture.scene.objects.map((o) => depth(o.id)))).toBeGreaterThanOrEqual(3);
  });
});

describe('test2-room suggestions', () => {
  it('resolves a large piece dropped onto another, with its decor, quickly', async () => {
    const { applyOps, resolveDraft, validateScene: vs } = await import('../src');
    const objs = fixture.scene.objects;
    // The heaviest case: the largest unlocked floor piece that carries decor, dropped onto another's center.
    const carriers = objs.filter((o) => !o.placement?.parentId && objs.some((c) => c.placement?.parentId === o.id));
    const mover = carriers.sort((a, b) => b.dimensionsM[0] * b.dimensionsM[2] - a.dimensionsM[0] * a.dimensionsM[2])[0]!;
    const target = objs.find((o) => !o.placement?.parentId && o.id !== mover.id && o.category === 'sofa') ?? objs.find((o) => o.id !== mover.id && !o.placement?.parentId)!;
    const draft = applyOps({ ...ctx, geometry: 'report' }, fixture.scene, [{
      type: 'move', objectId: mover.id, transform: { ...mover.transform, position: [target.transform.position[0], mover.transform.position[1], target.transform.position[2]] },
    }]);
    if (!draft.ok) throw new Error(draft.error.message);
    const t0 = performance.now();
    const r = resolveDraft(ctx, fixture.scene, draft.scene);
    const ms = performance.now() - t0;
    if (!r.ok) throw new Error(r.unresolved[0]!.message);
    expect(['moved', 'reverted']).toContain(r.report.find((e) => e.objectId === mover.id)!.outcome);
    expect(vs(ctx, r.scene).violations).toEqual([]);
    expect(ms).toBeLessThan(1500);
  });
});
