/**
 * Category compatibility: requested category -> { catalog category: affinity }.
 * Affinity 1 = exact; <1 = acceptable substitute; absent = hard reject (a bed
 * must never satisfy a sofa request). Includes RoomPlan's coarse classes so
 * scanned objects can be requested directly.
 */
const GROUPS: Record<string, Record<string, number>> = {
  sofa: { sofa: 1, loveseat: 0.9, sectional: 0.9 },
  armchair: { armchair: 1, chair: 0.85, accent_chair: 1 },
  chair: { chair: 1, armchair: 0.85, dining_chair: 0.95, accent_chair: 0.9 },
  dining_chair: { dining_chair: 1, chair: 0.95, armchair: 0.7 },
  table: { table: 1, dining_table: 0.95, coffee_table: 0.6, side_table: 0.6, desk: 0.6 },
  coffee_table: { coffee_table: 1, table: 0.7, side_table: 0.6 },
  dining_table: { dining_table: 1, table: 0.95 },
  side_table: { side_table: 1, coffee_table: 0.6, table: 0.6, nightstand: 0.7 },
  desk: { desk: 1, table: 0.6 },
  bed: { bed: 1 },
  sink: { sink: 1, vanity: 0.85 },
  vanity: { vanity: 1, sink: 0.85 },
  refrigerator: { refrigerator: 1 },
  stove: { stove: 1, oven: 0.8 },
  oven: { oven: 1, stove: 0.8 },
  toilet: { toilet: 1 },
  bathtub: { bathtub: 1 },
  wardrobe: { wardrobe: 1, cabinet: 0.7 },
  tv_stand: { tv_stand: 1, sideboard: 0.8, credenza: 0.8 },
  stool: { stool: 1, chair: 0.5 },
  ottoman: { ottoman: 1, stool: 0.6 },
  bench: { bench: 1 },
  kitchen_island: { kitchen_island: 1, cabinet: 0.6 },
  storage: { storage: 1, bookshelf: 0.7, credenza: 0.75, sideboard: 0.75, cabinet: 0.85, dresser: 0.7, wardrobe: 0.6, tv_stand: 0.65 },
  bookshelf: { bookshelf: 1, shelf: 0.95, storage: 0.6, cabinet: 0.5 },
  credenza: { credenza: 1, sideboard: 1, cabinet: 0.85, dresser: 0.7, storage: 0.65 },
  cabinet: { cabinet: 1, credenza: 0.85, storage: 0.8 },
  dresser: { dresser: 1, credenza: 0.7, cabinet: 0.7 },
  television: { television: 1, tv: 1 },
  plant: { plant: 1 },
  floor_lamp: { floor_lamp: 1 },
  rug: { rug: 1 },
};

const norm = (c: string) => c.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Affinity of `assetCategory` for a `requested` category; 0 = incompatible. */
export function categoryAffinity(requested: string, assetCategory: string): number {
  const r = norm(requested), a = norm(assetCategory);
  if (r === a) return 1;
  return GROUPS[r]?.[a] ?? 0;
}
