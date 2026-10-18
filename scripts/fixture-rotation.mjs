// Keep authored quarter-turn poses while migrating to the common quaternion path.
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const rotate = (v, q) =>
  mul(mul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3);
export function foldTilt(object) {
  if (!object.tilt) return object;
  const { tilt, ...o } = object;
  const x = (tilt.x * Math.PI) / 4,
    z = (tilt.z * Math.PI) / 4;
  const q = mul(
    [0, 0, Math.sin(z), Math.cos(z)],
    [Math.sin(x), 0, 0, Math.cos(x)],
  );
  let [w, h, d] = o.dimensionsM.map((v, i) => v * o.transform.scale[i]);
  const originalH = h;
  if (tilt.x % 2) [h, d] = [d, h];
  if (tilt.z % 2) [w, h] = [h, w];
  const rotation = mul(o.transform.rotation, q);
  const oldCenter = rotate([0, h / 2, 0], o.transform.rotation),
    newCenter = rotate([0, originalH / 2, 0], rotation);
  return {
    ...o,
    transform: {
      ...o.transform,
      rotation,
      position: o.transform.position.map(
        (v, i) => v + oldCenter[i] - newCenter[i],
      ),
    },
  };
}
export function poseTextiles(o) {
  const poses = {
    "Rust pillow": [-0.95, 0.45570294502613273, -0.334],
    "Sand pillow": [-0.22, 0.45570294502612546, -0.295],
    "Oat pillow": [0.38, 0.45570294502614156, -0.301],
    "Knit throw": [-0.6, 0.4401719, 0.033],
  };
  const position = poses[o.displayName];
  if (!position) return o;
  const x = (-15 * Math.PI) / 360;
  return {
    ...o,
    transform: {
      ...o.transform,
      position,
      rotation: o.displayName.includes("pillow")
        ? mul(o.transform.rotation, [Math.sin(x), 0, 0, Math.cos(x)])
        : o.transform.rotation,
    },
  };
}
