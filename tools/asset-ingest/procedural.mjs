// Self-authored procedural furniture (CC0, ours). Geometry comes from three's pure-JS generators;
// each builder returns { parts, materials } which ingest.mjs packs into a glTF document.
// Front faces +Z, base at y = 0, meters. Dimensions follow agent_docs/TEST2_SCENE_SPEC.md.
import {
  BoxGeometry, CatmullRomCurve3, CylinderGeometry, Euler, ExtrudeGeometry, LatheGeometry, Matrix4, Path, Quaternion,
  Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const part = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) => ({ geometry, material, position, rotation, scale });
const rbox = (w, h, d, r = 0.03, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

// ---------------------------------------------------------------- SVG textures
const svgTravertine = () => {
  const lines = [];
  for (let i = 0; i < 70; i++) {
    const y = (i * 997) % 1024;
    const amp = 6 + (i * 37) % 14;
    const op = 0.05 + ((i * 13) % 10) / 100;
    lines.push(`<path d="M0 ${y} C 256 ${y - amp}, 512 ${y + amp}, 768 ${y - amp / 2} S 1024 ${y + amp / 3}, 1024 ${y}" stroke="#8a7458" stroke-opacity="${op}" stroke-width="${2 + (i % 5)}" fill="none"/>`);
  }
  for (let i = 0; i < 120; i++) lines.push(`<ellipse cx="${(i * 389) % 1024}" cy="${(i * 613) % 1024}" rx="${3 + (i % 7)}" ry="${1 + (i % 3)}" fill="#7a6248" fill-opacity="0.18"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#ddcdb2"/>${lines.join('')}</svg>`;
};
const svgWood = (base, grain) => {
  const lines = [];
  for (let i = 0; i < 90; i++) {
    const x = (i * 11.3) % 1024;
    lines.push(`<path d="M${x} 0 C ${x + 8} 300, ${x - 6} 700, ${x + 4} 1024" stroke="${grain}" stroke-opacity="${0.08 + (i % 6) / 50}" stroke-width="${1 + (i % 4)}" fill="none"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${base}"/>${lines.join('')}</svg>`;
};
const svgPrint = () => `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024">
  <rect width="768" height="1024" fill="#efe4d3"/>
  <circle cx="300" cy="470" r="200" fill="#d9b48f"/>
  <circle cx="470" cy="560" r="180" fill="#c98e6b" fill-opacity="0.85"/>
  <circle cx="390" cy="760" r="90" fill="#e8cdb0"/>
  <rect x="0" y="0" width="768" height="1024" fill="none" stroke="#f7f0e4" stroke-width="80"/></svg>`;
const svgKnit = (c) => {
  const rows = [];
  for (let y = 0; y < 512; y += 16) for (let x = 0; x < 512; x += 16) rows.push(`<path d="M${x} ${y + 2} l8 12 l8 -12" stroke="#000" stroke-opacity="0.08" stroke-width="3" fill="none"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${c}"/>${rows.join('')}</svg>`;
};
const svgBoucle = (c) => {
  const dots = [];
  for (let i = 0; i < 2500; i++) dots.push(`<circle cx="${(i * 37.7) % 512}" cy="${(i * 91.3) % 512}" r="${1.5 + (i % 3)}" fill="#000" fill-opacity="0.07"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="${c}"/>${dots.join('')}</svg>`;
};

// ---------------------------------------------------------------- builders
export const builders = {
  /** Modern 3-seat sofa: deep seat, square track arms, two seat + two back cushions, low dark legs. */
  sofa({ w = 2.3, h = 0.8, d = 0.95 } = {}) {
    const arm = 0.18;
    const legH = 0.07;
    const baseH = 0.2;
    const seatH = 0.17;
    const backD = 0.22;
    const inner = w - 2 * arm;
    const parts = [
      part(rbox(w, baseH, d, 0.02), 'fabric', [0, legH + baseH / 2, 0]),
      part(rbox(arm, h * 0.78 - legH, d, 0.06), 'fabric', [-(w - arm) / 2, legH + (h * 0.78 - legH) / 2, 0]),
      part(rbox(arm, h * 0.78 - legH, d, 0.06), 'fabric', [(w - arm) / 2, legH + (h * 0.78 - legH) / 2, 0]),
      part(rbox(w - 0.02, h - legH - baseH, backD, 0.06), 'fabric', [0, legH + baseH + (h - legH - baseH) / 2, -(d - backD) / 2]),
    ];
    for (const s of [-1, 1]) {
      parts.push(part(rbox(inner / 2 - 0.01, seatH, d - backD - 0.02, 0.06, 4), 'fabric', [s * inner / 4, legH + baseH + seatH / 2, backD / 2]));
      parts.push(part(rbox(inner / 2 - 0.02, 0.4, 0.18, 0.08, 4), 'fabric', [s * inner / 4, legH + baseH + seatH + 0.18, -(d - backD) / 2 + backD / 2 + 0.08], [-0.18, 0, 0]));
    }
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(new CylinderGeometry(0.022, 0.018, legH, 12), 'legs', [x * (w / 2 - 0.08), legH / 2, z * (d / 2 - 0.08)]));
    return {
      parts,
      materials: {
        fabric: { color: '#e9e1d3', roughness: 0.96, texture: svgBoucle('#ffffff') },
        legs: { color: '#3a2f27', roughness: 0.5 },
      },
    };
  },

  /** Round bouclé barrel chair: drum base, wraparound back shell (≈240°), seat cushion. Opening faces +Z. */
  barrelChair({ w = 0.85, h = 0.75, d = 0.8 } = {}) {
    const r = w / 2;
    const seatY = 0.42;
    const arc = (240 * Math.PI) / 180;
    const shell = new Shape();
    const ro = r;
    const ri = r - 0.13;
    const a0 = Math.PI / 2 - arc / 2; // centred on +y in shape space; rotateX(−90°) maps shape +y → world −Z (the back)
    shell.absarc(0, 0, ro, a0, a0 + arc, false);
    shell.absarc(0, 0, ri, a0 + arc, a0, true);
    const back = new ExtrudeGeometry(shell, { depth: h - 0.04, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 48 });
    back.rotateX(-Math.PI / 2);
    const sz = d / w;
    return {
      parts: [
        part(new CylinderGeometry(r * 0.98, r * 0.95, seatY - 0.02, 48), 'boucle', [0, (seatY - 0.02) / 2, 0], [0, 0, 0], [1, 1, sz]),
        part(back, 'boucle', [0, 0.02, 0], [0, 0, 0], [1, 1, sz]),
        part(new CylinderGeometry(ri + 0.02, ri + 0.02, 0.12, 48), 'boucle', [0, seatY + 0.04, 0.02], [0, 0, 0], [1, 1, sz]),
      ],
      materials: { boucle: { color: '#efe8dd', roughness: 1, texture: svgBoucle('#efe8dd') } },
    };
  },

  /** Round travertine coffee table with four chunky cylindrical legs. */
  roundTable({ w = 0.9, h = 0.38 } = {}) {
    const topT = 0.06;
    const legR = 0.065;
    const lr = w / 2 - 0.16;
    const parts = [part(new CylinderGeometry(w / 2, w / 2, topT, 64), 'travertine', [0, h - topT / 2, 0])];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      parts.push(part(new CylinderGeometry(legR, legR, h - topT, 32), 'travertine', [Math.sin(a) * lr, (h - topT) / 2, Math.cos(a) * lr]));
    }
    return { parts, materials: { travertine: { color: '#ffffff', roughness: 0.62, texture: svgTravertine() } } };
  },

  /** Arc floor lamp: weighted base at the back (−Z), arcing pole, opal dome shade at the front (+Z). */
  arcLamp({ h = 1.9, d = 1.1 } = {}) {
    const baseZ = -d / 2 + 0.18;
    const shadeZ = d / 2 - 0.2;
    const curve = new CatmullRomCurve3([
      new Vector3(0, 0.03, baseZ), new Vector3(0, 1.2, baseZ - 0.05), new Vector3(0, h - 0.1, baseZ + 0.15),
      new Vector3(0, h - 0.05, (baseZ + shadeZ) / 2), new Vector3(0, h - 0.2, shadeZ - 0.05), new Vector3(0, h - 0.33, shadeZ),
    ]);
    return {
      parts: [
        part(new CylinderGeometry(0.17, 0.18, 0.035, 48), 'metal', [0, 0.0175, baseZ]),
        part(new TubeGeometry(curve, 96, 0.012, 10, false), 'metal'),
        part(new SphereGeometry(0.2, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), 'shade', [0, h - 0.4, shadeZ]),
        part(new SphereGeometry(0.06, 16, 12), 'bulb', [0, h - 0.43, shadeZ]),
      ],
      materials: {
        metal: { color: '#1c1c1c', roughness: 0.4, metalness: 0.6 },
        shade: { color: '#f4eee4', roughness: 0.6, emissive: '#ffe1b8', emissiveStrength: 1.4, doubleSided: true },
        bulb: { color: '#fff3dc', roughness: 0.3, emissive: '#ffe9c8', emissiveStrength: 4 },
      },
    };
  },

  /** Honey-oak four-door sideboard on slim tapered legs. */
  sideboard({ w = 2.1, h = 0.75, d = 0.48 } = {}) {
    const legH = 0.16;
    const bodyH = h - legH;
    const parts = [part(rbox(w, bodyH, d, 0.012), 'oak', [0, legH + bodyH / 2, 0])];
    for (let i = 1; i < 4; i++) parts.push(part(new BoxGeometry(0.006, bodyH - 0.06, 0.006), 'groove', [-w / 2 + (w * i) / 4, legH + bodyH / 2, d / 2 + 0.001]));
    for (let i = 0; i < 4; i++) parts.push(part(new CylinderGeometry(0.008, 0.008, 0.12, 8), 'groove', [-w / 2 + (w * (i + 0.5)) / 4 + (i % 2 ? -0.18 : 0.18), legH + bodyH * 0.55, d / 2 + 0.01]));
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(part(new CylinderGeometry(0.022, 0.014, legH, 12), 'legs', [x * (w / 2 - 0.1), legH / 2, z * (d / 2 - 0.07)]));
    return {
      parts,
      materials: {
        oak: { color: '#ffffff', roughness: 0.55, texture: svgWood('#c48c58', '#6d4526') },
        groove: { color: '#4a3220', roughness: 0.6 },
        legs: { color: '#7a5434', roughness: 0.55 },
      },
    };
  },

  /** Open oak shelving on a black steel ladder frame, 5 boards. */
  openShelf({ w = 1.0, h = 1.9, d = 0.35, boards = [0.05, 0.47, 0.89, 1.31, 1.73] } = {}) {
    const t = 0.03;
    const post = 0.025;
    const parts = boards.map((y) => part(new BoxGeometry(w - 0.02, t, d - 0.02), 'oak', [0, y - t / 2, 0]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new BoxGeometry(post, h, post), 'steel', [sx * (w / 2 - post / 2), h / 2, sz * (d / 2 - post / 2)]));
    for (const sx of [-1, 1]) for (const y of [0.15, h - 0.04]) parts.push(part(new BoxGeometry(post * 0.6, post * 0.6, d - post), 'steel', [sx * (w / 2 - post / 2), y, 0]));
    return {
      parts,
      materials: {
        oak: { color: '#ffffff', roughness: 0.55, texture: svgWood('#c99560', '#7a4f2a') },
        steel: { color: '#1b1b1b', roughness: 0.4, metalness: 0.7 },
      },
    };
  },

  /** Tall glass lantern with a candle glow. */
  lanternTall({ w = 0.22, h = 0.55 } = {}) {
    const r = w / 2;
    return {
      parts: [
        part(new CylinderGeometry(r, r, 0.03, 40), 'wood', [0, 0.015, 0]),
        part(new CylinderGeometry(r * 0.92, r * 0.92, h - 0.1, 40, 1, true), 'glass', [0, 0.03 + (h - 0.1) / 2, 0]),
        part(new CylinderGeometry(r, r * 0.85, 0.04, 40), 'wood', [0, h - 0.07 + 0.02, 0]),
        part(new TorusGeometry(r * 0.45, 0.008, 8, 32), 'metal', [0, h - 0.03, 0]),
        part(new CylinderGeometry(0.035, 0.035, 0.16, 20), 'candle', [0, 0.03 + 0.08, 0]),
        part(new SphereGeometry(0.03, 12, 10), 'flame', [0, 0.03 + 0.19, 0]),
      ],
      materials: {
        wood: { color: '#b98b5e', roughness: 0.6 },
        glass: { color: '#e9f1f3', roughness: 0.05, opacity: 0.22, doubleSided: true },
        metal: { color: '#2a2a2a', roughness: 0.4, metalness: 0.7 },
        candle: { color: '#f7efe0', roughness: 0.6, emissive: '#ffd59a', emissiveStrength: 0.8 },
        flame: { color: '#ffd28a', roughness: 0.3, emissive: '#ffb24d', emissiveStrength: 6 },
      },
    };
  },

  /** Small frosted glass orb lantern. */
  lanternOrb({ w = 0.2, h = 0.24 } = {}) {
    return {
      parts: [
        part(new CylinderGeometry(w * 0.35, w * 0.4, 0.03, 32), 'wood', [0, 0.015, 0]),
        part(new SphereGeometry(w / 2, 40, 24), 'frosted', [0, 0.03 + w / 2 - 0.005, 0], [0, 0, 0], [1, (h - 0.03) / w, 1]),
      ],
      materials: {
        wood: { color: '#b98b5e', roughness: 0.6 },
        frosted: { color: '#fff6e8', roughness: 0.5, emissive: '#ffcf8a', emissiveStrength: 1.6 },
      },
    };
  },

  pillow({ w = 0.45, h = 0.45, d = 0.15 } = {}) {
    return {
      parts: [part(rbox(w, h, d, 0.07, 6), 'linen', [0, h / 2, 0])],
      materials: { linen: { color: '#b4643a', roughness: 0.95, texture: svgKnit('#ffffff') } },
    };
  },

  throwBlanket({ w = 0.6, h = 0.06, d = 0.45 } = {}) {
    return {
      parts: [
        part(rbox(w, h / 2, d, 0.012, 3), 'knit', [0, h / 4, 0]),
        part(rbox(w * 0.98, h / 2, d * 0.96, 0.012, 3), 'knit', [0, (3 * h) / 4, 0.005]),
      ],
      materials: { knit: { color: '#efe7da', roughness: 1, texture: svgKnit('#ffffff') } },
    };
  },

  /** Hardcover book standing upright: w = cover width, h = height, d = thickness (spine faces +Z). */
  book({ w = 0.16, h = 0.24, d = 0.03 } = {}) {
    return {
      parts: [
        part(new BoxGeometry(w, h, d), 'cover', [0, h / 2, 0]),
        part(new BoxGeometry(w - 0.006, h - 0.008, d - 0.004), 'pages', [0.004, h / 2, 0], [0, 0, 0], [1.001, 1.001, 1.001]),
      ],
      materials: { cover: { color: '#cdb89a', roughness: 0.7 }, pages: { color: '#f4efe3', roughness: 0.9 } },
    };
  },

  bowl({ w = 0.14, h = 0.05 } = {}) {
    const r = w / 2;
    const pts = [new Vector2(0, 0), new Vector2(r * 0.5, 0), new Vector2(r * 0.85, h * 0.4), new Vector2(r, h), new Vector2(r * 0.9, h), new Vector2(r * 0.76, h * 0.45), new Vector2(r * 0.42, h * 0.12), new Vector2(0, h * 0.12)];
    return { parts: [part(new LatheGeometry(pts, 48), 'stoneware')], materials: { stoneware: { color: '#9a938a', roughness: 0.75, doubleSided: true } } };
  },

  tray({ w = 0.3, h = 0.03, d = 0.18 } = {}) {
    const rim = 0.012;
    return {
      parts: [
        part(rbox(w, 0.012, d, 0.004), 'walnut', [0, 0.006, 0]),
        part(new BoxGeometry(w, h, rim), 'walnut', [0, h / 2, d / 2 - rim / 2]),
        part(new BoxGeometry(w, h, rim), 'walnut', [0, h / 2, -d / 2 + rim / 2]),
        part(new BoxGeometry(rim, h, d), 'walnut', [w / 2 - rim / 2, h / 2, 0]),
        part(new BoxGeometry(rim, h, d), 'walnut', [-w / 2 + rim / 2, h / 2, 0]),
      ],
      materials: { walnut: { color: '#5d4130', roughness: 0.5 } },
    };
  },

  /** Portrait abstract print in a slim oak frame; picture faces +Z. */
  artPrint({ w = 0.6, h = 0.78, d = 0.035 } = {}) {
    const f = 0.03;
    const frame = new Shape();
    frame.moveTo(-w / 2, 0); frame.lineTo(w / 2, 0); frame.lineTo(w / 2, h); frame.lineTo(-w / 2, h); frame.lineTo(-w / 2, 0);
    const hole = new Path();
    hole.moveTo(-w / 2 + f, f); hole.lineTo(-w / 2 + f, h - f); hole.lineTo(w / 2 - f, h - f); hole.lineTo(w / 2 - f, f); hole.lineTo(-w / 2 + f, f);
    frame.holes.push(hole);
    const frameGeo = new ExtrudeGeometry(frame, { depth: d, bevelEnabled: false });
    frameGeo.translate(0, 0, -d / 2);
    return {
      parts: [
        part(frameGeo, 'oak'),
        part(new BoxGeometry(w - 2 * f, h - 2 * f, 0.004), 'print', [0, h / 2, -d / 2 + 0.008]),
      ],
      materials: {
        oak: { color: '#ffffff', roughness: 0.55, texture: svgWood('#c99560', '#7a4f2a') },
        print: { color: '#ffffff', roughness: 0.85, texture: svgPrint(), textureOnFront: true },
      },
    };
  },
};

const _m = new Matrix4();
/** Bake a part's transform into a copy of its geometry. */
export function bakedGeometry(p) {
  const g = p.geometry.index ? p.geometry.clone() : p.geometry.clone();
  _m.compose(new Vector3(...p.position), new Quaternion().setFromEuler(new Euler(...p.rotation)), new Vector3(...p.scale));
  g.applyMatrix4(_m);
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
