import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RoomShell, SceneSpec } from "@house/contracts";
import { normalizeRoomScan, ScanRejectedError } from "./normalize";

/** Column-major transform: yaw about Y, then translate. */
function mat(yaw: number, x: number, y: number, z: number): number[] {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
}
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const surface = (category: string, yaw: number, x: number, y: number, z: number, dims: [number, number, number]) => ({
  id: uuid(), category, confidence: "high" as const, transform: mat(yaw, x, y, z), dimensions: dims,
});

/** A 5 x 4 m room, rotated 30° and placed far from the origin, like a real ARKit session. */
function syntheticScan() {
  const rot = Math.PI / 6;
  const ox = 12.3, oz = -7.1, floorY = -1.4, h = 2.6;
  const R = (lx: number, lz: number): [number, number] => [ox + lx * Math.cos(rot) + lz * Math.sin(rot), oz - lx * Math.sin(rot) + lz * Math.cos(rot)];
  const wallAt = (lx: number, lz: number, along: "x" | "z", len: number) => {
    const [x, z] = R(lx, lz);
    return surface("wall", along === "x" ? rot : rot + Math.PI / 2, x, floorY + h / 2, z, [len, h, 0]);
  };
  const walls = [wallAt(2.5, 0, "x", 5), wallAt(5, 2, "z", 4), wallAt(2.5, 4, "x", 5), wallAt(0, 2, "z", 4)];
  const [dx, dz] = R(1, 0);
  const [wx, wz] = R(0, 2);
  const [sx, sz] = R(2.5, 3);
  return {
    schemaVersion: 1 as const,
    scanId: uuid(),
    capturedAt: "2026-10-17T12:00:00Z",
    walls,
    doors: [surface("door", rot, dx, floorY + 1.05, dz, [0.9, 2.1, 0])],
    windows: [surface("window", rot + Math.PI / 2, wx, floorY + 1.5, wz, [1.5, 1.2, 0])],
    openings: [],
    floors: [],
    objects: [
      { id: uuid(), category: "sofa", confidence: "high" as const, transform: mat(rot, sx, floorY + 0.4, sz), dimensions: [2, 0.8, 0.9] as [number, number, number] },
      { id: uuid(), category: "hologram", confidence: "low" as const, transform: mat(rot, ...R(2, 2).slice(0, 1) as [number], floorY + 0.5, R(2, 2)[1]), dimensions: [0.5, 1, 0.5] as [number, number, number] },
    ],
  };
}

test("normalizes a rotated, offset scan into a valid shell and scene", () => {
  const { shell, scene, warnings } = normalizeRoomScan(syntheticScan());
  RoomShell.parse(shell);
  SceneSpec.parse(scene);
  const xs = shell.floor.polygonXZ.map((p) => p[0]), zs = shell.floor.polygonXZ.map((p) => p[1]);
  assert.equal(Math.min(...xs), 0);
  assert.equal(Math.min(...zs), 0);
  // The room is 5 x 4 m regardless of the scan's rotation, so edge lengths are preserved.
  const edges = shell.walls.map((w) => Math.hypot(w.toXZ[0] - w.fromXZ[0], w.toXZ[1] - w.fromXZ[1])).sort();
  assert.deepEqual(edges.map((e) => Math.round(e * 10) / 10), [4, 4, 5, 5]);
  assert.equal(shell.walls.length, 4);
  assert.equal(shell.ceilingHeightM, 2.6);
  assert.equal(shell.floor.elevationY, 0);
  assert.ok(warnings.some((w) => w.includes("hologram")));
  assert.ok(warnings.some((w) => w.includes("low confidence")));
});

test("attaches openings to the right walls with sensible intervals", () => {
  const { shell } = normalizeRoomScan(syntheticScan());
  assert.equal(shell.openings.length, 2);
  for (const o of shell.openings) {
    const wall = shell.walls.find((w) => w.id === o.wallId)!;
    const len = Math.hypot(wall.toXZ[0] - wall.fromXZ[0], wall.toXZ[1] - wall.fromXZ[1]);
    assert.ok(o.offsetM >= 0 && o.offsetM + o.widthM <= len + 1e-6);
    assert.ok(o.bottomM + o.heightM <= wall.heightM + 1e-6);
  }
  const door = shell.openings.find((o) => o.kind === "door")!;
  assert.ok(Math.abs(door.bottomM) < 0.01);
  const window = shell.openings.find((o) => o.kind === "window")!;
  assert.ok(Math.abs(window.bottomM - 0.9) < 0.01);
});

