/** Optional software contact sheet for inspecting asset orientation without WebGL. */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dequantize } from "@gltf-transform/functions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const assets = JSON.parse(
  await fs.readFile(
    path.join(root, "packages/contracts/src/catalog.json"),
    "utf8",
  ),
);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
await MeshoptDecoder.ready;
const width = 320,
  height = 320;
const normalize = (a) => {
  const n = Math.hypot(...a);
  return a.map((x) => x / n);
};
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const view = normalize([2, 1.3, 4]),
  right = normalize(cross([0, 1, 0], view)),
  up = normalize(cross(view, right));
const light = normalize([-1, 2, 3]);
const transform = (p, m) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
const composites = [];
const selected = assets.filter(
  (a) =>
    !process.env.HOUSE_PREVIEW_PREFIX ||
    a.glbStorageKey.includes(`/models/${process.env.HOUSE_PREVIEW_PREFIX}`),
);
for (const [i, a] of selected.entries()) {
  const doc = await io.read(
    path.join(root, "apps/web/public", a.glbStorageKey),
  );
  await doc.transform(dequantize());
  const texData = new Map();
  for (const t of doc.getRoot().listTextures()) {
    const { data, info } = await sharp(t.getImage())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    texData.set(t, { data, info });
  }
  const faces = [];
  doc
    .getRoot()
    .listScenes()[0]
    .traverse((node) => {
      const m = node.getWorldMatrix(),
        mesh = node.getMesh();
      if (!mesh) return;
      for (const primitive of mesh.listPrimitives()) {
        const pos = primitive.getAttribute("POSITION"),
          uv = primitive.getAttribute("TEXCOORD_0"),
          indices = primitive.getIndices()?.getArray();
        const count = indices?.length ?? pos.getCount();
        const mat = primitive.getMaterial(),
          texture = texData.get(mat?.getBaseColorTexture()),
          factor = mat?.getBaseColorFactor() ?? [0.7, 0.7, 0.7, 1];
        for (let j = 0; j < count; j += 3) {
          const ids = [0, 1, 2].map((k) => (indices ? indices[j + k] : j + k)),
            p = ids.map((id) => transform(pos.getElement(id, []), m));
          const n = normalize(
            cross(
              p[1].map((v, k) => v - p[0][k]),
              p[2].map((v, k) => v - p[0][k]),
            ),
          );
          const shade = 0.62 + 0.38 * Math.abs(dot(n, light));
          let color = factor.slice(0, 3).map((v) => Math.round(v * 255));
          if (texture && uv) {
            const tex = ids.map((id) => uv.getElement(id, []));
            let u = tex.reduce((s, t) => s + t[0], 0) / 3,
              v = tex.reduce((s, t) => s + t[1], 0) / 3;
            u = ((u % 1) + 1) % 1;
            v = ((v % 1) + 1) % 1;
            const index =
              (Math.min(
                texture.info.height - 1,
                Math.floor(v * texture.info.height),
              ) *
                texture.info.width +
                Math.min(
                  texture.info.width - 1,
                  Math.floor(u * texture.info.width),
                )) *
              4;
            if (
              mat.getAlphaMode() === "MASK" &&
              texture.data[index + 3] / 255 < mat.getAlphaCutoff()
            )
              continue;
            color = [0, 1, 2].map((k) => texture.data[index + k] * factor[k]);
          }
          const projected = p.map((p) => [dot(p, right), -dot(p, up)]),
            depth = p.reduce((s, p) => s + dot(p, view), 0) / 3;
          faces.push({
            projected,
            depth,
            color: color.map((c) => Math.min(255, Math.round(c * shade))),
          });
        }
      }
    });
  const points = faces.flatMap((f) => f.projected),
    min = [Infinity, Infinity],
    max = [-Infinity, -Infinity];
  for (const p of points)
    for (let k = 0; k < 2; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  const scale = Math.min(
    (width - 40) / (max[0] - min[0]),
    (height - 65) / (max[1] - min[1]),
  );
  const project = (p) => [
    (p[0] - (max[0] + min[0]) / 2) * scale + width / 2,
    (p[1] - (max[1] + min[1]) / 2) * scale + height / 2 - 10,
  ];
  faces.sort((a, b) => a.depth - b.depth);
  const svg =
    `<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f5f2eb"/>` +
    faces
      .map(
        (f) =>
          `<path d="M${f.projected
            .map(project)
            .map((p) => p.map((n) => n.toFixed(1)).join(","))
            .join("L")}Z" fill="rgb(${f.color.join(",")})"/>`,
      )
      .join("") +
    `<text x="14" y="${height - 12}" font-family="sans-serif" font-size="11" fill="#555">${a.title}</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  if (process.env.HOUSE_WRITE_THUMBNAILS === "1")
    await sharp(png)
      .webp({ quality: 86 })
      .toFile(path.join(root, "apps/web/public", a.thumbnailStorageKey));
  composites.push({
    input: png,
    left: (i % 4) * width,
    top: Math.floor(i / 4) * height,
  });
  console.log("Previewed", a.title);
}
await fs.mkdir(path.join(root, "test-results"), { recursive: true });
await sharp({
  create: {
    width: width * 4,
    height: height * Math.ceil(selected.length / 4),
    channels: 3,
    background: "#f5f2eb",
  },
})
  .composite(composites)
  .png()
  .toFile(path.join(root, "test-results/assets-software-preview.png"));
