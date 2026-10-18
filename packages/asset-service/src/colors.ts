import type { GlbInspection } from "./glb";

/**
 * Deterministic check that a requested color actually made it into a model.
 * Names are matched to HSV ranges (sRGB); unknown names are ignored rather than
 * guessed at. A material satisfies a color only if its base color is a flat
 * factor that matches: a texture-driven material cannot be confirmed.
 */
type Range = { hue?: [number, number]; sat?: [number, number]; val?: [number, number] };
const BROWN: Range = { hue: [8, 48], sat: [0.2, 1], val: [0.1, 0.9] };
const NEUTRAL_GRAY: Range = { sat: [0, 0.18], val: [0.15, 0.85] };
const COLOR_RANGES: Record<string, Range> = {
  red: { hue: [345, 15], sat: [0.35, 1], val: [0.2, 1] }, crimson: { hue: [345, 15], sat: [0.35, 1], val: [0.2, 1] }, burgundy: { hue: [335, 15], sat: [0.35, 1], val: [0.1, 0.6] },
  orange: { hue: [15, 45], sat: [0.45, 1], val: [0.4, 1] },
  yellow: { hue: [45, 70], sat: [0.35, 1], val: [0.5, 1] },
  green: { hue: [70, 170], sat: [0.25, 1], val: [0.15, 1] },
  teal: { hue: [160, 200], sat: [0.3, 1], val: [0.2, 1] },
  blue: { hue: [200, 255], sat: [0.3, 1], val: [0.2, 1] }, navy: { hue: [200, 255], sat: [0.4, 1], val: [0.1, 0.5] },
  purple: { hue: [255, 300], sat: [0.25, 1], val: [0.15, 1] },
  pink: { hue: [300, 350], sat: [0.15, 1], val: [0.6, 1] },
  brown: BROWN, walnut: BROWN, oak: BROWN, tan: BROWN, wood: BROWN, wooden: BROWN, mahogany: BROWN, chestnut: BROWN, chocolate: BROWN, espresso: BROWN,
  black: { val: [0, 0.2] }, white: { sat: [0, 0.15], val: [0.82, 1] },
  gray: NEUTRAL_GRAY, grey: NEUTRAL_GRAY, charcoal: { sat: [0, 0.2], val: [0.08, 0.4] }, silver: { sat: [0, 0.15], val: [0.55, 0.9] },
  beige: { hue: [25, 65], sat: [0.05, 0.4], val: [0.6, 1] }, cream: { hue: [25, 65], sat: [0.03, 0.35], val: [0.75, 1] }, ivory: { hue: [25, 65], sat: [0.02, 0.25], val: [0.8, 1] },
};

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hsv([r, g, b]: [number, number, number]): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}
const inRange = (x: number, [lo, hi]: [number, number]) => (lo <= hi ? x >= lo && x <= hi : x >= lo || x <= hi); // hue wraps

/** True/false for a known color name, null for one we do not recognize. */
export function colorMatches(name: string, linearRgb: [number, number, number]): boolean | null {
  const range = COLOR_RANGES[name.trim().toLowerCase()];
  if (!range) return null;
  const { h, s, v } = hsv(linearRgb.map(toSrgb) as [number, number, number]);
  return (!range.hue || inRange(h, range.hue)) && (!range.sat || inRange(s, range.sat)) && (!range.val || inRange(v, range.val));
}

/** One problem string per requested (known) color that no flat-colored material satisfies. */
export function checkRequestedColors(materials: GlbInspection["materials"], colors: string[]): string[] {
  const problems: string[] = [];
  for (const color of colors) {
    if (!COLOR_RANGES[color.trim().toLowerCase()]) continue; // unknown color name: not checked
    const satisfied = materials.some((m) => !m.textured && m.baseColor && colorMatches(color, [m.baseColor[0], m.baseColor[1], m.baseColor[2]]) === true);
    if (satisfied) continue;
    const textured = materials.filter((m) => m.textured).map((m) => m.name);
    problems.push(
      `Requested color "${color}" is not in the model: no material has a matching flat base color` +
      (textured.length ? ` (${textured.join(", ")} use a texture; unlink the Base Color texture and set the color)` : "") + ". Set the Base Color on the materials, then check with measure_model."
    );
  }
  return problems;
}
