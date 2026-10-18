import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssetCatalogFileSchema, type Vec3 } from '@house/contracts';
import { shapeOfAsset, type ShapeBox } from '@house/scene-engine';
import { compoundExteriorPositions } from '../src/scene/compoundOutline';
import { outlineSizeOf } from '../src/scene/shapeOutline';

// Ported from the codex sandbox (compoundOutline.test.ts).
const block = (min: Vec3, max: Vec3): ShapeBox => [min, max];
const catalog = AssetCatalogFileSchema.parse(JSON.parse(readFileSync(join(__dirname, '../public/catalog/catalog.json'), 'utf8'))).assets;

describe('compound exterior outlines', () => {
  it('removes touching/overlapping box faces and collinear seams', () => {
    for (const boxes of [
      [block([0, 0, 0], [0.5, 1, 1]), block([0.5, 0, 0], [1, 1, 1])],
      [block([0, 0, 0], [0.7, 1, 1]), block([0.3, 0, 0], [1, 1, 1])],
    ]) {
      const positions = compoundExteriorPositions(boxes);
      expect(positions.length).toBe(12 * 6);
      expect(compoundExteriorPositions(boxes)).toBe(positions);
    }
  });

  it('draws an L-shaped exterior without an enclosing cube or internal box edges', () => {
    const positions = compoundExteriorPositions([block([0, 0, 0], [1, 1, 0.5]), block([0, 0, 0.5], [0.5, 1, 1])]);
    expect(positions.length).toBe(18 * 6);
    for (let i = 0; i < positions.length; i += 3) expect(positions[i]! > 0.5 && positions[i + 2]! > 0.5).toBe(false);
  });

  it('omits sealed internal cavities but retains genuinely open holes', () => {
    const shell = [block([0, 0, 0], [1, 1, 0.2]), block([0, 0, 0.8], [1, 1, 1]), block([0, 0, 0.2], [0.2, 1, 0.8]), block([0.8, 0, 0.2], [1, 1, 0.8])];
    expect(compoundExteriorPositions(shell).length).toBe(24 * 6);
    const closed = [...shell, block([0.2, 0, 0.2], [0.8, 0.2, 0.8]), block([0.2, 0.8, 0.2], [0.8, 1, 0.8])];
    expect(compoundExteriorPositions(closed).length).toBe(12 * 6);
  });

  it('builds finite outlines for every baked catalog shape', () => {
    for (const a of catalog) {
      const shape = shapeOfAsset(a);
      if (!shape) continue;
      const positions = compoundExteriorPositions(shape);
      expect(positions.length, a.title).toBeGreaterThan(0);
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
    }
  });

  it('outlines line up with the rendered model: same fit as SceneObjectMesh (±15% stretch, else uniform fit-inside)', () => {
    const native: Vec3 = [2, 1, 1];
    expect(outlineSizeOf(native, [2.2, 1, 1])).toEqual([2.2, 1, 1]); // 10% wider: stretched to the box
    const fitted = outlineSizeOf(native, [4, 1, 1]); // 100% wider: uniform, fits inside the box
    expect(fitted[0]).toBeCloseTo(2);
    expect(fitted[1]).toBeCloseTo(1);
  });
});
