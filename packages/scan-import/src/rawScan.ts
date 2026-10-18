import { z } from "zod";

/**
 * Raw scan export emitted by the iOS RoomScanKit module (apps/ios). It is a
 * lossless-enough dump of Apple's CapturedRoom, NOT the normalized contract:
 * coordinates are still in RoomPlan's world frame (ARKit: meters, Y up,
 * right-handed). Only `normalizeRoomScan` converts it, exactly once.
 *
 * Matrices are 4x4, column-major (simd_float4x4 order): m[12..14] is the
 * translation, m[0..2] the local X axis, m[4..6] Y, m[8..10] Z.
 */
const finite = z.number().finite();
export const Matrix4 = z.array(finite).length(16);
const Dims = z.tuple([finite, finite, finite]);
const Point3 = z.tuple([finite, finite, finite]);

export const RawSurface = z.object({
  id: z.string(),
  category: z.string(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  transform: Matrix4,
  /** [width, height, thickness]; RoomPlan reports thickness 0 for surfaces. */
  dimensions: Dims,
  /** Optional floor outline (iOS 17 floors), RoomPlan world coordinates. */
  polygonCorners: z.array(Point3).optional(),
});
export type RawSurface = z.infer<typeof RawSurface>;

export const RawObject = z.object({
  id: z.string(),
  category: z.string(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  transform: Matrix4,
  /** [width, height, depth] in the object's local frame. */
  dimensions: Dims,
});
export type RawObject = z.infer<typeof RawObject>;

export const RawRoomScan = z.object({
  schemaVersion: z.literal(1),
  /** Client-generated UUID; also the idempotency key for upload completion. */
  scanId: z.string().uuid(),
  capturedAt: z.string().datetime({ offset: true }),
  device: z.object({ model: z.string(), systemVersion: z.string() }).optional(),
  walls: z.array(RawSurface),
  doors: z.array(RawSurface),
  windows: z.array(RawSurface),
  openings: z.array(RawSurface),
  floors: z.array(RawSurface).default([]),
  objects: z.array(RawObject),
});
export type RawRoomScan = z.infer<typeof RawRoomScan>;
