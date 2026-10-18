import type { AssetSpec, CollisionKind, SceneObject, Vec2, Vec3 } from '@house/contracts';
import { categoryRule } from './config';
import { renderedSize } from './fit';
import { exposedTopFaces, shapeOfAsset } from './shapes';
import { add2, rotateXZ, yawFromQuat } from './math';
import { effectiveDims, type OBB } from './obb';


/**
 * Bodies: an object's effective (tilted) size, compound collision boxes and support surfaces.
 * Everything here is boxes and polygons; there is no mesh-level collision.
 */

export type AssetLookup = (assetId: string) => AssetSpec | undefined;

/** Box in object-local meters (after tilt), origin at the footprint's base center, front = +Z. */
export type LocalBox = { min: Vec3; max: Vec3 };

/** `shaped` = an exposed top face of the model's baked shape (subject to the no-penetration rule). */
export type LocalSurface = { id: string; y: number; polygon: Vec2[]; maxItemHeightM?: number; shaped?: boolean };

export type WorldSurface = {
  ownerId: string;
  id: string;
  /** World height of the surface. */
  y: number;
  polygon: Vec2[];
  maxItemHeightM?: number;
  /** Face of the owner's baked shape: an item resting here must not intersect the rest of that shape. */
  shaped?: boolean;
};

export function assetOf(obj: Pick<SceneObject, 'assetId'>, assets?: AssetLookup): AssetSpec | undefined {
  return obj.assetId && assets ? assets(obj.assetId) : undefined;
}

export function effectiveDimsOf(obj: Pick<SceneObject, 'dimensionsM' | 'tilt'>): Vec3 {
  return effectiveDims(obj.dimensionsM, obj.tilt);
}

export function collisionKindOf(obj: Pick<SceneObject, 'category' | 'assetId'>, assets?: AssetLookup): CollisionKind {
  return assetOf(obj, assets)?.collision?.kind ?? categoryRule(obj.category).collision;
}

