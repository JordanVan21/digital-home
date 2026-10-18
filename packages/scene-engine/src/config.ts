import type { AssetSpec, CollisionKind, PlacementClass, RoomPlanCategory, SceneObject } from '@house/contracts';

/**
 * Category rules — the "explicit category/support rules" CONTRACTS §4 asks for. Semantic
 * exemptions (rug under table, art on wall, vase on table, chair under desk) come from placement
 * classes, collision profiles and support surfaces here, never from blanket overlap permission.
 */
export type CategoryRule = {
  placementClass: PlacementClass;
  collision: CollisionKind;
  /** Default support surfaces offered to other objects (see support.ts for geometry). */
  supports?: 'top' | 'seat' | 'boards' | 'none';
  /** Large furniture always rests on the floor (never on another object). */
  large?: boolean;
  /** Small decor may be tilted in 90° steps. */
  tiltable?: boolean;
  /** Small decor doesn't cast shadows by default (shadow budget). */
  castShadow?: boolean;
};

const LARGE = { large: true } as const;

export const CATEGORY_RULES: Readonly<Record<string, CategoryRule>> = {
  sofa: { placementClass: 'floor', collision: 'solid', supports: 'seat', ...LARGE },
  armchair: { placementClass: 'floor', collision: 'solid', supports: 'seat', ...LARGE },
  bed: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  chair: { placementClass: 'floor', collision: 'chair', supports: 'none', ...LARGE },
  stool: { placementClass: 'floor', collision: 'solid', supports: 'top' },
  ottoman: { placementClass: 'floor', collision: 'solid', supports: 'top' },
  table: { placementClass: 'floor', collision: 'table', supports: 'top', ...LARGE },
  dining_table: { placementClass: 'floor', collision: 'table', supports: 'top', ...LARGE },
  coffee_table: { placementClass: 'floor', collision: 'table', supports: 'top', ...LARGE },
  side_table: { placementClass: 'floor', collision: 'table', supports: 'top', ...LARGE },
  desk: { placementClass: 'floor', collision: 'table', supports: 'top', ...LARGE },
  shelf: { placementClass: 'floor', collision: 'open', supports: 'boards', ...LARGE },
  storage: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  cabinet: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  dresser: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  nightstand: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  wardrobe: { placementClass: 'floor', collision: 'solid', supports: 'none', ...LARGE },
  floor_lamp: { placementClass: 'floor', collision: 'solid', supports: 'none', ...LARGE },
  plant: { placementClass: 'floor', collision: 'solid', supports: 'none' },
  tv: { placementClass: 'floor', collision: 'solid', supports: 'none' },
  refrigerator: { placementClass: 'floor', collision: 'solid', ...LARGE },
  stove: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  oven: { placementClass: 'floor', collision: 'solid', ...LARGE },
  dishwasher: { placementClass: 'floor', collision: 'solid', ...LARGE },
  sink: { placementClass: 'floor', collision: 'solid', ...LARGE },
  washer_dryer: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  toilet: { placementClass: 'floor', collision: 'solid', ...LARGE },
  bathtub: { placementClass: 'floor', collision: 'solid', ...LARGE },
  fireplace: { placementClass: 'floor', collision: 'solid', supports: 'top', ...LARGE },
  stairs: { placementClass: 'floor', collision: 'solid', ...LARGE },
  rug: { placementClass: 'flat', collision: 'flat', supports: 'none' },
  mat: { placementClass: 'flat', collision: 'flat', supports: 'none' },
  lamp: { placementClass: 'floor', collision: 'solid', supports: 'none', castShadow: false },
  decor: { placementClass: 'floor', collision: 'solid', supports: 'none', tiltable: true, castShadow: false },
  vase: { placementClass: 'floor', collision: 'solid', supports: 'none', castShadow: false },
  bowl: { placementClass: 'floor', collision: 'solid', supports: 'none', castShadow: false },
  tray: { placementClass: 'floor', collision: 'solid', supports: 'top', castShadow: false },
  book: { placementClass: 'floor', collision: 'solid', supports: 'top', tiltable: true, castShadow: false },
  basket: { placementClass: 'floor', collision: 'solid', supports: 'none' },
  small_plant: { placementClass: 'floor', collision: 'solid', supports: 'none', castShadow: false },
  pillow: { placementClass: 'floor', collision: 'soft', supports: 'none', tiltable: true, castShadow: false },
  throw: { placementClass: 'floor', collision: 'soft', supports: 'none', castShadow: false },
  wall_art: { placementClass: 'wall', collision: 'solid', supports: 'none', tiltable: true, castShadow: false },
  mirror: { placementClass: 'wall', collision: 'solid', supports: 'none' },
  wall_shelf: { placementClass: 'wall', collision: 'solid', supports: 'top' },
  wall_tv: { placementClass: 'wall', collision: 'solid', supports: 'none' },
  pendant: { placementClass: 'ceiling', collision: 'solid', supports: 'none', castShadow: false },
  hanging_plant: { placementClass: 'ceiling', collision: 'solid', supports: 'none', castShadow: false },
};

