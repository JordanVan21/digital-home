import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { roomShell, type Wall } from "@house/contracts";
import { insidePoint } from "@house/scene-engine";
import {
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Shape,
  ShapeGeometry,
} from "three";
import { oakTexture } from "./Materials";
const WALL = "#e9e1d2";
function Block({
  x,
  y,
  w,
  h,
  depth = 0.12,
  color = WALL,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  depth?: number;
  color?: string;
}) {
  if (w < 0.001 || h < 0.001) return null;
  return (
    <mesh position={[x, y, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, depth]} />
      <meshStandardMaterial color={color} roughness={0.92} />
    </mesh>
  );
}
function RoomWall({ wall }: { wall: Wall }) {
  const full = useRef<Group>(null),
    low = useRef<Group>(null);
  const dx = wall.toXZ[0] - wall.fromXZ[0],
    dz = wall.toXZ[1] - wall.fromXZ[1],
    len = Math.hypot(dx, dz);
  const center = [
    (wall.fromXZ[0] + wall.toXZ[0]) / 2,
    (wall.fromXZ[1] + wall.toXZ[1]) / 2,
  ];
  const sign = insidePoint(
    [center[0] - (dz / len) * 0.03, center[1] + (dx / len) * 0.03],
    roomShell.floor.polygonXZ,
  )
    ? 1
    : -1;
  const outward = [(dz / len) * sign, (-dx / len) * sign];
  const openings = roomShell.openings
    .filter((o) => o.wallId === wall.id)
    .sort((a, b) => a.offsetM - b.offsetM);
  const spans: { x: number; w: number }[] = [];
  let cursor = 0;
  for (const o of openings) {
    spans.push({
      x: (cursor + o.offsetM) / 2 - len / 2,
      w: o.offsetM - cursor,
    });
    cursor = o.offsetM + o.widthM;
  }
  spans.push({ x: (cursor + len) / 2 - len / 2, w: len - cursor });
  useFrame(({ camera }) => {
    const facing =
      outward[0] * (camera.position.x - center[0]) +
        outward[1] * (camera.position.z - center[1]) >
      0.08;
    if (full.current) full.current.visible = !facing;
    if (low.current) low.current.visible = facing;
  });
  return (
    <group
      position={[center[0], roomShell.floor.elevationY, center[1]]}
      rotation={[0, -Math.atan2(dz, dx), 0]}
    >
      <group ref={full}>
        {spans.map((s, i) => (
          <Block
            key={i}
            {...s}
            y={wall.heightM / 2}
            h={wall.heightM}
            depth={wall.thicknessM}
          />
        ))}
        {openings.map((o) => {
          const x = o.offsetM + o.widthM / 2 - len / 2,
            top = o.bottomM + o.heightM;
          return (
            <group key={o.id}>
              <Block
                x={x}
                y={o.bottomM / 2}
                w={o.widthM}
                h={o.bottomM}
                depth={wall.thicknessM}
              />
              <Block
                x={x}
                y={(wall.heightM + top) / 2}
                w={o.widthM}
                h={wall.heightM - top}
                depth={wall.thicknessM}
              />
              <Block
                x={x - o.widthM / 2 + 0.022}
                y={o.bottomM + o.heightM / 2}
                w={0.045}
                h={o.heightM}
                depth={0.14}
                color="#655c4b"
              />
              <Block
                x={x + o.widthM / 2 - 0.022}
                y={o.bottomM + o.heightM / 2}
                w={0.045}
                h={o.heightM}
                depth={0.14}
                color="#655c4b"
              />
              <Block
                x={x}
                y={top - 0.022}
                w={o.widthM}
                h={0.045}
                depth={0.14}
                color="#655c4b"
              />
              {o.kind === "window" ? (
                <>
                  <Block
                    x={x}
                    y={o.bottomM + 0.02}
                    w={o.widthM + 0.06}
                    h={0.04}
                    depth={0.2}
                    color="#d7c4a2"
                  />
                  {[
                    ...(o.widthM > 2 ? [-o.widthM / 6, o.widthM / 6] : [0]),
                  ].map((offset, i) => (
                    <Block
                      key={i}
                      x={x + offset}
                      y={o.bottomM + o.heightM / 2}
                      w={0.028}
                      h={o.heightM}
                      depth={0.06}
                      color="#655c4b"
                    />
                  ))}
                  <mesh position={[x, o.bottomM + o.heightM / 2, 0]}>
                    <planeGeometry args={[o.widthM, o.heightM]} />
                    <meshStandardMaterial
                      color="#e0e9dd"
                      transparent
                      opacity={0.13}
                      side={DoubleSide}
                      roughness={0.1}
                      depthWrite={false}
                    />
                  </mesh>
                </>
              ) : (
                <group
                  position={[x - o.widthM / 2 + 0.04, 0, 0]}
                  rotation={[0, -sign * 1.06, 0]}
                >
                  <mesh position={[o.widthM / 2, o.heightM / 2, 0]} castShadow>
                    <boxGeometry
                      args={[o.widthM - 0.09, o.heightM - 0.03, 0.045]}
                    />
                    <meshStandardMaterial color="#c2a57d" roughness={0.8} />
                  </mesh>
                  <mesh position={[o.widthM - 0.14, 1, 0.04]}>
                    <sphereGeometry args={[0.035, 12, 8]} />
                    <meshStandardMaterial
                      color="#6b6252"
                      metalness={0.65}
                      roughness={0.3}
                    />
                  </mesh>
                </group>
              )}
            </group>
          );
        })}
        {/* Warm-white skirting grounds the wall. */}
        {spans.map((s, i) => (
          <Block
            key={`skirt-${i}`}
            {...s}
            y={0.045}
            h={0.09}
            depth={wall.thicknessM + 0.02}
            color="#f2ebdf"
          />
        ))}
      </group>
      <group ref={low} visible={false}>
        {spans.map((s, i) => (
          <Block key={i} {...s} y={0.085} h={0.17} depth={wall.thicknessM} />
        ))}
      </group>
    </group>
  );
}
export function Room() {
  const { floor, slab } = useMemo(() => {
    const shape = new Shape();
    roomShell.floor.polygonXZ.forEach(([x, z], i) =>
      i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z),
    );
    shape.closePath();
    return {
      floor: new ShapeGeometry(shape),
      slab: new ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }),
    };
  }, []);
  return (
    <group>
      <mesh
        geometry={slab}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.16, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#b9aa91" roughness={1} />
      </mesh>
      <mesh
        geometry={floor}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.002, 0]}
        receiveShadow
      >
        <meshStandardMaterial map={oakTexture()} roughness={0.77} />
      </mesh>
      {roomShell.walls.map((w) => (
        <RoomWall key={w.id} wall={w} />
      ))}
    </group>
  );
}
