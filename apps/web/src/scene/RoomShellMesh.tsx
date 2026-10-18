import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, Shape, SRGBColorSpace, Vector3, type Group, type Material, type Texture } from 'three';
import type { Opening, RoomShell, SceneAppearance } from '@house/contracts';
import { cross2, wallFrames, type WallFrame } from '@house/scene-engine';
import { useEditor, type WallMode } from '../state/store';
import { GROUND_COLOR, presetOf } from './Lighting';

export const DEFAULT_WALL_COLOR = '#ece6dc';
const TRIM_COLOR = '#f7f3ec';
const FADED_OPACITY = 0.08;
const GLASS_OPACITY = 0.16;
/** Height camera-facing walls drop to in cut-away mode (m). */
export const CUTAWAY_HEIGHT_M = 1.05;

/** Floor finishes available for the per-scene appearance (folders under public/textures). */
export const FLOOR_MATERIALS: Record<string, { label: string; folder: string; tileM: number; tint: string }> = {
  oak: { label: 'Light oak', folder: 'floor-oak', tileM: 1.7, tint: '#ffffff' },
  honey: { label: 'Honey oak', folder: 'floor-oak', tileM: 2.4, tint: '#ffcf95' },
  walnut: { label: 'Walnut', folder: 'floor-oak', tileM: 1.7, tint: '#9b7656' },
};

type Panel = { s0: number; s1: number; y0: number; y1: number };

/** Split a wall into solid panels around its openings (real cut-outs, not decals). */
export function wallPanels(length: number, height: number, openings: readonly Opening[], extendStart: number, extendEnd: number): Panel[] {
  const sorted = [...openings].sort((a, b) => a.offsetM - b.offsetM);
  const panels: Panel[] = [];
  let cursor = -extendStart;
  for (const o of sorted) {
    const s0 = Math.max(o.offsetM, cursor);
    const s1 = Math.min(o.offsetM + o.widthM, length);
    if (s1 <= s0) continue;
    if (s0 > cursor) panels.push({ s0: cursor, s1: s0, y0: 0, y1: height });
    if (o.bottomM > 0) panels.push({ s0, s1, y0: 0, y1: Math.min(o.bottomM, height) });
    const top = o.bottomM + o.heightM;
    if (top < height) panels.push({ s0, s1, y0: top, y1: height });
    cursor = s1;
  }
  if (length + extendEnd > cursor) panels.push({ s0: cursor, s1: length + extendEnd, y0: 0, y1: height });
  return panels.filter((p) => p.y1 - p.y0 > 1e-4 && p.s1 - p.s0 > 1e-4);
}

/** +1 when the wall's inward normal is local +Z under the wall's yaw, else −1. */
function sideSign(dir: [number, number], inward: [number, number]): number {
  const localZ: [number, number] = [-dir[1], dir[0]];
  return localZ[0] * inward[0] + localZ[1] * inward[1] >= 0 ? 1 : -1;
}

type WallMats = { wall: MeshStandardMaterial; trim: MeshStandardMaterial; frame: MeshStandardMaterial; glass: MeshPhysicalMaterial };