test("objects keep their scan pose relative to the room, base on the floor", () => {
  const { scene, shell } = normalizeRoomScan(syntheticScan());
  const sofa = scene.objects.find((o) => o.category === "sofa")!;
  assert.ok(Math.abs(sofa.transform.position[1]) < 1e-6);
  // Local scan position (2.5, 3) in a 5x4 room whose min corner maps to origin: sofa is
  // 1 m from the far wall; its distance to the nearest polygon vertex set is orientation-free.
  const poly = shell.floor.polygonXZ;
  assert.ok(poly.length === 4);
  const [x, , z] = sofa.transform.position;
  const centroid = [poly.reduce((a, p) => a + p[0], 0) / 4, poly.reduce((a, p) => a + p[1], 0) / 4];
  assert.ok(Math.abs(Math.hypot(x - centroid[0], z - centroid[1]) - 1) < 0.02);
  assert.equal(sofa.source, "roomplan_approximation");
  assert.equal(sofa.ownership, "existing");
  assert.deepEqual(sofa.dimensionsM, [2, 0.8, 0.9]);
  assert.equal(scene.objects.find((o) => o.category === "unknown")!.assetId, null);
});

test("yaw round-trips through the quaternion", () => {
  const scan = syntheticScan();
  const { scene } = normalizeRoomScan(scan);
  const sofa = scene.objects.find((o) => o.category === "sofa")!;
  const [, y, , w] = sofa.transform.rotation;
  assert.ok(Math.abs(2 * Math.atan2(y, w) - Math.PI / 6) < 1e-3);
});

test("uses an asset resolver when provided", () => {
  const assetId = "11111111-1111-4111-8111-111111111111";
  const { scene } = normalizeRoomScan(syntheticScan(), {
    resolveAsset: (c) => (c === "sofa" ? { assetId, dimensionsM: [1.9, 0.8, 0.9], displayName: "Fixture sofa" } : null),
  });
  const sofa = scene.objects.find((o) => o.category === "sofa")!;
  assert.equal(sofa.assetId, assetId);
  assert.equal(sofa.displayName, "Fixture sofa");
});

test("is stable for reimport: same scan ids yield the same wall and object ids", () => {
  const scan = syntheticScan();
  const a = normalizeRoomScan(scan), b = normalizeRoomScan(scan);
  assert.deepEqual(a.shell.walls.map((w) => w.id), b.shell.walls.map((w) => w.id));
  assert.deepEqual(a.scene.objects.map((o) => o.id), b.scene.objects.map((o) => o.id));
});

test("rejects corrupt, too-few-wall, open and tiny scans", () => {
  assert.throws(() => normalizeRoomScan({ nope: 1 }), ScanRejectedError);
  const two = syntheticScan(); two.walls = two.walls.slice(0, 2);
  assert.throws(() => normalizeRoomScan(two), /fewer than 3/);
  const open = syntheticScan(); open.walls = open.walls.slice(0, 3);
  assert.throws(() => normalizeRoomScan(open), /closed room/);
  const tiny = syntheticScan();
  tiny.walls = tiny.walls.map((w) => ({ ...w, transform: w.transform.map((v, i) => (i >= 12 && i < 15 ? v * 0.1 : v)), dimensions: [0.5, 2.6, 0] as [number, number, number] }));
  assert.throws(() => normalizeRoomScan(tiny), ScanRejectedError);
  const nan = syntheticScan(); (nan.walls[0].transform as number[])[12] = Number.NaN;
  assert.throws(() => normalizeRoomScan(nan), ScanRejectedError);
});

test("falls back to the scanned floor outline when walls do not close", () => {
  const scan = syntheticScan();
  const open = { ...scan, walls: scan.walls.slice(0, 3) };
  const corners = [[0, 0, 0], [5, 0, 0], [5, 0, 4], [0, 0, 4]] as [number, number, number][];
  const withFloor = { ...open, floors: [{ ...surface("floor", 0, 2.5, -1.4, 2, [5, 4, 0]), polygonCorners: corners }] };
  const { shell, warnings } = normalizeRoomScan(withFloor);
  assert.equal(shell.floor.polygonXZ.length, 4);
  assert.ok(warnings.some((w) => w.includes("floor outline")));
});

test("the sample scan fixture imports and every object passes the scene-engine validator", async () => {
  const { readFileSync } = await import("node:fs");
  const { validateOp } = await import("@house/scene-engine");
  const raw = JSON.parse(readFileSync(new URL("../../../apps/ios/Fixtures/sample-scan.json", import.meta.url), "utf8"));
  const { shell, scene, warnings } = normalizeRoomScan(raw);
  assert.deepEqual(warnings, []);
  for (const object of scene.objects) {
    const others = { ...scene, objects: scene.objects.filter((o) => o.id !== object.id) };
    const result = validateOp(others, shell, { type: "add", object });
    assert.ok(result.valid, `${object.category}: ${result.valid ? "" : result.errors.join("; ")}`);
  }
});
