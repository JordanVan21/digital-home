import type { SceneSpec, Transform } from "@house/contracts";
import { yawOf } from "./geometry";
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
  const fromYaw = yawOf(root.transform.rotation),
    toYaw = yawOf(transform.rotation),
    delta = toYaw - fromYaw;
  const c0 = Math.cos(fromYaw),
    s0 = Math.sin(fromYaw),
    c1 = Math.cos(toYaw),
    s1 = Math.sin(toYaw);
  const ratio = transform.scale.map((n, i) => n / root.transform.scale[i]);
  return {
    ...scene,
    objects: scene.objects.map((o) => {
      if (o.id === rootId)
        return { ...o, transform: structuredClone(transform) };
      if (!ids.has(o.id)) return o;
      const dx = o.transform.position[0] - root.transform.position[0],
        dz = o.transform.position[2] - root.transform.position[2];
      const x = (c0 * dx - s0 * dz) * ratio[0],
        z = (s0 * dx + c0 * dz) * ratio[2];
      const yaw = yawOf(o.transform.rotation) + delta;
      return {
        ...o,
        transform: {
          position: [
            transform.position[0] + c1 * x + s1 * z,
            transform.position[1] +
              (o.transform.position[1] - root.transform.position[1]) * ratio[1],
            transform.position[2] - s1 * x + c1 * z,
          ],
          rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
          scale: o.transform.scale.map((n, i) => n * ratio[i]),
        } as Transform,
      };
    }),
  };
}