function Wall({ frame, openings, extendEnd, mode, color }: { frame: WallFrame; openings: Opening[]; extendEnd: number; mode: WallMode; color: string }) {
  const ref = useRef<Group>(null);
  const { wall, from, dir, inward, length } = frame;
  const T = Math.max(wall.thicknessM, 0.04);
  const H = wall.heightM;
  // One material set per wall so fading/cutting one wall never affects another.
  const mats = useMemo<WallMats>(() => ({
    wall: new MeshStandardMaterial({ color: DEFAULT_WALL_COLOR, roughness: 0.92, transparent: true, opacity: 1 }),
    trim: new MeshStandardMaterial({ color: TRIM_COLOR, roughness: 0.6, transparent: true, opacity: 1 }),
    frame: new MeshStandardMaterial({ color: '#1e1e1e', roughness: 0.45, metalness: 0.3, transparent: true, opacity: 1 }),
    glass: new MeshPhysicalMaterial({ color: '#d7e8f0', roughness: 0.04, metalness: 0, transparent: true, opacity: GLASS_OPACITY, depthWrite: false }),
  }), []);
  useMemo(() => mats.wall.color.set(color), [mats, color]);
  const anim = useRef({ opacity: 1, height: H });
  const [cutH, setCutH] = useState(H);
  const panels = useMemo(() => wallPanels(length, cutH, openings, 0, extendEnd), [length, cutH, openings, extendEnd]);
  const yaw = Math.atan2(-dir[1], dir[0]); // local +X along the wall
  const outward = useMemo(() => new Vector3(-inward[0], 0, -inward[1]), [inward]);
  const mid = useMemo(() => new Vector3(from[0] + dir[0] * length / 2, H / 2, from[1] + dir[1] * length / 2), [from, dir, length, H]);
  const tmp = useMemo(() => new Vector3(), []);
  const side = sideSign(dir, inward);

  // Walls between the camera and the room fade or drop (cut-away) smoothly, time-based.
  useFrame(({ camera, invalidate }, dt) => {
    tmp.copy(camera.position).sub(mid);
    const facing = tmp.dot(outward) > 0;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    const a = anim.current;
    const targetOpacity = mode === 'fade' && facing ? FADED_OPACITY : 1;
    const targetHeight = mode === 'cutaway' && facing ? Math.min(CUTAWAY_HEIGHT_M, H) : H;
    a.opacity += (targetOpacity - a.opacity) * k;
    a.height += (targetHeight - a.height) * k;
    if (Math.abs(a.opacity - targetOpacity) < 0.003) a.opacity = targetOpacity;
    if (Math.abs(a.height - targetHeight) < 0.003) a.height = targetHeight;
    const opaque = a.opacity > 0.98;
    for (const m of [mats.wall, mats.trim, mats.frame]) {
      m.opacity = a.opacity;
      m.depthWrite = opaque;
    }
    mats.glass.opacity = GLASS_OPACITY * a.opacity;
    if (ref.current) ref.current.visible = a.opacity > 0.01;
    const rounded = Math.round(a.height * 50) / 50;
    if (Math.abs(rounded - cutH) > 1e-6) setCutH(rounded);
    if (a.opacity !== targetOpacity || a.height !== targetHeight) invalidate();
  });

  const cut = cutH < H - 1e-3;
  return (
    <group ref={ref} position={[from[0], 0, from[1]]} rotation={[0, yaw, 0]} name={`wall:${wall.id}`}>
      {panels.map((p, i) => (
        <mesh key={i} material={mats.wall} castShadow receiveShadow position={[(p.s0 + p.s1) / 2, (p.y0 + p.y1) / 2, (-T / 2) * side]}>
          <boxGeometry args={[p.s1 - p.s0, p.y1 - p.y0, T]} />
        </mesh>
      ))}
      {openings.map((o) => (
        <OpeningTrim key={o.id} o={o} T={T} side={side} mats={mats} clipY={cut ? cutH : Infinity} />
      ))}
    </group>
  );
}

