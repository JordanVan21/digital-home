import type { Vec2 } from '@house/contracts';
import { EPS, cross2, dot2, len2, sub2 } from './math';

/**
 * Raw shoelace sum Σ(xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ) over (x, z) pairs.
 * Viewed from +Y looking down (screen-up = −Z), a NEGATIVE value means counter-clockwise.
 */
export function shoelaceXZ(poly: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s;
}

export function areaXZ(poly: readonly Vec2[]): number {
  return Math.abs(shoelaceXZ(poly)) / 2;
}

/** Counter-clockwise as viewed from +Y looking down. */
export function isCCWFromAbove(poly: readonly Vec2[]): boolean {
  return shoelaceXZ(poly) < 0;
}

/** Returns a copy wound counter-clockwise as viewed from +Y. */
export function normalizeWinding(poly: readonly Vec2[]): Vec2[] {
  const copy = poly.map((p) => [p[0], p[1]] as Vec2);
  return isCCWFromAbove(copy) ? copy : copy.reverse();
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub2(b, a);
  const l2 = dot2(ab, ab);
  const t = l2 < EPS ? 0 : Math.max(0, Math.min(1, dot2(sub2(p, a), ab) / l2));
  return len2(sub2(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
}

export function distanceToBoundary(p: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  }
  return d;
}

/** Strict even-odd point-in-polygon (boundary points are unspecified; use `tol` variant). */
export function pointInPolygonStrict(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1])) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** Inside or within `tol` of the boundary. */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[], tol = 1e-6): boolean {
  return pointInPolygonStrict(p, poly) || distanceToBoundary(p, poly) <= tol;
}

/** Proper crossing of two segments (touching at endpoints / collinear overlap is NOT a crossing). */
export function segmentsCrossProperly(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tol = 1e-9): boolean {
  const d1 = cross2(sub2(b, a), sub2(c, a));
  const d2 = cross2(sub2(b, a), sub2(d, a));
  const d3 = cross2(sub2(d, c), sub2(a, c));
  const d4 = cross2(sub2(d, c), sub2(b, c));
  return ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol))
    && ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol));
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  if (segmentsCrossProperly(a, b, c, d, 0)) return true;
  const tol = 1e-12;
  return pointSegmentDistance(a, c, d) <= tol || pointSegmentDistance(b, c, d) <= tol
    || pointSegmentDistance(c, a, b) <= tol || pointSegmentDistance(d, a, b) <= tol;
}

export function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  );
}

/** Distance between a closed polygon (as outline) and a segment; 0 if they touch or the segment is inside. */
export function polygonSegmentDistance(poly: readonly Vec2[], a: Vec2, b: Vec2): number {
  if (pointInPolygonStrict(a, poly) || pointInPolygonStrict(b, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, segmentSegmentDistance(poly[i]!, poly[(i + 1) % poly.length]!, a, b));
  }
  return d;
}

/**
 * True when polygon `inner` lies fully inside `outer` (works for concave `outer`).
 * Points on the boundary within `tol` count as inside, so a footprint touching a wall is contained.
 */
export function polygonInsidePolygon(inner: readonly Vec2[], outer: readonly Vec2[], tol = 1e-6): boolean {
  for (const p of inner) if (!pointInPolygon(p, outer, tol)) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]!;
    const b = inner[(i + 1) % inner.length]!;
    for (let j = 0; j < outer.length; j++) {
      if (segmentsCrossProperly(a, b, outer[j]!, outer[(j + 1) % outer.length]!, tol)) return false;
    }
  }
  // A reflex vertex of `outer` poking into `inner` without proper crossings (e.g. through corners).
  for (const v of outer) {
    if (pointInPolygonStrict(v, inner) && distanceToBoundary(v, inner) > tol) return false;
  }
  return true;
}

export function polygonCentroid(poly: readonly Vec2[]): Vec2 {
  const s = shoelaceXZ(poly);
  if (Math.abs(s) < EPS) {
    const n = poly.length;
    return [poly.reduce((a, p) => a + p[0], 0) / n, poly.reduce((a, p) => a + p[1], 0) / n];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const f = a[0] * b[1] - b[0] * a[1];
    cx += (a[0] + b[0]) * f;
    cz += (a[1] + b[1]) * f;
  }
  return [cx / (3 * s), cz / (3 * s)];
}

export function polygonBounds(poly: readonly Vec2[]): { min: Vec2; max: Vec2 } {
  const min: Vec2 = [Infinity, Infinity];
  const max: Vec2 = [-Infinity, -Infinity];
  for (const p of poly) {
    min[0] = Math.min(min[0], p[0]); min[1] = Math.min(min[1], p[1]);
    max[0] = Math.max(max[0], p[0]); max[1] = Math.max(max[1], p[1]);
  }
  return { min, max };
}
