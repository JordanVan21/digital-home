import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetCatalogFileSchema } from '@house/contracts';
import { bakedShapeHash, bakedShapeIds, shapeOfAsset } from '../src';

const catalog = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../apps/web/public/catalog/catalog.json'), 'utf8')));

describe('baked shape profiles (merge step 3)', () => {
  it('every profile belongs to a catalog asset and matches its current GLB (rerun pnpm bake:shapes if not)', () => {
    const byId = new Map(catalog.assets.map((a) => [a.id, a]));
    for (const id of bakedShapeIds()) {
      expect(byId.has(id), `profile ${id} has no catalog asset`).toBe(true);
      expect(bakedShapeHash(id), `stale profile for ${byId.get(id)?.title}`).toBe(byId.get(id)!.contentHash);
    }
  });

  it('most opaque catalog models have a shape, with boxes inside the normalized bounds', () => {
    const shaped = catalog.assets.filter((a) => shapeOfAsset(a));
    expect(shaped.length).toBeGreaterThanOrEqual(40);
    for (const a of shaped) for (const [lo, hi] of shapeOfAsset(a)!) {
      for (let i = 0; i < 3; i++) {
        expect(lo[i]).toBeGreaterThanOrEqual(0);
        expect(hi[i]).toBeLessThanOrEqual(1);
        expect(hi[i]).toBeGreaterThanOrEqual(lo[i]!); // flat models (rugs) bake to zero-height boxes
      }
    }
  });

  it('a stale hash falls back to no shape', () => {
    const a = catalog.assets.find((x) => shapeOfAsset(x))!;
    expect(shapeOfAsset({ ...a, contentHash: 'sha256:stale' })).toBeNull();
  });
});
