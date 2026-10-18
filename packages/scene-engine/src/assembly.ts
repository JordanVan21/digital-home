import type { SceneSpec, Transform } from "@house/contracts";
import { inverseRotation, multiplyRotation, rotateVector } from "./rotation";
/** Explicit support edges only: nearby or overlapping pieces never become a group. */
export function supportedDescendants(
  scene: SceneSpec,
  rootId: string,
): Set<string> {
  const ids = new Set<string>();
  const visit = (id: string) => {
    for (const o of scene.objects) {
      if (
        o.id === rootId ||
        ids.has(o.id) ||
        o.placement?.float ||
        o.placement?.support !== "object" ||
        o.placement.parentId !== id
      )
        continue;
      ids.add(o.id);
      visit(o.id);
    }
  };
  visit(rootId);
  return ids;
}
/** Preserve local offsets through a rigid translation/yaw and uniform scale.
 * Lock and validity checks belong to validateOp; this also powers transient previews. */
export function moveAssembly(
  scene: SceneSpec,
  rootId: string,
  transform: Transform,
): SceneSpec {
  const root = scene.objects.find((o) => o.id === rootId);
  if (!root) return scene;
  const ids = supportedDescendants(scene, rootId);
  const inverse = inverseRotation(root.transform.rotation);
  const delta = multiplyRotation(transform.rotation, inverse);
  const ratio = transform.scale.map((n, i) => n / root.transform.scale[i]);
  return {
    ...scene,
    objects: scene.objects.map((o) => {
      if (o.id === rootId)
        return { ...o, transform: structuredClone(transform) };
      if (!ids.has(o.id)) return o;
      const offset = o.transform.position.map(
        (n, i) => n - root.transform.position[i],
      ) as Transform["position"];
      const local = rotateVector(offset, inverse).map(
        (n, i) => n * ratio[i],
      ) as Transform["position"];
      const world = rotateVector(local, transform.rotation);
      return {
        ...o,
        transform: {
          position: world.map((n, i) => n + transform.position[i]),
          rotation: multiplyRotation(delta, o.transform.rotation),
          scale: o.transform.scale.map((n, i) => n * ratio[i]),
        } as Transform,
      };
    }),
  };
}
