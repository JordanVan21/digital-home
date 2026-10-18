import type { AssetRequest } from "@house/contracts";
import type { GlbInspection } from "./glb";

export type GlbPolicy = {
  maxTriangles: number;
  maxTextureBytes: number;
  maxFileBytes: number;
  /** Same proportions rule as the retriever: no axis may fill less than this share of the target. */
  minAxisFill: number;
  /** Extensions our frontend loader is not configured to decode. */
  forbiddenExtensions: string[];
};

export const DEFAULT_GLB_POLICY: GlbPolicy = {
  maxTriangles: 150_000,
  maxTextureBytes: 16 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  minAxisFill: 0.55,
  forbiddenExtensions: ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"],
};

export type GlbValidation = { ok: boolean; errors: string[]; warnings: string[] };

/**
 * The gate every generated model passes before it can become a verified asset.
 * Errors are written for the generating agent to act on.
 */
export function validateGlb(
  inspection: GlbInspection,
  request: Pick<AssetRequest, "targetDimensionsM">,
  policy: GlbPolicy = DEFAULT_GLB_POLICY
): GlbValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (inspection.triangleCount === 0) errors.push("Model has no triangle geometry. Create solid mesh objects before exporting.");
  if (inspection.nonTriangleGeometry) warnings.push("Points/lines in the model are ignored by the renderer.");
  if (inspection.triangleCount > policy.maxTriangles) errors.push(`Model has ${inspection.triangleCount} triangles; the limit is ${policy.maxTriangles}. Reduce subdivision/bevel segments.`);
  if (inspection.textureBytes > policy.maxTextureBytes) errors.push(`Textures total ${inspection.textureBytes} bytes; the limit is ${policy.maxTextureBytes}. Use flat material colors instead of large textures.`);
  if (inspection.fileBytes > policy.maxFileBytes) errors.push(`File is ${inspection.fileBytes} bytes; the limit is ${policy.maxFileBytes}.`);
  if (inspection.externalResources.length) errors.push("Model references external files; export as a self-contained .glb.");
  for (const ext of inspection.requiredExtensions) {
    if (policy.forbiddenExtensions.includes(ext)) errors.push(`Required extension ${ext} is not supported by the viewer. Export without compression.`);
  }
  if (inspection.triangleCount > 0) {
    const size = inspection.size;
    if (!size.every((n) => Number.isFinite(n) && n > 1e-3)) {
      errors.push(`Model has a degenerate dimension (${size.map((n) => n.toFixed(3)).join(" x ")} m).`);
    } else {
      const target = request.targetDimensionsM;
      const scale = Math.min(...target.map((t, i) => t / size[i]));
      const fills = size.map((s, i) => (s * scale) / target[i]);
      const worst = Math.min(...fills);
      if (worst < policy.minAxisFill) {
        errors.push(
          `Proportions do not fit the target ${target.map((n) => n.toFixed(2)).join(" x ")} m (width x height x depth): ` +
          `model is ${size.map((n) => n.toFixed(2)).join(" x ")} m and would fill only ${(worst * 100).toFixed(0)}% of one axis. Rebuild with proportions closer to the target.`
        );
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}
