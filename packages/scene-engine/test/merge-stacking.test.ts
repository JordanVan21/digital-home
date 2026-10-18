import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetCatalogFileSchema, type SceneObject } from '@house/contracts';
import {
  canRestOn, expandCaseObject, exposedTopFaces, findSupport, localSurfaces, makeTransform, renderedSize, restsOn, settleTarget, shapeOfAsset,
  worldSurfaces, type CaseObject, type ShapeBox,
} from '../src';

/** Stacking (codex) + gravity (jordan): agent_docs/MERGE_INVENTORY.md §14. */
const catalog = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../../../apps/web/public/catalog/catalog.json'), 'utf8')));
const byId = new Map(catalog.assets.map((a) => [a.id, a]));
const assets = (id: string) => byId.get(id);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const obj = (n: number, c: Omit<CaseObject, 'id'>): SceneObject => expandCaseObject({ ...c, id: id(n) });
const fromAsset = (n: number, title: string, pos: [number, number, number] = [0, 0, 0]): SceneObject => {
  const a = catalog.assets.find((x) => x.title === title)!;
  return { ...obj(n, { category: a.category, pos, dims: a.dimensionsM }), assetId: a.id };
};

describe('exposed top faces (from codex)', () => {
  it('a seat under a backrest keeps only its open part; the backrest top is a face too', () => {
    const chair: ShapeBox[] = [[[0, 0, 0], [1, 0.5, 1]], [[0, 0.5, 0], [1, 1, 0.2]]];
    const faces = exposedTopFaces(chair);
    const seat = faces.filter((f) => f.y === 0.5);
    expect(seat).toHaveLength(1);
    expect(seat[0]!.rect).toEqual([0, 0.2, 1, 1]);
    expect(faces.some((f) => f.y === 1)).toBe(true);
  });

  it('a covered internal top is not a face', () => {
    const stacked: ShapeBox[] = [[[0, 0, 0], [1, 0.5, 1]], [[0, 0.5, 0], [1, 1, 1]]];
    expect(exposedTopFaces(stacked).map((f) => f.y)).toEqual([1]);
  });
});

describe('real surfaces of downloaded models', () => {
  const chair = fromAsset(1, 'Upholstered dining chair');

  it('a dining chair offers its seat (below its full height) as a surface', () => {
    const h = renderedSize(byId.get(chair.assetId!)!.dimensionsM, chair.dimensionsM)[1];
    const seats = localSurfaces(chair, assets).filter((s) => s.y > 0.3 && s.y < h - 0.1);
    expect(seats.length).toBeGreaterThan(0);
  });

  it('a book dropped over the seat lands on it (gravity onto the real face)', () => {
    const book = obj(2, { category: 'book', pos: [0.02, 1.5, 0.1], dims: [0.15, 0.03, 0.15] });
    const hit = settleTarget([chair, book], book, { assets })!;
    expect(hit.ownerId).toBe(chair.id);
    expect(hit.y).toBeGreaterThan(0.3);
  });

  it('no-penetration: a face is refused when the item would sink into the rest of the shape', () => {
    const point: [number, number] = [0.02, 0.1];
    const seat = worldSurfaces(chair, assets).filter((s) => s.y > 0.3 && s.y < 0.6 && restsOn(obj(9, { category: 'book', pos: [point[0], s.y, point[1]], dims: [0.1, 0.03, 0.1] }), s, chair, assets));
    expect(seat.length).toBeGreaterThan(0); // a small book fits on the seat cushion
    // A wide, tall item over the same spot would push into the arms / backrest: no seat for it.
    const wide = obj(3, { category: 'vase', pos: [point[0], 1.5, point[1]], dims: [0.42, 0.8, 0.5] });
    const hit = findSupport([chair, wide], wide, { assets });
    expect(hit.ownerId).toBeNull();
    expect(restsOn({ ...wide, transform: makeTransform([point[0], seat[0]!.y, point[1]], 0) }, seat[0]!, chair, assets)).toBe(false);
  });

  it('jordan\'s self-made models keep their exact surfaces (no voxel faces)', () => {
    const shelf = fromAsset(5, 'Open oak and steel bookshelf');
    expect(localSurfaces(shelf, assets).every((s) => !s.shaped)).toBe(true);
    const sofa = fromAsset(6, 'Classic fabric sofa');
    expect(shapeOfAsset(byId.get(sofa.assetId!))).not.toBeNull();
    expect(localSurfaces(sofa, assets).some((s) => s.shaped)).toBe(true);
  });
});

describe('what may rest on what', () => {
  it('anything on anything (a plant on an armchair is fine) …', () => {
    expect(canRestOn('plant', 'armchair')).toBe(true);
    expect(canRestOn('lamp', 'sofa')).toBe(true);
  });

  it('… except large furniture, which stays on the floor', () => {
    expect(canRestOn('sofa', 'coffee_table')).toBe(false);
    const table = obj(1, { category: 'coffee_table', pos: [0, 0, 0], dims: [1.2, 0.45, 0.6] });
    const sofa = obj(2, { category: 'sofa', pos: [0, 1, 0], dims: [2, 0.85, 0.9] });
    expect(findSupport([table, sofa], sofa, {}).ownerId).toBeNull();
  });

  it('rugs never hold things', () => {
    const rug = obj(1, { category: 'rug', pos: [0, 0, 0], dims: [2, 0.01, 1.4] });
    expect(localSurfaces(rug)).toEqual([]);
  });
});
