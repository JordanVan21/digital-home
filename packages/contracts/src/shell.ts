import { z } from "zod";
import { UUID } from "./primitives";

/** Room shell is immutable after scan normalization. See CONTRACTS.md §3.1. */
export const FloorPlan = z.object({
  polygonXZ: z.array(z.tuple([z.number(), z.number()])).min(3),
  elevationY: z.number(),
});
export type FloorPlan = z.infer<typeof FloorPlan>;

export const Wall = z.object({
  id: UUID,
  fromXZ: z.tuple([z.number(), z.number()]),
  toXZ: z.tuple([z.number(), z.number()]),
  heightM: z.number().positive(),
  thicknessM: z.number().positive(),
});
export type Wall = z.infer<typeof Wall>;

export const Opening = z.object({
  id: UUID,
  wallId: UUID,
  kind: z.enum(["door", "window"]),
  offsetM: z.number(),
  widthM: z.number().positive(),
  bottomM: z.number().nonnegative(),
  heightM: z.number().positive(),
});
export type Opening = z.infer<typeof Opening>;

export const RoomShell = z.object({
  id: UUID,
  sourceScanId: UUID,
  coordinateVersion: z.literal(1),
  floor: FloorPlan,
  walls: z.array(Wall),
  openings: z.array(Opening),
  ceilingHeightM: z.number().positive().optional(),
});
export type RoomShell = z.infer<typeof RoomShell>;
