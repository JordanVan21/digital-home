import type { AssetSpec, SceneObject, SceneSpec } from "@house/contracts";
const fallback: NonNullable<AssetSpec["light"]> = {
  kind: "point",
  color: "#ffcd80",
  intensity: 0.6,
  distanceM: 2.5,
  position: [0, 0.86, 0],
};
export const lightSpecFor = (
  o: SceneObject,
  assets: Readonly<Record<string, AssetSpec>>,
) =>
  (o.assetId ? assets[o.assetId]?.light : undefined) ??
  (o.category === "lamp" ? fallback : undefined);
/** One sun plus at most one shadowed practical light; other bulbs stay inexpensive. */
export function lightBudget(
  scene: SceneSpec,
  assets: Readonly<Record<string, AssetSpec>>,
) {
  const ids = scene.objects
    .filter((o) => o.lightOn !== false && lightSpecFor(o, assets))
    .map((o) => o.id)
    .slice(0, 8);
  return { active: new Set(ids), shadows: new Set(ids.slice(0, 1)) };
}
