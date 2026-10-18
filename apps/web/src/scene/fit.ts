import type { Vec3 } from '@house/contracts';

export type Fit = { scale: Vec3; uniform: boolean; distortion: number };

/**
 * Fit a model of native size `native` [w,h,d] into the object's box `target` [w,h,d].
 * Non-uniform scaling is allowed only while the per-axis ratios stay within ±`maxNonUniform` of
 * each other; beyond that the model is scaled uniformly to fit inside the box (and flagged), since
 * distorted furniture looks worse than slightly wrong size.
 */
export function fitToBox(native: Vec3, target: Vec3, maxNonUniform: number): Fit {
  const r = target.map((t, i) => t / Math.max(native[i]!, 1e-6)) as Vec3;
  const min = Math.min(...r);
  const max = Math.max(...r);
  const distortion = max / min - 1;
  if (distortion <= maxNonUniform + 1e-9) return { scale: r, uniform: false, distortion };
  return { scale: [min, min, min], uniform: true, distortion };
}