/** RoomPlan category → catalog categories, most typical first. One table, per the sandbox spec. */
export const ROOMPLAN_CATEGORY_MAP: Readonly<Record<RoomPlanCategory, readonly string[]>> = {
  storage: ['storage', 'shelf', 'cabinet', 'dresser'],
  refrigerator: ['refrigerator'],
  stove: ['stove'],
  bed: ['bed'],
  sink: ['sink'],
  washerDryer: ['washer_dryer'],
  toilet: ['toilet'],
  bathtub: ['bathtub'],
  oven: ['oven'],
  dishwasher: ['dishwasher'],
  table: ['table', 'desk', 'coffee_table', 'side_table'],
  sofa: ['sofa'],
  chair: ['chair', 'armchair'],
  fireplace: ['fireplace'],
  television: ['tv', 'wall_tv'],
  stairs: ['stairs'],
};

export type RuleConfig = {
  /** Penetration at or below this is contact, not collision (m). Back of sofa against wall, chair against desk. */
  contactToleranceM: number;
  /** Soft items (pillows, throws) may overlap each other by this much (m). */
  softOverlapM: number;
  /** Max back-face-to-wall distance for wall items (m). */
  wallMountToleranceM: number;
  /** Max yaw deviation from a wall's inward normal for wall items (rad). */
  wallYawToleranceRad: number;
  /** Approach-zone depth in front of doors/openings: 'width' = opening width, or meters. */
  doorZoneDepth: 'width' | number;
  /** Cap on the approach-zone depth (wide sliding doors shouldn't keep half the room clear). */
  doorZoneMaxDepthM: number;
  /** Whether flat items (rugs) are checked against door approach zones. */
  flatDoorClearance: boolean;
  /** Floor / surface contact tolerance (m). */
  supportToleranceM: number;
  /** Tolerance for footprint-in-polygon containment (m). */
  containmentToleranceM: number;
  /** Lowest allowed bottom edge for ceiling items above the floor (m). */
  ceilingMinBottomM: number;
};

export const DEFAULT_RULE_CONFIG: RuleConfig = {
  contactToleranceM: 1e-3,
  softOverlapM: 0.04,
  wallMountToleranceM: 0.03,
  wallYawToleranceRad: (2 * Math.PI) / 180,
  doorZoneDepth: 'width',
  doorZoneMaxDepthM: 1.0,
  flatDoorClearance: false,
  supportToleranceM: 0.01,
  containmentToleranceM: 1e-3,
  ceilingMinBottomM: 0.6,
};

/** Drag-time collision policy (one place; the web editor reads this). */
export type CollisionPolicy = 'block-and-slide' | 'allow-with-warning';
export const DEFAULT_COLLISION_POLICY: CollisionPolicy = 'block-and-slide';

export function categoryRule(category: string): CategoryRule {
  return CATEGORY_RULES[category] ?? { placementClass: 'floor', collision: 'solid', supports: 'none' };
}

/**
 * Placement class: asset override → contract `placement.support` (wall / ceiling) → category table.
 * 'surface' is treated like 'floor' (anything non-mounted rests on the floor or on a support).
 */
export function placementClassOf(obj: Pick<SceneObject, 'category' | 'placement'>, asset?: AssetSpec | null): PlacementClass {
  const raw = asset?.placementClass
    ?? (obj.placement?.support === 'wall' ? 'wall' : obj.placement?.support === 'ceiling' ? 'ceiling' : categoryRule(obj.category).placementClass);
  return raw === 'surface' ? 'floor' : raw;
}

/** Contract `placement.support` for a class and optional parent. */
export function supportForClass(cls: PlacementClass, hasParent = false): 'floor' | 'wall' | 'object' | 'ceiling' {
  if (cls === 'wall') return 'wall';
  if (cls === 'ceiling') return 'ceiling';
  return hasParent ? 'object' : 'floor';
}

export function isLarge(category: string): boolean {
  return categoryRule(category).large ?? false;
}

/**
 * Which categories may rest on which. Default: anything that isn't large furniture or mounted may
 * rest on any support surface it fits on (footprint + shelf gap are checked in support.ts).
 * Overrides: [childCategory, parentCategory] pairs that are always refused.
 */
export const REST_DENY: ReadonlyArray<readonly [string, string]> = [];

/** Upholstered seats only hold soft goods and light flat things (no plants, vases or lamps). */
export const SEAT_CATEGORIES: ReadonlySet<string> = new Set(['sofa', 'armchair', 'chair', 'ottoman']);
export const SEAT_OK: ReadonlySet<string> = new Set(['pillow', 'throw', 'book', 'tray', 'decor']);

export function canRestOn(childCategory: string, parentCategory: string, childClass?: PlacementClass): boolean {
  if (childClass === 'wall' || childClass === 'ceiling') return false;
  if (isLarge(childCategory)) return false;
  if (SEAT_CATEGORIES.has(parentCategory) && !SEAT_OK.has(childCategory)) return false;
  return !REST_DENY.some(([c, p]) => c === childCategory && p === parentCategory);
}

/** Kept for callers of the old API: a child may sit on a parent of this category. */
export function isNestingAllowed(childCategory: string, parentCategory: string): boolean {
  return canRestOn(childCategory, parentCategory) && (categoryRule(parentCategory).supports ?? 'none') !== 'none';
}

export function isTiltable(category: string, asset?: AssetSpec | null): boolean {
  return asset?.tiltable ?? categoryRule(category).tiltable ?? false;
}

export function castsShadow(category: string, asset?: AssetSpec | null): boolean {
  return asset?.castShadow ?? categoryRule(category).castShadow ?? true;
}
