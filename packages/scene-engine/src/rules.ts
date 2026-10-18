import type { PlacementClass, RoomShell, SceneObject, SceneSpec, Vec2 } from '@house/contracts';
import { assetOf, collisionKindOf, type AssetLookup } from './body';
import { bodyOf, bodyContact, partsAbove } from './collision';
import { canRestOn, DEFAULT_RULE_CONFIG, placementClassOf, type RuleConfig } from './config';
import { add2, angleDiff, dot2, scale2, sub2, yawFromQuat } from './math';
import { obbCorners, obbOf, obbOverlap, type OBB } from './obb';
import { pointSegmentDistance, polygonInsidePolygon } from './polygon';
import { approachZone, openingFrames, wallFrames, type OpeningFrame, type WallFrame } from './shell';
import { restingSurface, restsOn } from './support';

export type RuleId =
  | 'inside_room'
  | 'wall_mount'
  | 'ceiling_mount'
  | 'door_clearance'
  | 'opening_overlap'
  | 'overlap'
  | 'support'
  | 'nesting';

export type Severity = 'error' | 'warning';

export type Violation = {
  rule: RuleId;
  severity: Severity;
  objectId: string;
  otherId?: string;
  detail: string;
};

export type ValidationResult = { ok: boolean; violations: Violation[] };

export type { AssetLookup };

export type RuleContext = {
  shell: RoomShell;
  assets?: AssetLookup;
  config?: Partial<RuleConfig>;
};

/** Precomputed shell geometry; cached per shell object. */
export type PreparedShell = {
  shell: RoomShell;
  polygon: Vec2[];
  walls: WallFrame[];
  openings: OpeningFrame[];
  ceilingY: number;
};

const prepared = new WeakMap<RoomShell, PreparedShell>();

export function prepareShell(shell: RoomShell): PreparedShell {
  let p = prepared.get(shell);
  if (!p) {
    const walls = wallFrames(shell);
    p = {
      shell,
      polygon: shell.floor.polygonXZ,
      walls,
      openings: openingFrames(shell, walls),
      ceilingY: shell.floor.elevationY + (shell.ceilingHeightM ?? Math.max(2.4, ...shell.walls.map((w) => w.heightM))),
    };
    prepared.set(shell, p);
  }
  return p;
}

export type ObjectIndex = ReadonlyMap<string, SceneObject>;

export function indexObjects(objects: readonly SceneObject[]): Map<string, SceneObject> {
  return new Map(objects.map((o) => [o.id, o]));
}

export function classOf(ctx: Pick<RuleContext, 'assets'>, obj: SceneObject): PlacementClass {
  return placementClassOf(obj, assetOf(obj, ctx.assets));
}

/** True if `ancestorId` is `obj`'s parent, grandparent, … (cycle-safe). */
export function isAncestor(index: ObjectIndex, ancestorId: string, obj: SceneObject): boolean {
  let cur = obj.placement?.parentId;
  for (let guard = 0; cur && guard < 64; guard++) {
    if (cur === ancestorId) return true;
    cur = index.get(cur)?.placement?.parentId;
  }
  return false;
}

function hasCycle(index: ObjectIndex, obj: SceneObject): boolean {
  const seen = new Set<string>([obj.id]);
  let cur = obj.placement?.parentId;
  while (cur) {
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = index.get(cur)?.placement?.parentId;
  }
  return false;
}

export function ruleConfig(ctx: Pick<RuleContext, 'config'>): RuleConfig {
  return ctx.config ? { ...DEFAULT_RULE_CONFIG, ...ctx.config } : DEFAULT_RULE_CONFIG;
}

/** Back-face center of an OBB (opposite its +Z front). */
function backCenter(b: OBB): Vec2 {
  return sub2(b.center, scale2(b.v, b.halfD));
}

const nameOf = (o: SceneObject) => o.displayName || o.category.replace(/_/g, ' ');

