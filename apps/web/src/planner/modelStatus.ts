import type { AssetSpec, SceneObject, SceneSpec } from "@house/contracts";

export type ModelStatus = "ready" | "loading" | "placeholder" | "failed";
export type ModelStatuses = Record<string, ModelStatus>;
export const modelKey = (object: SceneObject) =>
  `${object.id}:${object.assetId}`;
const path = (url: string) =>
  url.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0];

export function modelStatuses(
  scene: SceneSpec,
  assets: Record<string, AssetSpec>,
  loaded: ReadonlySet<string>,
  errors: string[],
): ModelStatuses {
  return Object.fromEntries(
    scene.objects.map((object) => {
      const asset = object.assetId ? assets[object.assetId] : undefined;
      const state: ModelStatus = !asset
        ? "placeholder"
        : errors.some((url) => path(url) === path(asset.glbStorageKey))
          ? "failed"
          : loaded.has(modelKey(object))
            ? "ready"
            : "loading";
      return [object.id, state];
    }),
  );
}
