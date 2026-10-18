import {
  SceneOpSchema,
  type SceneObject,
  type SceneOp,
  type SceneSpec,
} from "@house/contracts";
import { applyOp, type SceneContext } from "./operations";
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
const same = (a: unknown, b: unknown) =>
  stableStringify(a) === stableStringify(b);
function ordered(objects: SceneObject[]) {
  const done = new Set<string>(),
    result: SceneObject[] = [];
  const visit = (o: SceneObject) => {
    if (done.has(o.id)) return;
    done.add(o.id);
    const p = objects.find((p) => p.id === o.placement?.parentId);
    if (p) visit(p);
    result.push(o);
  };
  objects.forEach(visit);
  return result;
}
/** Reconstruct a scene with validated, ordered contract ops; never rely on selection state. */
export function diffToOps(
  from: SceneSpec,
  to: SceneSpec,
  ctx: SceneContext,
): { ok: true; ops: SceneOp[] } | { ok: false; message: string } {
  let current = structuredClone(from);
  const ops: SceneOp[] = [];
  try {
    const push = (input: SceneOp) => {
      const op = SceneOpSchema.parse(input);
      const r = applyOp(current, op, ctx, { allowConflicts: true });
      if (!r.ok) throw new Error(`${op.type}: ${r.error.message}`);
      current = r.scene;
      ops.push(op);
    };
    const target = new Map(to.objects.map((o) => [o.id, o]));
    const get = (id: string) => current.objects.find((o) => o.id === id)!;
    const geometry = new Set(
      from.objects
        .filter((o) => {
          const t = target.get(o.id);
          return (
            !t ||
            !same(o.transform, t.transform) ||
            !same(o.dimensionsM, t.dimensionsM) ||
            o.assetId !== t.assetId
          );
        })
        .map((o) => o.id),
    );
    // Unlock only affected members, then detach support edges that would carry twice or block removal.
    for (const o of from.objects)
      if (o.locked && (!target.has(o.id) || !same(o, target.get(o.id))))
        push({ type: "setLock", objectId: o.id, locked: false });
    for (const o of from.objects)
      if (
        target.has(o.id) &&
        o.placement?.support === "object" &&
        (geometry.has(o.placement.parentId!) ||
          !same(o.placement, target.get(o.id)?.placement))
      ) {
        if (get(o.id).locked)
          push({ type: "setLock", objectId: o.id, locked: false });
        push({
          type: "setPlacement",
          objectId: o.id,
          placement: { support: "floor", float: true },
        });
      }
    for (const o of ordered(from.objects).reverse())
      if (!target.has(o.id)) push({ type: "delete", objectId: o.id });
    for (const t of ordered(to.objects))
      if (!get(t.id)) push({ type: "add", object: t });
    for (const t of ordered(to.objects)) {
      let c = get(t.id);
      const changed = !same(c, t);
      if (c.locked && changed)
        push({ type: "setLock", objectId: t.id, locked: false });
      c = get(t.id);
      if (c.assetId !== t.assetId)
        push({
          type: "replaceAsset",
          objectId: t.id,
          assetId: t.assetId,
          dimensionsM: t.dimensionsM,
        });
      else if (!same(c.dimensionsM, t.dimensionsM))
        push({ type: "resize", objectId: t.id, dimensionsM: t.dimensionsM });
      if (!same(get(t.id).transform, t.transform))
        push({ type: "move", objectId: t.id, transform: t.transform });
      c = get(t.id);
      if (!same(c.materialOverrides, t.materialOverrides))
        push({
          type: "changeMaterial",
          objectId: t.id,
          overrides: t.materialOverrides,
        });
      if (c.groupId !== t.groupId)
        push({ type: "setGroup", objectId: t.id, groupId: t.groupId });
      if (c.lightOn !== t.lightOn)
        push({ type: "setLight", objectId: t.id, lightOn: t.lightOn });
      if (c.renovationDecision !== t.renovationDecision)
        push({
          type: "setPlan",
          objectId: t.id,
          decision: t.renovationDecision,
        });
    }
    for (const t of ordered(to.objects)) {
      if (!same(get(t.id).placement, t.placement))
        push({ type: "setPlacement", objectId: t.id, placement: t.placement });
      if (get(t.id).locked !== t.locked)
        push({ type: "setLock", objectId: t.id, locked: t.locked });
    }
    if (!same(current.appearance, to.appearance))
      push({ type: "setAppearance", appearance: to.appearance });
    const key = (s: SceneSpec) =>
      stableStringify({
        ...s,
        revision: 0,
        updatedAt: "",
        objects: [...s.objects].sort((a, b) => a.id.localeCompare(b.id)),
      });
    if (key(current) !== key(to))
      throw new Error(
        "This change cannot be represented by the contract operations.",
      );
    return { ok: true, ops };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Invalid patch",
    };
  }
}
