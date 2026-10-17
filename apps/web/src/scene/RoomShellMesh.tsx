import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomShell } from "@house/contracts";
import { buildWallSegments } from "./wallGeometry";

interface RoomShellMeshProps {
  shell: RoomShell;
}

const SHOWN_OPACITY = 1;
const FADED_OPACITY = 0.06;
const FADE_SPEED = 0.15;

export function RoomShellMesh({ shell }: RoomShellMeshProps) {
  const floorShape = useMemo(() => {
    const shape = new THREE.Shape();
    shell.floor.polygonXZ.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();
    return shape;
  }, [shell.floor.polygonXZ]);

  const segments = useMemo(
    () => shell.walls.flatMap((wall) => buildWallSegments(wall, shell.openings)),
    [shell.walls, shell.openings]
  );

  // Walls between the camera and the room interior would otherwise occlude
  // everything inside (the shell has all 4 real walls, unlike a staged
  // dollhouse render) — fade whichever wall(s) the camera is currently
  // outside of, like the auto-hide-near-wall behavior common to room editors.
  const wallFacts = useMemo(() => {
    const centroid = shell.floor.polygonXZ
      .reduce(([ax, az], [x, z]) => [ax + x / shell.floor.polygonXZ.length, az + z / shell.floor.polygonXZ.length], [0, 0]);
    return shell.walls.map((wall) => {
      const [fx, fz] = wall.fromXZ;
      const [tx, tz] = wall.toXZ;
      const mx = (fx + tx) / 2;
      const mz = (fz + tz) / 2;
      const dx = tx - fx;
      const dz = tz - fz;
      const length = Math.hypot(dx, dz) || 1;
      // perpendicular candidates; pick the one pointing away from the room centroid
      let nx = -dz / length;
      let nz = dx / length;
      const towardCentroid = (centroid[0] - mx) * nx + (centroid[1] - mz) * nz;
      if (towardCentroid > 0) {
        nx = -nx;
        nz = -nz;
      }
      return { id: wall.id, midpoint: [mx, wall.heightM / 2, mz] as [number, number, number], normal: [nx, nz] as [number, number] };
    });
  }, [shell.walls, shell.floor.polygonXZ]);

  const materialRefs = useRef<Map<string, THREE.MeshStandardMaterial[]>>(new Map());
  const registerMaterial = (wallId: string) => (mat: THREE.MeshStandardMaterial | null) => {
    if (!mat) return;
    const list = materialRefs.current.get(wallId) ?? [];
    if (!list.includes(mat)) list.push(mat);
    materialRefs.current.set(wallId, list);
  };

  useFrame(({ camera }) => {
    for (const fact of wallFacts) {
      const toCamera = [camera.position.x - fact.midpoint[0], camera.position.z - fact.midpoint[2]];
      const dot = toCamera[0] * fact.normal[0] + toCamera[1] * fact.normal[1];
      const target = dot > 0 ? FADED_OPACITY : SHOWN_OPACITY;
      const mats = materialRefs.current.get(fact.id);
      if (!mats) continue;
      for (const mat of mats) {
        mat.opacity += (target - mat.opacity) * FADE_SPEED;
      }
    }
  });

  return (
    <group>
      <mesh position={[0, shell.floor.elevationY, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <shapeGeometry args={[floorShape]} />
        <meshStandardMaterial color="#c9a876" roughness={0.75} metalness={0} side={THREE.DoubleSide} />
      </mesh>

      {segments.map((segment, i) => (
        <mesh key={i} position={segment.center} rotation={[0, segment.rotationY, 0]} castShadow receiveShadow>
          <boxGeometry args={segment.size} />
          <meshStandardMaterial
            ref={registerMaterial(segment.wallId)}
            color="#efece4"
            roughness={0.92}
            metalness={0}
            transparent
            opacity={1}
          />
        </mesh>
      ))}
    </group>
  );
}
