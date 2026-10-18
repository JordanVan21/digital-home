import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { makeGhost } from '../src/scene/prepareModel';

/**
 * Instances share geometry and materials (Drei <Clone>); highlighting is a separate overlay and
 * ghosting clones materials for that instance only. This guards the "tint one sofa, tint all
 * sofas" bug.
 */
describe('per-instance highlighting', () => {
  const source = new Group();
  const shared = new MeshStandardMaterial({ color: '#ffffff' });
  source.add(new Mesh(new BoxGeometry(1, 1, 1), shared));

  it('plain instances share the source material', () => {
    const a = skeletonClone(source).children[0] as Mesh;
    const b = skeletonClone(source).children[0] as Mesh;
    expect(a.material).toBe(shared);
    expect(b.material).toBe(shared);
  });

  it('ghosting one instance never changes the shared material or other instances', () => {
    const other = skeletonClone(source).children[0] as Mesh;
    const ghost = makeGhost(source);
    const gm = (ghost.object.children[0] as Mesh).material as MeshStandardMaterial;
    expect(gm).not.toBe(shared);
    expect(gm.transparent).toBe(true);
    expect(gm.opacity).toBeLessThan(1);
    expect(shared.transparent).toBe(false);
    expect(shared.opacity).toBe(1);
    expect(other.material).toBe(shared);
    // Geometry stays shared (no memory blow-up).
    expect((ghost.object.children[0] as Mesh).geometry).toBe((source.children[0] as Mesh).geometry);
  });
});
