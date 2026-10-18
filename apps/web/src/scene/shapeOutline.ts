import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { Vec3 } from '@house/contracts';
import type { ShapeBox } from '@house/scene-engine';
import { EDITOR_POLICY } from '../config/editorPolicy';
import { compoundExteriorPositions } from './compoundOutline';
import { fitToBox } from './fit';

/**
 * Size of the model as SceneObjectMesh actually draws it inside the object's box: stretched within
 * ±15 %, otherwise scaled uniformly to fit inside. The outline uses the same size so it hugs the
 * visible model rather than the data box.
 */
export function outlineSizeOf(native: Vec3, target: Vec3): Vec3 {
  const fit = fitToBox(native, target, EDITOR_POLICY.maxNonUniformScale);
  return native.map((n, i) => n * fit.scale[i]!) as Vec3;
}

/** Line segments of a baked shape's exterior, in object-local metres (base at y = 0, footprint centred). */
export function shapeOutlineGeometry(boxes: readonly ShapeBox[], [w, h, d]: Vec3): BufferGeometry {
  const g = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(compoundExteriorPositions(boxes).slice(), 3));
  g.scale(w, h, d).translate(-w / 2, 0, -d / 2);
  return g;
}