/** Rules that involve one object and the shell / its support. */
export function singleObjectViolations(ctx: RuleContext, index: ObjectIndex, obj: SceneObject, box = obbOf(obj)): Violation[] {
  const c = ruleConfig(ctx);
  const shell = prepareShell(ctx.shell);
  const cls = classOf(ctx, obj);
  const out: Violation[] = [];
  const v = (rule: RuleId, severity: Severity, detail: string, otherId?: string) =>
    out.push(otherId ? { rule, severity, objectId: obj.id, otherId, detail } : { rule, severity, objectId: obj.id, detail });
  const floorY = ctx.shell.floor.elevationY;

  // Footprint inside the floor polygon (every class).
  if (!polygonInsidePolygon(obbCorners(box), shell.polygon, c.containmentToleranceM)) {
    v('inside_room', 'error', 'Outside the room.');
  }

  if (cls === 'wall') {
    const back = backCenter(box);
    const near = shell.walls.filter((w) => pointSegmentDistance(back, w.from, w.to) <= c.wallMountToleranceM);
    if (near.length === 0) v('wall_mount', 'warning', 'Not mounted on a wall.');
    else if (near.length > 1) v('wall_mount', 'warning', 'Touches more than one wall.');
    else {
      const w = near[0]!;
      if (angleDiff(yawFromQuat(obj.transform.rotation), w.inwardYaw) > c.wallYawToleranceRad) v('wall_mount', 'warning', 'Not aligned with its wall.');
      const s = dot2(sub2(back, w.from), w.dir);
      for (const o of shell.openings) {
        if (o.frame.wall.id !== w.wall.id) continue;
        const along = Math.min(s + box.halfW, o.opening.offsetM + o.opening.widthM) - Math.max(s - box.halfW, o.opening.offsetM);
        const vert = Math.min(box.yMax, o.opening.bottomM + o.opening.heightM) - Math.max(box.yMin, o.opening.bottomM);
        if (along > c.contactToleranceM && vert > c.contactToleranceM) v('opening_overlap', 'warning', `Covers a ${o.opening.kind}.`);
      }
    }
  } else if (cls === 'ceiling') {
    if (box.yMax > shell.ceilingY + c.supportToleranceM) v('ceiling_mount', 'warning', 'Pokes through the ceiling.');
    if (box.yMin < floorY + c.ceilingMinBottomM - 1e-9) v('ceiling_mount', 'warning', `Hangs too low (min ${Math.round(c.ceilingMinBottomM * 100)} cm above the floor).`);
  }

  // Door / opening approach zones: free-standing things on the floor.
  const kind = collisionKindOf(obj, ctx.assets);
  const onFloor = !obj.placement?.parentId && (cls === 'floor' || (cls === 'flat' && c.flatDoorClearance));
  if (onFloor && kind !== 'soft' && kind !== 'none') {
    for (const o of shell.openings) {
      if (o.opening.kind === 'window') continue;
      const zone = approachZone(o, Math.min(c.doorZoneMaxDepthM, c.doorZoneDepth === 'width' ? o.opening.widthM : c.doorZoneDepth));
      const testBox = cls === 'flat' ? { ...box, yMax: Math.max(box.yMax, zone.yMin + 0.01) } : box;
      if (obbOverlap(testBox, zone, c.contactToleranceM)) v('door_clearance', 'warning', `Blocks the ${o.opening.kind === 'door' ? 'door' : 'opening'}.`);
    }
  }

  // Support / nesting.
  const parentId = obj.placement?.parentId;
  if (parentId) {
    const parent = index.get(parentId);
    if (!parent) v('nesting', 'error', 'Rests on an object that does not exist.', parentId);
    else if (hasCycle(index, obj)) v('nesting', 'error', 'Support chain forms a cycle.', parentId);
    else if (!canRestOn(obj.category, parent.category, cls)) v('nesting', 'warning', `A ${obj.category.replace(/_/g, ' ')} can't rest on a ${parent.category.replace(/_/g, ' ')}.`, parent.id);
    else {
      const surface = restingSurface(parent, obj, ctx.assets, c.supportToleranceM);
      if (!surface) v('support', 'warning', `Not resting on ${nameOf(parent)}.`, parent.id);
      else if (!restsOn(obj, surface, parent, ctx.assets)) v('support', 'warning', `Not resting properly on ${nameOf(parent)} (centre off the edge, or sinking into it).`, parent.id);
    }
  } else if ((cls === 'floor' || cls === 'flat') && !obj.placement?.float) {
    if (Math.abs(box.yMin - floorY) > c.supportToleranceM) v('support', 'warning', 'Floating — let it settle or turn on Float.');
  }
  return out;
}

