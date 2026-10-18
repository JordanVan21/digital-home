import { Box3, Group, Mesh, Object3D, SRGBColorSpace, Vector3, type Color, type Material, type Texture } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AssetSpec, Vec3 } from '@house/contracts';
import { EDITOR_POLICY } from '../config/editorPolicy';

export type PreparedModel = {
  /** Normalized wrapper: footprint centered at origin, base at y = 0, front facing +Z. */
  root: Object3D;
  /** Native size [w, h, d] after normalization (meters). */
  size: Vec3;
  triangles: number;
};

const cache = new WeakMap<Object3D, PreparedModel>();
const FRONT_YAW: Record<string, number> = { '+Z': 0, '+X': -Math.PI / 2, '-X': Math.PI / 2, '-Z': Math.PI };

/**
 * Normalize a loaded GLB scene once per URL (cached on the GLTF scene object). Instances then
 * `<Clone>` the wrapper, sharing geometry and materials. Materials/textures are left as authored,
 * except texture color spaces, which are set defensively.
 */
export function prepareModel(scene: Object3D, asset: AssetSpec, url: string): PreparedModel {
  const hit = cache.get(scene);
  if (hit) return hit;
  let triangles = 0;
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const geo = m.geometry;
    triangles += (geo.index ? geo.index.count : geo.attributes.position?.count ?? 0) / 3;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as (Material & Record<string, unknown>)[];
    for (const mat of mats) {
      for (const key of ['map', 'emissiveMap']) {
        const tex = mat[key] as Texture | undefined;
        if (tex && tex.colorSpace !== SRGBColorSpace) { tex.colorSpace = SRGBColorSpace; tex.needsUpdate = true; }
      }
    }
  });
  const pivot = new Group();
  pivot.name = 'front-pivot';
  pivot.add(scene);
  pivot.rotation.y = FRONT_YAW[asset.frontAxis ?? '+Z'] ?? 0;
  const root = new Group();
  root.name = `asset:${asset.id}`;
  root.add(pivot);
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(pivot);
  const c = box.getCenter(new Vector3());
  pivot.position.set(-c.x, -box.min.y, -c.z);
  const s = box.getSize(new Vector3());
  const prepared: PreparedModel = { root, size: [s.x, s.y, s.z], triangles: Math.round(triangles) };
  cache.set(scene, prepared);
  if (import.meta.env?.DEV) checkBudget(asset, url, prepared);
  return prepared;
}

function checkBudget(asset: AssetSpec, url: string, p: PreparedModel) {
  const { maxBytes, maxTriangles } = EDITOR_POLICY.assetBudget;
  const entry = performance.getEntriesByName(new URL(url, location.href).href)[0] as PerformanceResourceTiming | undefined;
  const bytes = entry?.encodedBodySize || entry?.transferSize || 0;
  if (p.triangles > maxTriangles) console.warn(`[asset budget] ${asset.title} has ${p.triangles} triangles (> ${maxTriangles}).`);
  if (bytes > maxBytes) console.warn(`[asset budget] ${asset.title} is ${(bytes / 1048576).toFixed(1)} MB (> ${maxBytes / 1048576} MB).`);
  const [w, h, d] = asset.dimensionsM;
  const off = [w / p.size[0], h / p.size[1], d / p.size[2]].some((r) => Math.abs(r - 1) > 0.05);
  if (off) console.warn(`[asset] ${asset.title}: catalog dimensions [${asset.dimensionsM.join(', ')}] differ from model bounds [${p.size.map((v) => v.toFixed(3)).join(', ')}].`);
}

/**
 * Per-instance ghost copy for the "Remove" planning flag: clones the hierarchy (sharing geometry)
 * and gives only this copy its own transparent materials, so other instances are untouched.
 */
export function makeGhost(source: Object3D, opacity = 0.28): { object: Object3D; materials: Material[] } {
  const object = skeletonClone(source);
  const materials: Material[] = [];
  object.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const clone = (mat: Material) => {
      const cm = mat.clone();
      cm.transparent = true;
      cm.opacity = opacity;
      cm.depthWrite = false;
      materials.push(cm);
      return cm;
    };
    m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
    m.castShadow = false;
  });
  return { object, materials };
}

/**
 * Per-instance material variant (colour/roughness overrides, lamp off). Clones only this instance's
 * materials; geometry stays shared.
 */
export function makeVariant(
  source: Object3D,
  overrides: Record<string, { colorHex?: string; roughness?: number }> | undefined,
  dimEmissive: readonly string[] = [],
): { object: Object3D; materials: Material[] } {
  const object = skeletonClone(source);
  const materials: Material[] = [];
  const dim = new Set(dimEmissive);
  object.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const clone = (mat: Material) => {
      const ov = overrides?.[mat.name] ?? overrides?.['*'];
      if (!ov && !dim.has(mat.name)) return mat;
      const cm = mat.clone() as Material & { color?: Color; roughness?: number; emissiveIntensity?: number };
      if (ov?.colorHex && cm.color) cm.color.set(ov.colorHex);
      if (ov?.roughness !== undefined && cm.roughness !== undefined) cm.roughness = ov.roughness;
      if (dim.has(mat.name) && cm.emissiveIntensity !== undefined) cm.emissiveIntensity = 0;
      materials.push(cm);
      return cm;
    };
    m.material = Array.isArray(m.material) ? m.material.map(clone) : clone(m.material);
  });
  return { object, materials };
}