function OpeningTrim({ o, T, side, mats, clipY }: { o: Opening; T: number; side: number; mats: WallMats; clipY: number }) {
  const x0 = o.offsetM;
  const x1 = o.offsetM + o.widthM;
  const y0 = o.bottomM;
  const y1 = Math.min(o.bottomM + o.heightM, clipY);
  if (y1 <= y0 + 0.02) return null;
  const z = (-T / 2) * side;
  const cutTop = y1 < o.bottomM + o.heightM;
  if (o.glazing) {
    // Glazed door/window: slim dark frame, mullions per panel, glass.
    const f = 0.045;
    const n = o.glazing.panels;
    if (o.glazing.frameColor) mats.frame.color.set(o.glazing.frameColor);
    const mat: Material = mats.frame;
    const parts = [
      <mesh key="l" material={mat} position={[x0 + f / 2, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[f, y1 - y0, T * 0.6]} /></mesh>,
      <mesh key="r" material={mat} position={[x1 - f / 2, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[f, y1 - y0, T * 0.6]} /></mesh>,
      <mesh key="b" material={mat} position={[(x0 + x1) / 2, y0 + f / 2, z]} castShadow><boxGeometry args={[x1 - x0, f, T * 0.6]} /></mesh>,
    ];
    if (!cutTop) parts.push(<mesh key="t" material={mat} position={[(x0 + x1) / 2, y1 - f / 2, z]} castShadow><boxGeometry args={[x1 - x0, f, T * 0.6]} /></mesh>);
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      parts.push(<mesh key={`m${i}`} material={mat} position={[x, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[f * 0.8, y1 - y0, T * 0.5]} /></mesh>);
    }
    parts.push(
      <mesh key="g" material={mats.glass} position={[(x0 + x1) / 2, (y0 + y1) / 2, z]} renderOrder={2}>
        <boxGeometry args={[x1 - x0 - 2 * f, y1 - y0 - 2 * f, 0.012]} />
      </mesh>,
    );
    return <group>{parts}</group>;
  }
  const t = 0.05;
  const depth = T + 0.02;
  return (
    <group>
      {o.kind !== 'opening' && (
        <>
          <mesh material={mats.trim} position={[x0 + t / 2, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[t, y1 - y0, depth]} /></mesh>
          <mesh material={mats.trim} position={[x1 - t / 2, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[t, y1 - y0, depth]} /></mesh>
          {!cutTop && <mesh material={mats.trim} position={[(x0 + x1) / 2, y1 - t / 2, z]} castShadow><boxGeometry args={[x1 - x0, t, depth]} /></mesh>}
        </>
      )}
      {o.kind === 'window' && (
        <>
          <mesh material={mats.trim} position={[(x0 + x1) / 2, y0 + t / 2, z + 0.03 * side]} castShadow><boxGeometry args={[x1 - x0 + 0.06, t, depth + 0.06]} /></mesh>
          <mesh material={mats.glass} position={[(x0 + x1) / 2, (y0 + y1) / 2, z]} renderOrder={2}>
            <boxGeometry args={[x1 - x0 - 2 * t, y1 - y0 - 2 * t, 0.01]} />
          </mesh>
          <mesh material={mats.trim} position={[(x0 + x1) / 2, (y0 + y1) / 2, z]} castShadow><boxGeometry args={[0.03, y1 - y0 - 2 * t, 0.04]} /></mesh>
        </>
      )}
    </group>
  );
}

function Floor({ polygon, finish }: { polygon: [number, number][]; finish: string }) {
  const spec = FLOOR_MATERIALS[finish] ?? FLOOR_MATERIALS.oak!;
  const [map, roughnessMap, normalMap] = useTexture([
    `/textures/${spec.folder}/diff.webp`, `/textures/${spec.folder}/rough.webp`, `/textures/${spec.folder}/nor.webp`,
  ]) as [Texture, Texture, Texture];
  useMemo(() => {
    for (const t of [map, roughnessMap, normalMap]) {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.repeat.set(1 / spec.tileM, 1 / spec.tileM);
      t.anisotropy = 8;
      t.needsUpdate = true;
    }
    map.colorSpace = SRGBColorSpace;
  }, [map, roughnessMap, normalMap, spec.tileM]);
  const shape = useMemo(() => {
    // Shape in (x, −z); rotating −90° about X maps it back to (x, 0, z).
    const s = new Shape();
    polygon.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
    s.closePath();
    return s;
  }, [polygon]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow name="floor">
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial map={map} color={spec.tint} roughnessMap={roughnessMap} normalMap={normalMap} roughness={0.85} envMapIntensity={0.9} />
    </mesh>
  );
}

/** Immutable room shell, built procedurally from the shell data plus per-scene appearance. Not selectable. */
export function RoomShellMesh({ shell }: { shell: RoomShell }) {
  const mode = useEditor((s) => s.wallMode);
  const preset = useEditor((s) => s.workingScene?.lightingPreset);
  const appearance: SceneAppearance = useEditor((s) => s.workingScene?.appearance) ?? {};
  const frames = useMemo(() => wallFrames(shell), [shell]);
  const byWall = useMemo(() => {
    const m = new Map<string, Opening[]>();
    for (const o of shell.openings) m.set(o.wallId, [...(m.get(o.wallId) ?? []), o]);
    return m;
  }, [shell]);
  // Extend each wall past its end by the next wall's thickness at convex corners to close the corner.
  const extend = useMemo(() => frames.map((f) => {
    const next = frames.find((g) => Math.hypot(g.from[0] - f.to[0], g.from[1] - f.to[1]) < 1e-6);
    if (!next) return 0;
    return cross2(f.dir, next.dir) < 0 ? Math.max(next.wall.thicknessM, 0.04) : 0;
  }), [frames]);
  const color = appearance.wallColor ?? DEFAULT_WALL_COLOR;
  return (
    <group name="room-shell">
      <Floor polygon={shell.floor.polygonXZ as [number, number][]} finish={appearance.floorMaterial ?? 'oak'} />
      {frames.map((f, i) => (
        <Wall key={f.wall.id} frame={f} openings={byWall.get(f.wall.id) ?? []} extendEnd={extend[i]!} mode={mode} color={color} />
      ))}
      {/* Ground outside the room, toned per lighting preset. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow={presetOf(preset) === 'golden'}>
        <circleGeometry args={[40, 48]} />
        <meshStandardMaterial color={GROUND_COLOR[presetOf(preset)]} roughness={1} />
      </mesh>
    </group>
  );
}
