import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, Sphere, Vector3 } from "three";
import {
  bakeGeometry,
  buildProfile,
  probeContacts,
  rayContacts,
} from "./queries";
const part = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
) => {
  const mesh = new Mesh(new BoxGeometry(w, h, d));
  mesh.position.set(x, y, z);
  return mesh;
};
describe("isolated shape-query experiment", () => {
  it.each([false, true])(
    "preserves empty space below a table and detects its legs (base closure=%s)",
    (closeBase) => {
      const group = new Group();
      group.add(part(2, 0.2, 1, 0, 1, 0));
      for (const x of [-0.8, 0.8])
        for (const z of [-0.3, 0.3])
          group.add(part(0.12, 0.9, 0.12, x, 0.45, z));
      const profile = buildProfile(bakeGeometry(group), 0.06, { closeBase });
      expect(
        probeContacts(profile, new Sphere(new Vector3(0, 0.4, 0), 0.025)),
      ).toEqual({ box: true, compound: false, surface: false });
      const leg = probeContacts(
        profile,
        new Sphere(new Vector3(0.8, 0.4, 0.3), 0.08),
      );
      expect(leg.compound).toBe(true);
      expect(leg.surface).toBe(true);
      profile.geometry.dispose();
    },
  );
  it("finds a chair seat below the enclosing box's backrest height", () => {
    const chair = new Group();
    chair.add(part(1, 0.1, 1, 0, 0.5, 0), part(1, 0.9, 0.1, 0, 1, -0.45));
    const profile = buildProfile(bakeGeometry(chair), 0.05);
    const hits = rayContacts(profile, 0, 0.2, 2);
    expect(hits.box).toBeCloseTo(1.45);
    expect(hits.surface).toBeCloseTo(0.55);
    expect(Math.abs(hits.compound! - 0.55)).toBeLessThanOrEqual(0.1);
    profile.geometry.dispose();
  });
  it("distinguishes triangle contact from solid containment instead of presenting it as full volume validation", () => {
    const profile = buildProfile(new BoxGeometry(1, 1, 1), 0.1);
    const result = probeContacts(profile, new Sphere(new Vector3(), 0.02));
    expect(result).toEqual({ box: true, compound: true, surface: false });
    profile.geometry.dispose();
  });
  it("fills a skirt-enclosed body through its supporting plane without filling an open-topped container", () => {
    const walls = new Group();
    walls.add(
      part(1, 0.6, 0.08, 0, 0.3, -0.46),
      part(1, 0.6, 0.08, 0, 0.3, 0.46),
      part(0.08, 0.6, 0.84, -0.46, 0.3, 0),
      part(0.08, 0.6, 0.84, 0.46, 0.3, 0),
    );
    const body = walls.clone();
    body.add(part(1, 0.08, 1, 0, 0.56, 0));
    const probe = new Sphere(new Vector3(0, 0.25, 0), 0.02);
    const openBase = buildProfile(bakeGeometry(body), 0.04);
    const grounded = buildProfile(bakeGeometry(body), 0.04, {
      closeBase: true,
    });
    expect(probeContacts(openBase, probe).compound).toBe(false);
    expect(probeContacts(grounded, probe).compound).toBe(true);
    const container = walls.clone();
    container.add(part(1, 0.08, 1, 0, 0.04, 0));
    const openTop = buildProfile(bakeGeometry(container), 0.04, {
      closeBase: true,
    });
    expect(probeContacts(openTop, probe).compound).toBe(false);
    for (const p of [openBase, grounded, openTop]) p.geometry.dispose();
  });
  it("rejects an unbounded voxel resolution", () => {
    const geometry = new BoxGeometry(2, 2, 2);
    expect(() => buildProfile(geometry, 0.00001)).toThrow();
    geometry.dispose();
  });
});
