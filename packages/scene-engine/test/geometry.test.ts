import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import cases from '../fixtures/geometry-cases.json';
import {
  expandCaseObject, expandCaseShell, footprintCorners, isCCWFromAbove, makeTransform, normalizeShell,
  normalizeWinding, obbOf, obbOverlap, polygonInsidePolygon, shoelaceXZ, validateScene, wallFrames,
  type CaseObject, type CaseShell,
} from '../src';
import type { SceneObject, Vec2 } from '@house/contracts';

const shells = cases.shells as unknown as Record<string, CaseShell>;

describe('geometry fixtures', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      let shell = expandCaseShell(shells[c.shell]!);
      if ((c as { normalize?: boolean }).normalize) shell = normalizeShell(shell);
      const objects = (c.objects as CaseObject[]).map(expandCaseObject);
      const res = validateScene({ shell }, { objects });
      const got = res.violations.map((v) => [v.rule, v.objectId, ...(v.rule === 'overlap' && v.otherId ? [v.otherId] : [])].join(':')).sort();
      expect(got).toEqual([...c.expect].sort());
      expect(res.ok).toBe(!res.violations.some((v) => v.severity === 'error'));
    });
  }
});

describe('axis conventions', () => {
  const box = (x: number, z: number, yaw: number, w: number, d: number): SceneObject => ({
    id: 'o', assetId: null, category: 'table', transform: makeTransform([x, 0, z], yaw),
    dimensionsM: [w, 0.5, d], locked: false, source: 'user', displayName: 'o',
  });

  it('footprint corners match a Three Object3D with the same position and yaw', () => {
    for (const [x, z, yaw, w, d] of [[0, 0, 0, 2, 1], [1.2, -0.7, 0.6, 1.5, 0.4], [-2, 3, -2.3, 0.8, 0.8], [0.3, 0.1, Math.PI, 2, 0.9]] as const) {
      const obj = box(x, z, yaw, w, d);
      const o3 = new THREE.Object3D();
      o3.position.set(x, 0, z);
      o3.rotation.y = yaw;
      o3.updateMatrixWorld();
      const threeCorners = [[-w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [w / 2, -d / 2]].map(([lx, lz]) => {
        const v = new THREE.Vector3(lx, 0, lz).applyMatrix4(o3.matrixWorld);
        return [v.x, v.z];
      });
      footprintCorners(obj).forEach((p, i) => {
        expect(p[0]).toBeCloseTo(threeCorners[i]![0]!, 10);
        expect(p[1]).toBeCloseTo(threeCorners[i]![1]!, 10);
      });
      // Stored quaternion equals Three's quaternion for rotation.y = yaw.
      const q = obj.transform.rotation;
      expect(Math.abs(q[0] * o3.quaternion.x + q[1] * o3.quaternion.y + q[2] * o3.quaternion.z + q[3] * o3.quaternion.w)).toBeCloseTo(1, 10);
    }
  });

  it('front faces +Z at yaw 0 and width runs along +X', () => {
    const b = obbOf(box(0, 0, 0, 2, 1));
    expect(b.v).toEqual([0, 1]);
    expect(b.u[0]).toBeCloseTo(1);
    expect(b.halfW).toBe(1);
  });

  it('"counter-clockwise viewed from +Y" matches what a top-down Three camera sees', () => {
    const poly: Vec2[] = [[-2, -2.5], [-2, 2.5], [2, 2.5], [2, -2.5]];
    expect(isCCWFromAbove(poly)).toBe(true);
    // Project through a camera above the room looking down (up = -Z, so +X is screen-right).
    const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    cam.position.set(0, 10, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const screen = poly.map(([x, z]) => new THREE.Vector3(x, 0, z).project(cam));
    let s = 0;
    for (let i = 0; i < screen.length; i++) {
      const a = screen[i]!;
      const b = screen[(i + 1) % screen.length]!;
      s += a.x * b.y - b.x * a.y; // standard math orientation on screen (y up)
    }
    expect(s).toBeGreaterThan(0); // CCW on screen
    expect(shoelaceXZ(poly)).toBeLessThan(0);
  });

  it('normalizes clockwise polygons and derives inward wall normals', () => {
    const cw: Vec2[] = [[2, -2.5], [2, 2.5], [-2, 2.5], [-2, -2.5]];
    expect(isCCWFromAbove(cw)).toBe(false);
    expect(isCCWFromAbove(normalizeWinding(cw))).toBe(true);
    const shell = normalizeShell(expandCaseShell({ polygonXZ: cw }));
    for (const f of wallFrames(shell)) {
      const mid: Vec2 = [(f.from[0] + f.to[0]) / 2 + f.inward[0] * 0.1, (f.from[1] + f.to[1]) / 2 + f.inward[1] * 0.1];
      expect(Math.abs(mid[0]) < 2 && Math.abs(mid[1]) < 2.5).toBe(true);
    }
  });
});

describe('primitives', () => {
  it('touching footprints within tolerance are not overlapping; tiny penetration is', () => {
    const a = obbOf(expandCaseObject({ id: 'a', category: 't', pos: [0, 0, 0], dims: [1, 1, 1] }));
    const b = obbOf(expandCaseObject({ id: 'b', category: 't', pos: [1.0005, 0, 0], dims: [1, 1, 1] }));
    const c = obbOf(expandCaseObject({ id: 'c', category: 't', pos: [0.995, 0, 0], dims: [1, 1, 1] }));
    expect(obbOverlap(a, b)).toBe(false);
    expect(obbOverlap(a, c)).toBe(true);
  });

  it('polygon containment allows touching the boundary', () => {
    const room: Vec2[] = [[0, 0], [0, 2], [2, 2], [2, 0]];
    expect(polygonInsidePolygon([[0, 0], [0, 1], [1, 1], [1, 0]], room)).toBe(true);
    expect(polygonInsidePolygon([[-0.01, 0], [0, 1], [1, 1], [1, 0]], room)).toBe(false);
  });
});