/** Collision boxes in object-local meters. */
export function localBoxes(obj: SceneObject, assets?: AssetLookup): { kind: CollisionKind; boxes: LocalBox[] } {
  const asset = assetOf(obj, assets);
  const profile = asset?.collision;
  const kind = profile?.kind ?? categoryRule(obj.category).collision;
  const [w, h, d] = effectiveDimsOf(obj);
  const full: LocalBox = { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
  if (profile?.boxes?.length) {
    return {
      kind,
      boxes: profile.boxes.map((b) => ({
        min: [b.min[0] * w, b.min[1] * h, b.min[2] * d],
        max: [b.max[0] * w, b.max[1] * h, b.max[2] * d],
      })),
    };
  }
  switch (kind) {
    case 'table': {
      const t = Math.min(profile?.slabM ?? 0.04, h * 0.3);
      const leg = Math.min(0.06, w * 0.15, d * 0.15);
      const inset = Math.min(0.02, w * 0.05, d * 0.05);
      const lx = w / 2 - inset - leg / 2;
      const lz = d / 2 - inset - leg / 2;
      const legs: LocalBox[] = [[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].map(([x, z]) => ({
        min: [x! - leg / 2, 0, z! - leg / 2], max: [x! + leg / 2, h - t, z! + leg / 2],
      }));
      return { kind, boxes: [{ min: [-w / 2, h - t, -d / 2], max: [w / 2, h, d / 2] }, ...legs] };
    }
    case 'chair': {
      // Seat block (legs + seat) plus a back slab: the seat tucks under a table top, the back doesn't.
      const seatTop = h * 0.5;
      const back = Math.max(0.05, d * 0.14);
      return {
        kind,
        boxes: [
          { min: [-w / 2, 0, -d / 2], max: [w / 2, seatTop, d / 2] },
          { min: [-w / 2, 0, -d / 2], max: [w / 2, h, -d / 2 + back] },
        ],
      };
    }
    case 'open': {
      const t = profile?.slabM ?? 0.025;
      const side = Math.min(0.03, w * 0.05);
      const boards = (profile?.boards ?? [0, 0.25, 0.5, 0.75, 1]).map((yn) => {
        const top = Math.max(t, Math.min(h, yn * h));
        return { min: [-w / 2, top - t, -d / 2], max: [w / 2, top, d / 2] } as LocalBox;
      });
      return {
        kind,
        boxes: [
          { min: [-w / 2, 0, -d / 2], max: [-w / 2 + side, h, d / 2] },
          { min: [w / 2 - side, 0, -d / 2], max: [w / 2, h, d / 2] },
          ...boards,
        ],
      };
    }
    default:
      return { kind, boxes: [full] };
  }
}

function rect(x0: number, z0: number, x1: number, z1: number): Vec2[] {
  // Counter-clockwise viewed from +Y (shoelace < 0 in raw x/z), matching floor polygons.
  return [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
}

/** Smallest face (each side, m) that still counts as a surface, and the lowest (m above its base). */
const MIN_FACE_M = 0.03;
const MIN_FACE_HEIGHT_M = 0.02;

/**
 * The model's baked shape in object-local meters (base-centre origin), sized as it is drawn. Null for
 * proxies, alpha-tested models, stale profiles and tilted decor. Used for surfaces, never collision.
 */
export function shapeLocalBoxes(obj: SceneObject, assets?: AssetLookup): LocalBox[] | null {
  const asset = assetOf(obj, assets);
  const tilted = !!obj.tilt && (obj.tilt.x !== 0 || obj.tilt.z !== 0);
  const shape = tilted ? null : shapeOfAsset(asset);
  if (!shape || !asset) return null;
  const [W, H, D] = renderedSize(asset.dimensionsM, obj.dimensionsM);
  return shape.map(([lo, hi]) => ({
    min: [(lo[0] - 0.5) * W, lo[1] * H, (lo[2] - 0.5) * D],
    max: [(hi[0] - 0.5) * W, hi[1] * H, (hi[2] - 0.5) * D],
  }));
}

/**
 * Support surfaces in object-local meters. Precedence (merge decision 4.1):
 * 1. surfaces authored in the catalog (`asset.supports`);
 * 2. for downloaded / scanned models, the real exposed top faces of the baked shape (codex) — seats,
 *    shelves, table tops (4 cm voxel accuracy);
 * 3. jordan's category defaults (top / seat / boards): self-authored procedural models (exact boxes,
 *    so these are exact) and models without a shape.
 * Rugs (collision `flat`) never hold things.
 */
export function localSurfaces(obj: SceneObject, assets?: AssetLookup): LocalSurface[] {
  const asset = assetOf(obj, assets);
  const [w, h, d] = effectiveDimsOf(obj);
  if (collisionKindOf(obj, assets) === 'flat') return [];
  if (!asset?.supports && asset?.source !== 'self_authored') {
    const tilted = !!obj.tilt && (obj.tilt.x !== 0 || obj.tilt.z !== 0);
    const shape = tilted ? null : shapeOfAsset(asset);
    if (shape && asset) {
      const [W, H, D] = renderedSize(asset.dimensionsM, obj.dimensionsM);
      return exposedTopFaces(shape)
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => (f.rect[2] - f.rect[0]) * W >= MIN_FACE_M && (f.rect[3] - f.rect[1]) * D >= MIN_FACE_M && f.y * H >= MIN_FACE_HEIGHT_M)
        .map(({ f, i }) => ({
          id: `face-${i}`,
          y: f.y * H,
          polygon: rect((f.rect[0] - 0.5) * W, (f.rect[1] - 0.5) * D, (f.rect[2] - 0.5) * W, (f.rect[3] - 0.5) * D),
          shaped: true,
        }));
    }
  }
  if (asset?.supports) {
    return asset.supports.map((s) => ({
      id: s.id,
      y: s.y * h,
      polygon: (s.polygon ?? rect(-0.5, -0.5, 0.5, 0.5)).map(([x, z]) => [x * w, z * d] as Vec2),
      ...(s.maxItemHeightM !== undefined ? { maxItemHeightM: s.maxItemHeightM } : {}),
    }));
  }
  const inset = Math.min(0.01, w * 0.05, d * 0.05);
  switch (categoryRule(obj.category).supports ?? 'none') {
    case 'top':
      return [{ id: 'top', y: h, polygon: rect(-w / 2 + inset, -d / 2 + inset, w / 2 - inset, d / 2 - inset) }];
    case 'seat': {
      const arm = Math.min(0.18, w * 0.1);
      const backFrame = Math.min(0.12, d * 0.15);
      return [{ id: 'seat', y: h * 0.55, polygon: rect(-w / 2 + arm, -d / 2 + backFrame, w / 2 - arm, d / 2 - inset), maxItemHeightM: h }];
    }
    case 'boards': {
      const { boxes } = localBoxes(obj, assets);
      const boardTops = boxes.filter((b) => b.max[0] - b.min[0] > w * 0.5).map((b) => b.max[1]).sort((a, b) => a - b);
      const side = Math.min(0.03, w * 0.05);
      return boardTops.map((top, i) => {
        const next = boardTops[i + 1];
        const t = next !== undefined ? next - top - (asset?.collision?.slabM ?? 0.025) : undefined;
        return {
          id: `board-${i}`,
          y: top,
          polygon: rect(-w / 2 + side, -d / 2 + inset, w / 2 - side, d / 2 - inset),
          ...(t !== undefined ? { maxItemHeightM: Math.max(0, t) } : {}),
        };
      });
    }
    default:
      return [];
  }
}

function toWorld(p: Vec2, pos: Vec3, yaw: number): Vec2 {
  return add2(rotateXZ(p, yaw), [pos[0], pos[2]]);
}

/** Collision boxes in world space (yaw-aligned OBBs). */
export function worldBoxes(obj: SceneObject, assets?: AssetLookup): { kind: CollisionKind; boxes: OBB[] } {
  const { kind, boxes } = localBoxes(obj, assets);
  const yaw = yawFromQuat(obj.transform.rotation);
  const pos = obj.transform.position;
  const u: Vec2 = [Math.cos(yaw), -Math.sin(yaw)];
  const v: Vec2 = [Math.sin(yaw), Math.cos(yaw)];
  return {
    kind,
    boxes: boxes.map((b) => ({
      center: toWorld([(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2], pos, yaw),
      u, v,
      halfW: (b.max[0] - b.min[0]) / 2,
      halfD: (b.max[2] - b.min[2]) / 2,
      yMin: pos[1] + b.min[1],
      yMax: pos[1] + b.max[1],
    })),
  };
}

export function worldSurfaces(obj: SceneObject, assets?: AssetLookup): WorldSurface[] {
  const yaw = yawFromQuat(obj.transform.rotation);
  const pos = obj.transform.position;
  return localSurfaces(obj, assets).map((s) => ({
    ownerId: obj.id,
    id: s.id,
    y: pos[1] + s.y,
    polygon: s.polygon.map((p) => toWorld(p, pos, yaw)),
    ...(s.maxItemHeightM !== undefined ? { maxItemHeightM: s.maxItemHeightM } : {}),
    ...(s.shaped ? { shaped: true } : {}),
  }));
}
