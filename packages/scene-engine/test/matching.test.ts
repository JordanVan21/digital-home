import { describe, expect, it } from 'vitest';
import cases from '../fixtures/match-cases.json';
import scan from '@house/contracts/fixtures/demo-scan.json';
import { ScanFixtureSchema } from '@house/contracts';
import {
  expandCaseAsset, findFreeSpot, matchScanObject, normalizeShell, objectFromAsset, reproduceScanObject,
  validateScene, yawFromQuat, type CaseAsset, type MatchOptions,
} from '../src';

const catalog = (cases.catalog as CaseAsset[]).map(expandCaseAsset);

describe('matchScanObject fixtures', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const scanObj = c.scan as Parameters<typeof matchScanObject>[0];
      const m = matchScanObject(scanObj, catalog, (c as { options?: Partial<MatchOptions> }).options);
      const e = c.expect as { assetId: string | null; yawAdjustDeg?: number; dimensionsM?: number[]; category?: string; score?: number };
      expect(m.assetId).toBe(e.assetId);
      if (e.yawAdjustDeg !== undefined) expect((m.yawAdjust * 180) / Math.PI).toBeCloseTo(e.yawAdjustDeg);
      if (e.dimensionsM) expect(m.dimensionsM).toEqual(e.dimensionsM);
      if (e.category) expect(m.category).toBe(e.category);
      if (e.score !== undefined) expect(m.score).toBe(e.score);
      // Deterministic, independent of catalog order.
      expect(matchScanObject(scanObj, [...catalog].reverse(), (c as { options?: Partial<MatchOptions> }).options)).toEqual(m);
    });
  }
});

describe('scan reproduction', () => {
  const fixture = ScanFixtureSchema.parse(scan);

  it('keeps scan position, yaw and size; records scanMatch; uses the scan id', () => {
    for (const so of fixture.scanObjects) {
      const obj = reproduceScanObject(so, catalog);
      expect(obj.id).toBe(so.scanObjectId);
      expect(obj.transform.position).toEqual(so.transform.position);
      expect(obj.scanMatch?.roomPlanCategory).toBe(so.category);
      expect(obj.source).toBe('roomplan_approximation');
      const sameYaw = Math.abs(yawFromQuat(obj.transform.rotation) - yawFromQuat(so.transform.rotation)) < 1e-9;
      if (sameYaw) expect(obj.dimensionsM).toEqual(so.dimensionsM);
      expect(reproduceScanObject(so, catalog)).toEqual(obj);
    }
  });

  it('the demo scan reproduces into a scene with no error-level violations', () => {
    const shell = normalizeShell(fixture.shell);
    const objects = fixture.scanObjects.map((so) => reproduceScanObject(so, catalog));
    expect(objects.filter((o) => o.assetId === null).map((o) => o.category).sort()).toEqual(['fireplace', 'storage']);
    expect(validateScene({ shell }, { objects }).ok).toBe(true);
  });
});

describe('findFreeSpot', () => {
  it('nudges a new object off an occupied spot to a violation-free one', () => {
    const fixture = ScanFixtureSchema.parse(scan);
    const shell = normalizeShell(fixture.shell);
    const objects = fixture.scanObjects.map((so) => reproduceScanObject(so, catalog));
    const sofaPos = objects[0]!.transform.position;
    const chair = objectFromAsset(catalog.find((a) => a.id === 'chair-side')!, 'new-chair', [sofaPos[0], 0, sofaPos[2]]);
    const r = findFreeSpot({ shell }, { objects }, chair, [sofaPos[0], sofaPos[2]]);
    expect(r.found).toBe(true);
    expect(r.violations).toEqual([]);
    const moved = { ...chair, transform: { ...chair.transform, position: r.position } };
    expect(validateScene({ shell }, { objects: [...objects, moved] }).violations.filter((v) => v.objectId === 'new-chair' || v.otherId === 'new-chair')).toEqual([]);
  });
});
