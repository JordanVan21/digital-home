import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import demoRoom from '@house/contracts/fixtures/demo-room.json';
import { AssetCatalogFileSchema, RoomFixtureSchema } from '@house/contracts';
import { normalizeShell, validateScene } from '@house/scene-engine';
import { LocalAssetCatalog } from '../src/catalog/AssetCatalog';
import { EDITOR_POLICY } from '../src/config/editorPolicy';
import { fitToBox } from '../src/scene/fit';
import { wallPanels } from '../src/scene/RoomShellMesh';
import { sceneFromScan } from '../src/state/loader';

const pub = join(__dirname, '../public');
const catalogFile = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(pub, 'catalog/catalog.json'), 'utf8')));
const catalog = new LocalAssetCatalog(catalogFile.assets);

describe('fitToBox', () => {
  it('scales non-uniformly within ±15%', () => {
    const f = fitToBox([1, 1, 1], [1.1, 1, 0.97], 0.15);
    expect(f.uniform).toBe(false);
    expect(f.scale).toEqual([1.1, 1, 0.97]);
  });
  it('falls back to uniform fit-inside beyond 15% distortion', () => {
    const f = fitToBox([1.571, 0.797, 0.658], [2.0, 0.85, 0.9], 0.15);
    expect(f.uniform).toBe(true);
    const s = f.scale[0];
    expect(f.scale).toEqual([s, s, s]);
    // Fits inside the target box on every axis.
    expect(1.571 * s).toBeLessThanOrEqual(2.0 + 1e-9);
    expect(0.797 * s).toBeLessThanOrEqual(0.85 + 1e-9);
    expect(0.658 * s).toBeLessThanOrEqual(0.9 + 1e-9);
  });
});

describe('local catalog', () => {
  it('every asset has a GLB and thumbnail on disk, CC0/verified provenance, and fits the budget', () => {
    for (const a of catalogFile.assets) {
      const glb = join(pub, 'catalog', a.glbStorageKey);
      expect(existsSync(glb), glb).toBe(true);
      expect(statSync(glb).size).toBeLessThan(EDITOR_POLICY.assetBudget.maxBytes);
      expect(a.triangleCount ?? 0).toBeLessThan(EDITOR_POLICY.assetBudget.maxTriangles);
      if (a.thumbnailStorageKey) expect(existsSync(join(pub, 'catalog', a.thumbnailStorageKey))).toBe(true);
      expect(a.licenseStatus).toBe('verified');
      expect(a.license).toBe('CC0-1.0');
      expect(a.attribution).toBeTruthy();
      expect(a.frontAxis).toBe('+Z');
    }
  });

  it('resolves URLs and thumbnails by asset id', () => {
    const a = catalogFile.assets[0]!;
    expect(catalog.resolveUrl(a.id)).toBe(`/catalog/${a.glbStorageKey}`);
    expect(catalog.resolveUrl('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('demo room references only known, verified, same-category assets and validates cleanly', () => {
    const f = RoomFixtureSchema.parse(demoRoom);
    for (const o of f.scene.objects) {
      if (!o.assetId) continue;
      const a = catalog.get(o.assetId);
      expect(a, o.displayName).toBeDefined();
      expect(a!.category).toBe(o.category);
    }
    const shell = normalizeShell(f.shell);
    expect(validateScene({ shell, assets: (id) => catalog.get(id) }, f.scene).violations).toEqual([]);
  });

  it('assets are local files — no remote URLs anywhere in the catalog', () => {
    for (const a of catalogFile.assets) {
      expect(a.glbStorageKey).not.toMatch(/^https?:/);
      expect(catalog.resolveUrl(a.id)).toMatch(/^\/catalog\//);
    }
  });
});

describe('scan → asset reproduction with the real catalog', () => {
  it('matches each scanned object deterministically, keeping pose and size', () => {
    const a = sceneFromScan(catalog);
    const b = sceneFromScan(catalog);
    expect(a.scene).toEqual(b.scene);
    const byCat = Object.fromEntries(a.scene.objects.map((o) => [o.scanMatch!.roomPlanCategory + ':' + o.dimensionsM[1], o]));
    expect(catalog.get(byCat['sofa:0.8']!.assetId!)?.category).toBe('sofa');
    expect(catalog.get(byCat['table:0.4']!.assetId!)?.category).toBe('coffee_table');
    expect(catalog.get(byCat['table:0.79']!.assetId!)?.category).toBe('desk');
    expect(catalog.get(byCat['chair:0.95']!.assetId!)?.category).toBe('chair');
    expect(catalog.get(byCat['storage:1.58']!.assetId!)?.category).toBe('shelf');
    expect(byCat['storage:0.8']!.assetId).toBeNull();
    expect(byCat['fireplace:1.1']!.assetId).toBeNull();
    expect(validateScene({ shell: a.shell }, a.scene).ok).toBe(true);
  });
});

describe('wall panels', () => {
  it('splits a wall around a door and a window into real cut-outs', () => {
    const panels = wallPanels(4, 2.6, [
      { id: 'd', wallId: 'w', kind: 'door', offsetM: 0.3, widthM: 0.9, bottomM: 0, heightM: 2.05 },
      { id: 'w', wallId: 'w', kind: 'window', offsetM: 2, widthM: 1.2, bottomM: 0.9, heightM: 1.3 },
    ], 0, 0.12);
    // left of door, above door, between, below window, above window, right of window
    const expected = [
      { s0: 0, s1: 0.3, y0: 0, y1: 2.6 },
      { s0: 0.3, s1: 1.2, y0: 2.05, y1: 2.6 },
      { s0: 1.2, s1: 2, y0: 0, y1: 2.6 },
      { s0: 2, s1: 3.2, y0: 0, y1: 0.9 },
      { s0: 2, s1: 3.2, y0: 2.2, y1: 2.6 },
      { s0: 3.2, s1: 4.12, y0: 0, y1: 2.6 },
    ];
    expect(panels).toHaveLength(expected.length);
    panels.forEach((p, i) => (['s0', 's1', 'y0', 'y1'] as const).forEach((k) => expect(p[k]).toBeCloseTo(expected[i]![k], 9)));
    // Total solid area = wall area − openings.
    const area = panels.reduce((s, p) => s + (p.s1 - p.s0) * (p.y1 - p.y0), 0);
    expect(area).toBeCloseTo(4.12 * 2.6 - 0.9 * 2.05 - 1.2 * 1.3, 9);
  });
});