/** Pairs that never collide: parent/child chains (an item never collides with what it rests on). */
export function overlapExempt(index: ObjectIndex, a: SceneObject, b: SceneObject): boolean {
  return isAncestor(index, a.id, b) || isAncestor(index, b.id, a);
}

/**
 * A child vs the parts of its direct parent that rise above its seat (backrest, arms, shelf above).
 * The surface itself stays exempt; touching sides counts as a collision.
 */
function pokesIntoParent(ctx: Pick<RuleContext, 'assets'>, child: SceneObject, parent: SceneObject, cfg: ReturnType<typeof ruleConfig>, childBody = bodyOf(child, ctx.assets)): boolean {
  if (child.placement?.parentId !== parent.id) return false;
  const parts = partsAbove(parent, child.transform.position[1], ctx.assets);
  return !!parts && !!bodyContact(childBody, parts, cfg);
}

/** Pairwise collisions of `obj` against `others` using collision profiles. */
export function overlapViolations(ctx: RuleContext, index: ObjectIndex, obj: SceneObject, others: Iterable<SceneObject>): Violation[] {
  const cfg = ruleConfig(ctx);
  const a = bodyOf(obj, ctx.assets);
  const out: Violation[] = [];
  for (const other of others) {
    if (other.id === obj.id) continue;
    if (overlapExempt(index, obj, other)) {
      if (pokesIntoParent(ctx, obj, other, cfg, a)) out.push({ rule: 'overlap', severity: 'warning', objectId: obj.id, otherId: other.id, detail: `Pokes into ${nameOf(other)}.` });
      else if (pokesIntoParent(ctx, other, obj, cfg)) out.push({ rule: 'overlap', severity: 'warning', objectId: obj.id, otherId: other.id, detail: `${nameOf(other)} pokes into it.` });
      continue;
    }
    if (bodyContact(a, bodyOf(other, ctx.assets), cfg)) {
      out.push({ rule: 'overlap', severity: 'warning', objectId: obj.id, otherId: other.id, detail: `Hits ${nameOf(other)}.` });
    }
  }
  return out;
}

/** All violations for one object (drag-time). `candidates` = broad-phase result; default all. */
export function validateObject(ctx: RuleContext, index: ObjectIndex, obj: SceneObject, candidates?: Iterable<SceneObject>): Violation[] {
  return [...singleObjectViolations(ctx, index, obj), ...overlapViolations(ctx, index, obj, candidates ?? index.values())];
}

/** Whole-scene validation. Each colliding pair is reported once. */
export function validateScene(ctx: RuleContext, scene: Pick<SceneSpec, 'objects'>): ValidationResult {
  const index = indexObjects(scene.objects);
  const objs = scene.objects;
  const cfg = ruleConfig(ctx);
  const bodies = objs.map((o) => bodyOf(o, ctx.assets));
  const violations: Violation[] = [];
  for (let i = 0; i < objs.length; i++) {
    violations.push(...singleObjectViolations(ctx, index, objs[i]!));
    for (let j = i + 1; j < objs.length; j++) {
      const a = objs[i]!;
      const b = objs[j]!;
      if (overlapExempt(index, a, b)) {
        if (pokesIntoParent(ctx, a, b, cfg, bodies[i]!)) violations.push({ rule: 'overlap', severity: 'warning', objectId: a.id, otherId: b.id, detail: `Pokes into ${nameOf(b)}.` });
        else if (pokesIntoParent(ctx, b, a, cfg, bodies[j]!)) violations.push({ rule: 'overlap', severity: 'warning', objectId: b.id, otherId: a.id, detail: `Pokes into ${nameOf(a)}.` });
        continue;
      }
      if (bodyContact(bodies[i]!, bodies[j]!, cfg)) {
        violations.push({ rule: 'overlap', severity: 'warning', objectId: a.id, otherId: b.id, detail: `Hits ${nameOf(b)}.` });
      }
    }
  }
  return { ok: !violations.some((x) => x.severity === 'error'), violations };
}

export function hasErrors(violations: readonly Violation[]): boolean {
  return violations.some((v) => v.severity === 'error');
}

/** Helper for UI: a point along a wall frame. */
export function pointOnWall(w: WallFrame, s: number, offsetIn = 0): Vec2 {
  return add2(add2(w.from, scale2(w.dir, s)), scale2(w.inward, offsetIn));
}
