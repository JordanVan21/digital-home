import type { AssetSpec, RoomShell, SceneObject, Support, Tilt, Vec2, Vec3 } from '@house/contracts';
import { makeTransform } from './math';

/**
 * Compact fixture format shared by the web tests and the backend (fixtures/*.json are
 * consumed unchanged; expand them with these helpers).
 */
export type CaseObject = {
  id: string;
  category: string;
  /** Base-center position [x, y, z]. */
  pos: Vec3;
  yawDeg?: number;
  /** [w, h, d] */
  dims: Vec3;
  support?: Support;
  parentId?: string;
  locked?: boolean;
  assetId?: string | null;
  tilt?: Tilt;
  float?: boolean;
};

export type CaseShell = {
  polygonXZ: Vec2[];
  walls?: { id: string; from: Vec2; to: Vec2 }[];
  openings?: { id: string; wallId: string; kind: 'door' | 'window' | 'opening'; offsetM: number; widthM: number; bottomM: number; heightM: number }[];
  heightM?: number;
};

export function expandCaseObject(c: CaseObject): SceneObject {
  return {
    id: c.id,
    assetId: c.assetId ?? null,
    category: c.category,
    transform: makeTransform(c.pos, ((c.yawDeg ?? 0) * Math.PI) / 180),
    dimensionsM: c.dims,
    locked: c.locked ?? false,
    source: 'user',
    displayName: c.id,
    placement: {
      support: c.support ?? (c.parentId ? 'object' : 'floor'),
      ...(c.parentId ? { parentId: c.parentId } : {}),
      ...(c.float ? { float: true } : {}),
    },
    ...(c.tilt ? { tilt: c.tilt } : {}),
  };
}

/** Walls default to one per polygon edge, in polygon order. */
export function expandCaseShell(s: CaseShell, id = '00000000-0000-4000-8000-000000000000'): RoomShell {
  const poly = s.polygonXZ;
  const walls = s.walls ?? poly.map((p, i) => ({ id: `w${i}`, from: p, to: poly[(i + 1) % poly.length]! }));
  return {
    id,
    sourceScanId: id,
    coordinateVersion: 1,
    floor: { polygonXZ: poly, elevationY: 0 },
    walls: walls.map((w) => ({ id: w.id, fromXZ: w.from, toXZ: w.to, heightM: s.heightM ?? 2.6, thicknessM: 0.1 })),
    openings: s.openings ?? [],
  };
}

export type CaseAsset = Pick<AssetSpec, 'id' | 'category' | 'dimensionsM'> & Partial<AssetSpec>;

export function expandCaseAsset(a: CaseAsset): AssetSpec {
  return {
    schemaVersion: 1,
    title: a.id,
    tags: [],
    styles: [],
    colors: [],
    materials: [],
    glbStorageKey: `${a.id}.glb`,
    source: 'self_authored',
    licenseStatus: 'verified',
    contentHash: a.id,
    searchableDescription: '',
    ...a,
  };
}
