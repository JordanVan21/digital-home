import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { useStore } from "zustand";
import type { Opening, RoomShell, Wall } from "@house/contracts";
import {
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Texture,
} from "three";
import { editor } from "../state/editor";
import { oakTexture } from "./Materials";
import {
  CUTAWAY_HEIGHT_M,
  wallFrame,
  wallPanels,
  wallVisibility,
} from "./wallGeometry";
export const FLOOR_FINISHES = {
  oak: { label: "Light oak", tileM: 1.7, tint: "#ffffff" },
  honey: { label: "Honey oak", tileM: 2.4, tint: "#ffcf95" },
  walnut: { label: "Walnut", tileM: 1.7, tint: "#9b7656" },
};
const DEFAULT_WALL = "#ece6dc";
function Block({
  x,
  y,
  w,
  h,
  depth,
  color,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  color: string;
}) {
  if (w <= 0.001 || h <= 0.001) return null;
  return (
    <mesh position={[x, y, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, depth]} />
      <meshStandardMaterial color={color} roughness={0.92} transparent />
    </mesh>
  );
}
function OpeningTrim({
  opening: o,
  length,
  thickness,
  trim,
}: {
  opening: Opening;
  length: number;
  thickness: number;
  trim: string;
}) {
  if (o.kind === "opening") return null;
  const x = o.offsetM + o.widthM / 2 - length / 2,
    mid = o.bottomM + o.heightM / 2;
  const glazed = !!o.glazing || o.kind === "window",
    color = o.glazing?.frameColor ?? (glazed ? "#292724" : trim),
    frame = 0.045;
  const panels = o.glazing?.panels ?? (o.widthM > 2 ? 3 : 2);
  return (
    <group name={`opening-${o.id}`}>
      {[-1, 1].map((sign) => (
        <Block
          key={sign}
          x={x + (sign * (o.widthM - frame)) / 2}
          y={mid}
          w={frame}
          h={o.heightM}
          depth={thickness * 0.7}
          color={color}
        />
      ))}
      <Block
        x={x}
        y={o.bottomM + o.heightM - frame / 2}
        w={o.widthM}
        h={frame}
        depth={thickness * 0.7}
        color={color}
      />
      {glazed && (
        <>
          <Block
            x={x}
            y={o.bottomM + frame / 2}
            w={o.widthM}
            h={frame}
            depth={thickness * 0.7}
            color={color}
          />
          {Array.from({ length: panels - 1 }, (_, i) => (
            <Block
              key={i}
              x={x - o.widthM / 2 + (o.widthM * (i + 1)) / panels}
              y={mid}
              w={frame * 0.8}
              h={o.heightM}
              depth={thickness * 0.5}
              color={color}
            />
          ))}
          <mesh name="opening-glass" position={[x, mid, 0]} renderOrder={2}>
            <planeGeometry
              args={[
                Math.max(0.01, o.widthM - 2 * frame),
                Math.max(0.01, o.heightM - 2 * frame),
              ]}
            />
            <meshPhysicalMaterial
              color="#d7e8f0"
              roughness={0.04}
              transparent
              opacity={0.16}
              depthWrite={false}
              side={DoubleSide}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
function RoomWall({
  wall,
  shell,
  color,
  trim,
}: {
  wall: Wall;
  shell: RoomShell;
  color: string;
  trim: string;
}) {
  const full = useRef<Group>(null),
    low = useRef<Group>(null),
    opacity = useRef(1);
  const mode = useStore(editor.interaction, (s) => s.wallMode),
    frame = useMemo(() => wallFrame(shell, wall), [shell, wall]);
  const openings = useMemo(
    () => shell.openings.filter((o) => o.wallId === wall.id),
    [shell, wall.id],
  );
  const panels = useMemo(
    () => wallPanels(frame.length, wall.heightM, openings),
    [frame.length, wall.heightM, openings],
  );
  const shortPanels = useMemo(
    () =>
      wallPanels(
        frame.length,
        Math.min(CUTAWAY_HEIGHT_M, wall.heightM),
        openings,
      ),
    [frame.length, wall.heightM, openings],
  );
  useEffect(
    () => () => {
      editor.motion.wallVisibility.delete(wall.id);
    },
    [wall.id],
  );
  useFrame(({ camera, invalidate }, dt) => {
    const facing =
      frame.outward[0] * (camera.position.x - frame.center[0]) +
        frame.outward[1] * (camera.position.z - frame.center[1]) >
      0.08;
    const target = wallVisibility(mode, facing);
    editor.motion.wallVisibility.set(wall.id, target);
    if (full.current) full.current.visible = target > 0;
    if (low.current) low.current.visible = target === 0;
    const desired = target === 0 ? 1 : target,
      k = 1 - Math.exp(-Math.min(dt, 0.1) * 12);
    opacity.current += (desired - opacity.current) * k;
    if (Math.abs(opacity.current - desired) < 0.002) opacity.current = desired;
    if (full.current)
      full.current.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const materials = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of materials) {
          if (m.userData.baseOpacity === undefined)
            m.userData.baseOpacity = m.opacity;
          m.opacity = m.userData.baseOpacity * opacity.current;
          m.depthWrite = m.userData.baseOpacity >= 1 && opacity.current > 0.98;
        }
      });
    if (opacity.current !== desired) invalidate();
  });
  const draw = (p: (typeof panels)[number], i: number) => (
    <Block
      key={i}
      x={(p.s0 + p.s1) / 2 - frame.length / 2}
      y={(p.y0 + p.y1) / 2}
      w={p.s1 - p.s0}
      h={p.y1 - p.y0}
      depth={wall.thicknessM}
      color={color}
    />
  );
  return (
    <group
      name={`wall-${wall.id}`}
      position={[frame.center[0], shell.floor.elevationY, frame.center[1]]}
      rotation={[0, frame.yaw, 0]}
    >
      <group ref={full}>
        {panels.map(draw)}
        {openings.map((o) => (
          <OpeningTrim
            key={o.id}
            opening={o}
            length={frame.length}
            thickness={wall.thicknessM}
            trim={trim}
          />
        ))}
        {panels
          .filter((p) => p.y0 === 0)
          .map((p, i) => (
            <Block
              key={`trim-${i}`}
              x={(p.s0 + p.s1) / 2 - frame.length / 2}
              y={0.045}
              w={p.s1 - p.s0}
              h={Math.min(0.09, p.y1)}
              depth={wall.thicknessM + 0.02}
              color={trim}
            />
          ))}
      </group>
      <group ref={low} visible={false}>
        {shortPanels.map(draw)}
      </group>
    </group>
  );
}
function TexturedFloor({
  geometry,
  y,
  finish,
}: {
  geometry: ShapeGeometry;
  y: number;
  finish: string;
}) {
  const spec =
    FLOOR_FINISHES[finish as keyof typeof FLOOR_FINISHES] ?? FLOOR_FINISHES.oak;
  const source = useTexture([
    "/textures/floor-oak/diff.webp",
    "/textures/floor-oak/rough.webp",
    "/textures/floor-oak/nor.webp",
  ]) as Texture[];
  const maps = useMemo(
    () =>
      source.map((t, i) => {
        const clone = t.clone();
        clone.wrapS = clone.wrapT = RepeatWrapping;
        clone.repeat.set(1 / spec.tileM, 1 / spec.tileM);
        clone.anisotropy = 8;
        if (i === 0) clone.colorSpace = SRGBColorSpace;
        clone.needsUpdate = true;
        return clone;
      }),
    [source[0], source[1], source[2], spec.tileM],
  );
  useEffect(() => () => maps.forEach((t) => t.dispose()), [maps]);
  return (
    <mesh
      name="room-floor"
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, y + 0.002, 0]}
      receiveShadow
    >
      <meshStandardMaterial
        map={maps[0]}
        roughnessMap={maps[1]}
        normalMap={maps[2]}
        color={spec.tint}
        roughness={0.85}
        envMapIntensity={0.9}
      />
    </mesh>
  );
}
export function Room() {
  const shell = useStore(editor.room, (s) => s.room.shell),
    draft = useStore(editor.draft, (s) => s.scene),
    accepted = useStore(editor.scene, (s) => s.scene),
    appearance = (draft ?? accepted).appearance;
  const { floor, slab } = useMemo(() => {
    const shape = new Shape();
    shell.floor.polygonXZ.forEach(([x, z], i) =>
      i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z),
    );
    shape.closePath();
    return {
      floor: new ShapeGeometry(shape),
      slab: new ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }),
    };
  }, [shell]);
  useEffect(
    () => () => {
      floor.dispose();
      slab.dispose();
    },
    [floor, slab],
  );
  const fallback = (
    <mesh
      geometry={floor}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, shell.floor.elevationY + 0.002, 0]}
      receiveShadow
    >
      <meshStandardMaterial map={oakTexture()} roughness={0.8} />
    </mesh>
  );
  return (
    <group name="room-shell">
      <mesh
        geometry={slab}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, shell.floor.elevationY - 0.16, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#b9aa91" roughness={1} />
      </mesh>
      <Suspense fallback={fallback}>
        <TexturedFloor
          geometry={floor}
          y={shell.floor.elevationY}
          finish={appearance?.floorMaterial ?? "oak"}
        />
      </Suspense>
      {shell.walls.map((w) => (
        <RoomWall
          key={w.id}
          wall={w}
          shell={shell}
          color={appearance?.wallColor ?? DEFAULT_WALL}
          trim={appearance?.trimColor ?? "#f7f3ec"}
        />
      ))}
    </group>
  );
}
