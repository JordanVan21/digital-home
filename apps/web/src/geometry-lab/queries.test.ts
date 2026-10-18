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
  it("closes seams up to the gap size without growing the outside", () => {
    // A closed body whose top has a 5 cm seam, like a scanned couch shell.
    const shell = new Group();
    shell.add(
      part(1, 0.6, 0.02, 0, 0.3, -0.49),
      part(1, 0.6, 0.02, 0, 0.3, 0.49),
      part(0.02, 0.6, 0.96, -0.49, 0.3, 0),
      part(0.02, 0.6, 0.96, 0.49, 0.3, 0),
      part(0.475, 0.02, 1, -0.2625, 0.61, 0),
      part(0.475, 0.02, 1, 0.2625, 0.61, 0),
    );
    const probe = new Sphere(new Vector3(0.2, 0.3, 0.2), 0.02);
    const leaky = buildProfile(bakeGeometry(shell), 0.02, { closeBase: true });
    const closed = buildProfile(bakeGeometry(shell), 0.02, {
      closeBase: true,
      closeGapsM: 0.05,
    });
    expect(probeContacts(leaky, probe).compound).toBe(false);
    expect(probeContacts(closed, probe).compound).toBe(true);
    // The outside stays on the 2 cm grid: 2.5 cm beyond a wall is clear.
    expect(
      probeContacts(closed, new Sphere(new Vector3(0.525, 0.3, 0), 0.004))
        .compound,
    ).toBe(false);
    // A wide opening is not a seam: an open-topped box stays open.
    const box = new Group();
    box.add(
      ...shell.children.slice(0, 4).map((c) => c.clone()),
      part(1, 0.02, 1, 0, 0.01, 0),
    );
    const openTop = buildProfile(bakeGeometry(box), 0.02, {
      closeBase: true,
      closeGapsM: 0.05,
    });
    expect(probeContacts(openTop, probe).compound).toBe(false);
    for (const p of [leaky, closed, openTop]) p.geometry.dispose();
  });
  it("puts exposed tops at the real surface height, not the grid line", () => {
    // Two uprights pass through each board's grid layer; boards end off-grid.
    const shelf = new Group();
    shelf.add(part(0.04, 1.2, 0.3, -0.48, 0.6, 0));
    shelf.add(part(0.04, 1.2, 0.3, 0.48, 0.6, 0));
    for (const top of [0.47, 0.89])
      shelf.add(part(1, 0.03, 0.3, 0, top - 0.015, 0));
    const profile = buildProfile(bakeGeometry(shelf), 0.02, {
      closeBase: true,
    });
    for (const top of [0.47, 0.89]) {
      const board = profile.boxes.filter(
        (b) =>
          b.min.x < 0 && b.max.x > 0 && b.max.y > top - 0.03 && b.min.y < top,
      );
      expect(Math.max(...board.map((b) => b.max.y))).toBeCloseTo(top, 4);
    }
    // A ray onto the board lands on the real board, not 1 cm above it.
    expect(rayContacts(profile, 0, 0, 0.8).compound).toBeCloseTo(0.47, 4);
    profile.geometry.dispose();
  });
  it("trims exposed tops without opening gaps inside a solid", () => {
    // A wide base with a narrow block on top: shoulders exposed at 0.5, block to 0.9.
    const stepped = new Group();
    stepped.add(part(1, 0.5, 1, 0, 0.25, 0), part(0.4, 0.4, 0.4, 0, 0.7, 0));
    const profile = buildProfile(bakeGeometry(stepped), 0.03, {
      closeBase: true,
    });
    const inside = (x: number, y: number, z: number) =>
      profile.boxes.some((b) => b.containsPoint(new Vector3(x, y, z)));
    for (let y = 0.005; y < 0.9; y += 0.0099) {
      expect(inside(0, y, 0), `centre column at ${y.toFixed(3)}`).toBe(true);
      if (y < 0.5)
        expect(inside(0.4, y, 0.4), `base at ${y.toFixed(3)}`).toBe(true);
    }
    expect(inside(0.4, 0.505, 0.4)).toBe(false);
    expect(rayContacts(profile, 0.4, 0.4, 1.2).compound).toBeCloseTo(0.5, 4);
    expect(rayContacts(profile, 0, 0, 1.2).compound).toBeCloseTo(0.9, 4);
    profile.geometry.dispose();
  });
  it("rejects an unbounded voxel resolution", () => {
    const geometry = new BoxGeometry(2, 2, 2);
    expect(() => buildProfile(geometry, 0.00001)).toThrow();
    geometry.dispose();
  });
});
