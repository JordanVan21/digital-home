import { z } from "zod";
import { UUID, Vec3, Money } from "./primitives";

/** Catalog asset metadata. See CONTRACTS.md §2. */
export const AssetSpec = z.object({
  schemaVersion: z.literal(1),
  id: UUID,
  category: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  styles: z.array(z.string()),
  colors: z.array(z.string()),
  materials: z.array(z.string()),
  dimensionsM: Vec3, // x width, y height, z depth
  glbStorageKey: z.string(),
  thumbnailStorageKey: z.string().optional(),
  source: z.enum(["furnimesh", "self_authored", "other", "generated"]),
  sourceUrl: z.string().url().optional(),
  licenseStatus: z.enum(["verified", "pending", "restricted"]),
  attribution: z.string().optional(),
  estimatedPrice: Money.optional(),
  triangleCount: z.number().int().nonnegative().optional(),
  textureBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string(),
  searchableDescription: z.string(),
  embeddingVersion: z.string().optional(),
});
export type AssetSpec = z.infer<typeof AssetSpec>;
