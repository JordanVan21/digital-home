import type { AssetSpec, RoomShell, SceneSpec, Vec3 } from "@house/contracts";
import { surfaceFaces } from "./support";
/** Resize only the support. Seated pieces retain their own size and horizontal position. */
export function resizeAssembly(
  scene: SceneSpec,
  id: string,
  dimensionsM: Vec3,
  room: RoomShell,
  assets: Readonly<Record<string, AssetSpec>>,
): SceneSpec {
  let objects = scene.objects.map((o) =>
    o.id === id ? { ...o, dimensionsM: [...dimensionsM] as Vec3 } : o,
  );
  const visited = new Set<string>();
  const visit = (parentId: string) => {
    if (visited.has(parentId)) return;
    visited.add(parentId);
    for (const child of scene.objects.filter(
      (o) =>
        o.placement?.support === "object" && o.placement.parentId === parentId,
    )) {
      const current = { ...scene, objects };
      const faces = surfaceFaces(current, child, room, assets)
        .filter(
          (f) =>
            f.placement.support === "object" &&
            f.placement.parentId === parentId,
        )
        .sort(
          (a, b) =>
            Math.abs(
              a.heightY - (a.offsetY ?? 0) - child.transform.position[1],
            ) -
            Math.abs(
              b.heightY - (b.offsetY ?? 0) - child.transform.position[1],
            ),
        );
      const face = faces[0];
      if (face)
        objects = objects.map((o) =>
          o.id === child.id
            ? {
                ...o,
                transform: {
                  ...o.transform,
                  position: [
                    o.transform.position[0],
                    face.heightY - (face.offsetY ?? 0),
                    o.transform.position[2],
                  ],
                },
              }
            : o,
        );
      visit(child.id);
    }
  };
  visit(id);
  return { ...scene, objects };
}
