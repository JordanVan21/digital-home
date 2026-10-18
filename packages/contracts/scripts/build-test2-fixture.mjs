// Builds packages/contracts/fixtures/test2-room.json from agent_docs/TEST2_SCENE_SPEC.md.
// Stacked items get their heights from the real catalog sizes, so the fixture stays consistent
// if a model is re-ingested. Run: node packages/contracts/scripts/build-test2-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const catalog = JSON.parse(readFileSync(join(root, 'apps/web/public/catalog/catalog.json'), 'utf8'));
const assetBySlug = Object.fromEntries(catalog.assets.map((a) => [a.glbStorageKey.replace(/^models\/|\.glb$/g, ''), a]));
const A = (slug) => {
  const a = assetBySlug[slug];
  if (!a) throw new Error(`missing asset ${slug}`);
  return a;
};

const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHELL = uuid('7e520000', 1);
const ROOM = uuid('7e520000', 2);
const SCENE = uuid('7e520000', 3);
const W = { west: uuid('7e5a1100', 1), south: uuid('7e5a1100', 2), east: uuid('7e5a1100', 3), north: uuid('7e5a1100', 4) };
const round = (v) => Math.round(v * 10000) / 10000;
const rot = (deg) => {
  const h = (deg * Math.PI) / 360;
  return [0, Math.sin(h), 0, Math.cos(h)];
};

let seq = 0;
const objects = [];
const byKey = {};
/** dims default to the asset's native size; `scale` scales it uniformly. */
function place(key, slug, { x, z, y = 0, yaw = 0, parent, support, dims, scale, tilt, name, overrides, float }) {
  const a = A(slug);
  const d = dims ?? (scale ? a.dimensionsM.map((v) => round(v * scale)) : a.dimensionsM);
  const o = {
    id: uuid('7e5ob1ec'.replace('o', '0'), ++seq),
    assetId: a.id,
    category: a.category,
    transform: { position: [round(x), round(y), round(z)], rotation: rot(yaw), scale: [1, 1, 1] },
    dimensionsM: d,
    locked: false,
    source: 'user',
    displayName: name ?? a.title,
    placement: {
      support: support ?? (parent ? 'object' : 'floor'),
      ...(parent ? { parentId: byKey[parent].id } : {}),
      ...(float ? { float: true } : {}),
    },
    ...(tilt ? { tilt } : {}),
    ...(overrides ? { materialOverrides: overrides } : {}),
  };
  objects.push(o);
  byKey[key] = o;
  return o;
}
/** Effective height (after a flat tilt about X the thickness becomes the height). */
const eh = (key) => {
  const o = byKey[key];
  return o.tilt && o.tilt.x % 2 === 1 ? o.dimensionsM[2] : o.dimensionsM[1];
};
const top = (key) => byKey[key].transform.position[1] + eh(key);
const cover = (hex) => ({ cover: { colorHex: hex } });
const linen = (hex) => ({ linen: { colorHex: hex } });
const FLAT = { x: 1, z: 0 };

// ---------------------------------------------------------------- floor layer
place('rug', 'rug-jute-large', { x: -0.3, z: 0.55, name: 'Jute rug' });
place('sofa', 'sofa-modern-cream', { x: -0.25, z: -0.4, name: 'Cream sofa' });
// Seat cushion top from the sofa's baked shape (0.48 m); the backrest's front face is 4 cm behind the
// sofa's centre line and the arms start 0.96 m from it. Pillows lean on the backrest, clear of the arms.
const seatY = 0.48;
place('pillow-rust', 'pillow-square', { x: -0.95, z: -0.36, y: seatY, parent: 'sofa', name: 'Rust pillow' });
place('pillow-beige-1', 'pillow-square', { x: 0.02, z: -0.31, y: seatY, yaw: -12, parent: 'sofa', name: 'Sand pillow', overrides: linen('#d8c4a6') });
place('pillow-beige-2', 'pillow-square', { x: 0.45, z: -0.31, y: seatY, yaw: 10, parent: 'sofa', name: 'Oat pillow', overrides: linen('#e2d3bc') });
place('throw', 'throw-knit', { x: 0.2, z: 0.01, y: seatY, parent: 'sofa', name: 'Knit throw' }); // in front of the pillows, draped over the seat edge

