// Value aliases with the names the scan pipeline (scan-import, render-agent,
// asset-service, worker) uses for runtime parsing. Each name is both the zod
// schema and its inferred type, so `AssetSpec.parse(x)` and `x: AssetSpec`
// both work. index.ts re-exports these explicitly, which takes precedence
// over the same-named types from `export * from "./schemas"`.
import type { z } from "zod";
import {
  AssetSpecSchema,
  OpeningSchema,
  RoomShellSchema,
  SceneObjectSchema,
  SceneOpSchema,
  SceneSpecSchema,
  UUIDSchema,
  Vec3Schema,
  WallSchema,
} from "./schemas";

export const AssetSpec = AssetSpecSchema;
export type AssetSpec = z.infer<typeof AssetSpecSchema>;
export const SceneSpec = SceneSpecSchema;
export type SceneSpec = z.infer<typeof SceneSpecSchema>;
export const SceneObject = SceneObjectSchema;
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export const SceneOp = SceneOpSchema;
export type SceneOp = z.infer<typeof SceneOpSchema>;
export const RoomShell = RoomShellSchema;
export type RoomShell = z.infer<typeof RoomShellSchema>;
export const Wall = WallSchema;
export type Wall = z.infer<typeof WallSchema>;
export const Opening = OpeningSchema;
export type Opening = z.infer<typeof OpeningSchema>;
export const UUID = UUIDSchema;
export type UUID = z.infer<typeof UUIDSchema>;
export const Vec3 = Vec3Schema;
export type Vec3 = z.infer<typeof Vec3Schema>;
