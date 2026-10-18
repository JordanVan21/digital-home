/**
 * Imports the room fixtures from Jordan's sandbox branch (test2, demo room and
 * the demo RoomPlan scan) into packages/contracts/src/rooms/.
 *
 * Reads straight from git (default ref origin/feature/3d-sandblox-jordan).
 * Object categories are mapped onto this catalog's vocabulary, lighting
 * preset names onto this app's presets, walls are centred on the floor edge
 * as this engine expects, and wall items name their wall. Everything else is
 * kept as authored.
 * The scan stays raw: the app reproduces it with the scene engine's matcher.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { codexCategory } from "./jordan-categories.mjs";

const root = path.resolve(import.meta.dirname, "..");
const ref = process.argv[2] ?? "origin/feature/3d-sandblox-jordan";
const show = (file) =>
  JSON.parse(
    execFileSync(
      "git",
      ["show", `${ref}:packages/contracts/fixtures/${file}`],
      {
        cwd: root,
        maxBuffer: 16 * 1024 * 1024,
      },
    ).toString(),
  );
const out = path.join(root, "packages/contracts/src/rooms");
await fs.mkdir(out, { recursive: true });

// Jordan's walls stand outside the floor polygon (inner face on the floor edge);
// this engine centres each wall on its floor edge. Move every wall outward by
// half its thickness, re-join the corners, and keep openings where they were.
const inside = ([x, z], poly) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i],
      [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      hit = !hit;
  }
  return hit;
};
const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
function centreWalls(shell) {
  const lines = shell.walls.map((w) => {
    const [ax, az] = w.fromXZ,
      [bx, bz] = w.toXZ;
    const len = Math.hypot(bx - ax, bz - az),
      u = [(bx - ax) / len, (bz - az) / len];
    let n = [u[1], -u[0]];
    const mid = [(ax + bx) / 2, (az + bz) / 2];
    if (
      inside(
        [mid[0] + n[0] * 0.02, mid[1] + n[1] * 0.02],
        shell.floor.polygonXZ,
      )
    )
      n = [-n[0], -n[1]];
    const h = w.thicknessM / 2;
    return {
      w,
      u,
      from: [ax + n[0] * h, az + n[1] * h],
      to: [bx + n[0] * h, bz + n[1] * h],
    };
  });
  // Intersection of two offset lines (each given by a point and direction).
  const meet = (a, b) => {
    const d = a.u[0] * b.u[1] - a.u[1] * b.u[0];
    if (Math.abs(d) < 1e-9) return null;
    const t =
      ((b.from[0] - a.from[0]) * b.u[1] - (b.from[1] - a.from[1]) * b.u[0]) / d;
    return [a.from[0] + a.u[0] * t, a.from[1] + a.u[1] * t];
  };
  const walls = lines.map((l) => {
    const prev = lines.find((o) => o !== l && same(o.w.toXZ, l.w.fromXZ));
    const next = lines.find((o) => o !== l && same(o.w.fromXZ, l.w.toXZ));
    const from = (prev && meet(prev, l)) ?? l.from;
    const to = (next && meet(l, next)) ?? l.to;
    const round = (p) => p.map((v) => Number(v.toFixed(6)));
    return { ...l.w, fromXZ: round(from), toXZ: round(to) };
  });
  const shift = Object.fromEntries(
    lines.map((l, i) => {
      const from = walls[i].fromXZ;
      return [
        l.w.id,
        (l.w.fromXZ[0] - from[0]) * l.u[0] + (l.w.fromXZ[1] - from[1]) * l.u[1],
      ];
    }),
  );
  const openings = shell.openings.map((o) => ({
    ...o,
    offsetM: Number((o.offsetM + shift[o.wallId]).toFixed(6)),
  }));
  return { ...shell, walls, openings };
}
// Wall items name the wall they hang on: the wall whose inner face is nearest.
function hangOnWalls(objects, shell) {
  const distance = (o, w) => {
    const [ax, az] = w.fromXZ,
      [bx, bz] = w.toXZ;
    const [x, , z] = o.transform.position;
    const len = Math.hypot(bx - ax, bz - az);
    return (
      Math.abs(((bx - ax) * (az - z) - (ax - x) * (bz - az)) / len) -
      w.thicknessM / 2
    );
  };
  return objects.map((o) =>
    o.placement?.support !== "wall" || o.placement.parentId
      ? o
      : {
          ...o,
          placement: {
            ...o.placement,
            parentId: [...shell.walls].sort(
              (a, b) => distance(o, a) - distance(o, b),
            )[0].id,
          },
        },
  );
}

const presets = { day: "daylight", golden: "golden-hour", evening: "evening" };
const room = (authored) => {
  const fixture = { ...authored, shell: centreWalls(authored.shell) };
  return {
    ...fixture,
    scene: {
      ...fixture.scene,
      lightingPreset:
        presets[fixture.scene.lightingPreset] ?? fixture.scene.lightingPreset,
      objects: hangOnWalls(fixture.scene.objects, fixture.shell).map((o) => ({
        ...o,
        category: codexCategory(o.category),
      })),
    },
  };
};
for (const file of ["test2-room.json", "demo-room.json"])
  await fs.writeFile(
    path.join(out, file),
    JSON.stringify(room(show(file)), null, 2) + "\n",
  );
await fs.writeFile(
  path.join(out, "demo-scan.json"),
  JSON.stringify(
    {
      ...show("demo-scan.json"),
      shell: centreWalls(show("demo-scan.json").shell),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Imported test2, demo room and demo scan from ${ref}.`);