place('coffee', 'coffee-table-travertine', { x: -0.85, z: 0.8, name: 'Travertine coffee table' });
place('ct-plant', 'plant-small-succulent', { x: -1.0, z: 0.72, y: top('coffee'), parent: 'coffee', name: 'Small plant' });
place('ct-book-1', 'book-hardcover', { x: -0.64, z: 0.9, y: top('coffee'), yaw: 20, tilt: FLAT, dims: [0.18, 0.26, 0.03], parent: 'coffee', name: 'Coffee-table book', overrides: cover('#cdb89a') });
place('ct-book-2', 'book-hardcover', { x: -0.64, z: 0.9, y: top('ct-book-1'), yaw: 28, tilt: FLAT, dims: [0.15, 0.22, 0.025], parent: 'ct-book-1', name: 'Small book', overrides: cover('#8c7a6b') });
place('ct-bowl', 'bowl-stoneware', { x: -0.64, z: 0.9, y: top('ct-book-2'), yaw: 28, parent: 'ct-book-2', name: 'Stoneware dish' });

place('armchair', 'armchair-barrel-boucle', { x: 0.55, z: 1.65, yaw: -125, name: 'Bouclé barrel chair' });

// Arc lamp: base behind the sofa's left end, arcing over the arm (base at local z −0.37).
{
  const base = [-1.43, -1.2];
  const yaw = 33.4;
  const u = [Math.sin((yaw * Math.PI) / 180), Math.cos((yaw * Math.PI) / 180)];
  place('arc-lamp', 'floor-lamp-arc', { x: base[0] + u[0] * 0.37, z: base[1] + u[1] * 0.37, yaw, name: 'Arc floor lamp' });
}
place('tree', 'plant-olive-tree', { x: -2.25, z: -1.95, scale: 1.2, name: 'Olive tree' });
place('door-plant', 'plant-potted-philodendron', { x: -2.33, z: 1.65, name: 'Potted plant' });

// ---------------------------------------------------------------- north wall: sideboard, art, lanterns, shelf
place('sideboard', 'sideboard-oak', { x: -0.55, z: -2.4 + A('sideboard-oak').dimensionsM[2] / 2 + 0.001, name: 'Oak sideboard' });
const sbTop = top('sideboard');
place('art', 'art-abstract-circles', { x: -0.85, z: -2.4 + A('art-abstract-circles').dimensionsM[2] / 2, y: sbTop + 0.13, support: 'wall', name: 'Abstract print' });
place('sb-vase-1', 'vase-bottle-tall', { x: -1.45, z: -2.16, y: sbTop, scale: 0.75, parent: 'sideboard', name: 'Bottle vase' });
place('sb-vase-2', 'vase-clay-round', { x: -1.27, z: -2.13, y: sbTop, scale: 0.8, parent: 'sideboard', name: 'Round vase' });
place('sb-vase-3', 'vase-bud-sand', { x: -1.11, z: -2.19, y: sbTop, scale: 0.6, parent: 'sideboard', name: 'Bud vase' });
place('sb-book-1', 'book-hardcover', { x: -0.3, z: -2.12, y: sbTop, yaw: 5, tilt: FLAT, dims: [0.2, 0.28, 0.035], parent: 'sideboard', name: 'Large book', overrides: cover('#ece7df') });
place('sb-book-2', 'book-hardcover', { x: -0.3, z: -2.12, y: top('sb-book-1'), yaw: -3, tilt: FLAT, dims: [0.17, 0.24, 0.03], parent: 'sb-book-1', name: 'Book', overrides: cover('#d8c4a6') });
place('sb-tray', 'tray-walnut', { x: 0.03, z: -2.1, y: sbTop, yaw: 10, parent: 'sideboard', name: 'Walnut tray' });
place('sb-plant', 'plant-small-succulent', { x: 0.33, z: -2.13, y: sbTop, scale: 1.6, parent: 'sideboard', name: 'Leafy plant' });
place('lantern-tall', 'lantern-tall', { x: 1.02, z: -2.15, name: 'Tall lantern' });
place('lantern-orb', 'lantern-orb', { x: 1.1, z: -1.82, name: 'Orb lantern' });

