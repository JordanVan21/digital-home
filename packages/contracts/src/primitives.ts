import { z } from "zod";

/**
 * World distances are meters; axes X right, Y up, Z forward (R3F/Three convention).
 * Rotation is stored as a quaternion to avoid Euler serialization ambiguity.
 * See CONTRACTS.md §1.
 */
export const UUID = z.string().uuid();
export type UUID = z.infer<typeof UUID>;

export const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3>;

export const Quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Quat = z.infer<typeof Quat>;

export const Transform = z.object({
  position: Vec3,
  rotation: Quat,
  scale: Vec3,
});
export type Transform = z.infer<typeof Transform>;

export const Money = z.object({
  currency: z.literal("USD"),
  minor: z.number().int().nonnegative(), // integer cents
});
export type Money = z.infer<typeof Money>;

export const ISODateTime = z.string().datetime({ offset: true });
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