const shelf = place('shelf', 'shelf-open-oak', { x: 2.05, z: -2.4 + A('shelf-open-oak').dimensionsM[2] / 2 + 0.001, name: 'Open bookshelf' });
const sx = shelf.transform.position[0];
const sz = shelf.transform.position[2];
const board = (i) => [0.05, 0.47, 0.89, 1.31, 1.73][i];
const SPINES = ['#cdb89a', '#8c7a6b', '#ece7df', '#9fa88f', '#b8704c', '#2f3440', '#d8c4a6'];
// Board 1: a flat stack topped by a small plant, and a bud vase.
place('sh1-book-a', 'book-hardcover', { x: sx - 0.28, z: sz, y: board(1), tilt: FLAT, dims: [0.18, 0.26, 0.03], parent: 'shelf', name: 'Book', overrides: cover(SPINES[1]) });
place('sh1-book-b', 'book-hardcover', { x: sx - 0.28, z: sz, y: top('sh1-book-a'), yaw: 4, tilt: FLAT, dims: [0.17, 0.23, 0.028], parent: 'sh1-book-a', name: 'Book', overrides: cover(SPINES[2]) });
place('sh1-plant', 'plant-small-succulent', { x: sx + 0.22, z: sz, y: board(1), parent: 'shelf', name: 'Shelf plant' });
// Board 2: a row of upright books (spines out) and a small vase.
for (let i = 0; i < 6; i++) {
  place(`sh2-book-${i}`, 'book-hardcover', { x: sx - 0.4 + i * 0.034, z: sz, y: board(2), yaw: 90, dims: [0.16, 0.22 + (i % 3) * 0.02, 0.03], parent: 'shelf', name: 'Book', overrides: cover(SPINES[i % SPINES.length]) });
}
place('sh2-vase', 'vase-bud-sand', { x: sx + 0.25, z: sz, y: board(2), scale: 0.6, parent: 'shelf', name: 'Bud vase' });
// Board 3: plant, bowl, flat books.
place('sh3-plant', 'plant-small-succulent', { x: sx - 0.25, z: sz, y: board(3), parent: 'shelf', name: 'Shelf plant' });
place('sh3-book', 'book-hardcover', { x: sx + 0.2, z: sz, y: board(3), yaw: -6, tilt: FLAT, dims: [0.18, 0.25, 0.03], parent: 'shelf', name: 'Book', overrides: cover(SPINES[4]) });
place('sh3-bowl', 'bowl-stoneware', { x: sx + 0.2, z: sz, y: top('sh3-book'), parent: 'sh3-book', name: 'Dish' });
// Board 4: upright books and a plant.
for (let i = 0; i < 4; i++) {
  place(`sh4-book-${i}`, 'book-hardcover', { x: sx + 0.12 + i * 0.034, z: sz, y: board(4), yaw: 90, dims: [0.15, 0.21 + (i % 2) * 0.02, 0.03], parent: 'shelf', name: 'Book', overrides: cover(SPINES[(i + 3) % SPINES.length]) });
}
place('sh4-plant', 'plant-small-succulent', { x: sx - 0.25, z: sz, y: board(4), parent: 'shelf', name: 'Shelf plant' });

// ---------------------------------------------------------------- shell
const shell = {
  id: SHELL,
  sourceScanId: uuid('7e520000', 9),
  coordinateVersion: 1,
  floor: { polygonXZ: [[-2.7, -2.4], [-2.7, 2.4], [2.7, 2.4], [2.7, -2.4]], elevationY: 0 },
  walls: [
    { id: W.west, fromXZ: [-2.7, -2.4], toXZ: [-2.7, 2.4], heightM: 2.7, thicknessM: 0.2 },
    { id: W.south, fromXZ: [-2.7, 2.4], toXZ: [2.7, 2.4], heightM: 2.7, thicknessM: 0.2 },
    { id: W.east, fromXZ: [2.7, 2.4], toXZ: [2.7, -2.4], heightM: 2.7, thicknessM: 0.2 },
    { id: W.north, fromXZ: [2.7, -2.4], toXZ: [-2.7, -2.4], heightM: 2.7, thicknessM: 0.2 },
  ],
  openings: [
    { id: uuid('7e5009e7', 1), wallId: W.west, kind: 'door', offsetM: 1.05, widthM: 2.5, bottomM: 0, heightM: 2.3, swing: 'none', glazing: { panels: 3, frameColor: '#1e1e1e' } },
    { id: uuid('7e5009e7', 2), wallId: W.south, kind: 'opening', offsetM: 1.1, widthM: 0.9, bottomM: 0, heightM: 2.1, swing: 'none' },
    { id: uuid('7e5009e7', 3), wallId: W.east, kind: 'window', offsetM: 0.5, widthM: 2.5, bottomM: 0.9, heightM: 1.4, glazing: { panels: 2, frameColor: '#1e1e1e' } },
  ],
  ceilingHeightM: 2.7,
};

const fixture = {
  schemaVersion: 1,
  name: 'test2 — warm minimal living room',
  referenceImage: 'assets/test2.png',
  photoCamera: { position: [5.6, 7.2, 6.4], target: [-0.4, 0.2, -0.5], fov: 32 },
  shell,
  scene: {
    schemaVersion: 1,
    id: SCENE,
    roomId: ROOM,
    shellId: SHELL,
    revision: 0,
    lightingPreset: 'golden',
    appearance: { wallColor: '#efe6da', floorMaterial: 'honey' },
    updatedAt: '2026-10-17T12:00:00.000Z',
    objects: objects.map((o) => ({ ...o, transform: { ...o.transform, rotation: o.transform.rotation.map((v) => round(v * 1e8) / 1e8) } })),
  },
};
writeFileSync(join(here, '../fixtures/test2-room.json'), `${JSON.stringify(fixture, null, 2)}\n`);
console.log(`test2-room.json: ${objects.length} objects`);
