import { RoundedBox } from "@react-three/drei";
import type { Vec3 } from "@house/contracts";

interface ObjectVisualProps {
  category: string;
  dimensionsM: Vec3;
}

const FABRIC = "#e9dfd1";
const FABRIC_DARK = "#d8cab5";
const ACCENT = "#c2754a";
const WOOD = "#6b4a32";
const MARBLE = "#ded7cd";
const METAL = "#2b2b2b";
const TERRACOTTA = "#b5652f";
const LEAF = "#3f6b3a";
const JUTE = "#b99b6b";

/**
 * Category -> primitive-composition stand-ins. These render in place of real
 * catalog GLBs (not yet ingested — see FUNCTIONAL_SPEC.md §8) so the sandbox
 * is visually legible without asset pipeline dependencies.
 */
export function ObjectVisual({ category, dimensionsM }: ObjectVisualProps) {
  const [w, h, d] = dimensionsM;

  switch (category) {
    case "sofa":
      return (
        <group>
          <RoundedBox args={[w, h * 0.55, d]} radius={0.06} position={[0, h * 0.275, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={FABRIC} roughness={0.85} />
          </RoundedBox>
          <RoundedBox args={[w * 0.96, h * 0.4, d * 0.28]} radius={0.06} position={[0, h * 0.72, -d * 0.33]} castShadow>
            <meshStandardMaterial color={FABRIC_DARK} roughness={0.85} />
          </RoundedBox>
          <RoundedBox args={[w * 0.22, h * 0.22, d * 0.22]} radius={0.04} position={[w * 0.28, h * 0.5, d * 0.1]} rotation={[0, 0.3, 0]} castShadow>
            <meshStandardMaterial color={ACCENT} roughness={0.9} />
          </RoundedBox>
        </group>
      );

    case "armchair":
      return (
        <group>
          <RoundedBox args={[w, h * 0.85, d]} radius={0.18} position={[0, h * 0.425, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={FABRIC} roughness={0.95} />
          </RoundedBox>
        </group>
      );

    case "coffee_table":
      return (
        <group>
          <mesh position={[0, h * 0.92, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[w / 2, w / 2, h * 0.12, 32]} />
            <meshStandardMaterial color={MARBLE} roughness={0.25} metalness={0.05} />
          </mesh>
          <mesh position={[0, h * 0.46, 0]}>
            <cylinderGeometry args={[w * 0.12, w * 0.16, h * 0.86, 24]} />
            <meshStandardMaterial color={MARBLE} roughness={0.3} metalness={0.05} />
          </mesh>
        </group>
      );

    case "floor_lamp":
      return (
        <group>
          <mesh position={[0, h * 0.46, 0]} castShadow>
            <cylinderGeometry args={[w * 0.04, w * 0.05, h * 0.86, 12]} />
            <meshStandardMaterial color={METAL} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, h * 0.02, 0]}>
            <cylinderGeometry args={[w * 0.32, w * 0.32, h * 0.03, 20]} />
            <meshStandardMaterial color={METAL} roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh position={[0, h * 0.92, 0]} castShadow>
            <coneGeometry args={[w * 0.45, h * 0.22, 24, 1, true]} />
            <meshStandardMaterial
              color="#f3e9d2"
              roughness={0.6}
              emissive="#f2b25c"
              emissiveIntensity={0.35}
              side={2}
            />
          </mesh>
        </group>
      );

    case "bookshelf":
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={WOOD} roughness={0.7} />
          </mesh>
          {[0.28, 0.5, 0.72].map((t, i) => (
            <mesh key={i} position={[0, h * t, 0]}>
              <boxGeometry args={[w * 0.92, h * 0.02, d * 0.92]} />
              <meshStandardMaterial color="#4a3222" roughness={0.6} />
            </mesh>
          ))}
        </group>
      );

    case "credenza":
      return (
        <group>
          <RoundedBox args={[w, h, d]} radius={0.03} position={[0, h / 2, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={WOOD} roughness={0.65} />
          </RoundedBox>
        </group>
      );

    case "plant":
      return (
        <group>
          <mesh position={[0, h * 0.14, 0]} castShadow>
            <cylinderGeometry args={[w * 0.4, w * 0.3, h * 0.28, 16]} />
            <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
          </mesh>
          <mesh position={[0, h * 0.62, 0]} castShadow>
            <icosahedronGeometry args={[w * 0.5, 1]} />
            <meshStandardMaterial color={LEAF} roughness={0.85} flatShading />
          </mesh>
          <mesh position={[w * 0.15, h * 0.85, d * 0.1]} castShadow>
            <icosahedronGeometry args={[w * 0.32, 1]} />
            <meshStandardMaterial color={LEAF} roughness={0.85} flatShading />
          </mesh>
        </group>
      );

    case "rug":
      return (
        <mesh position={[0, h / 2, 0]} receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={JUTE} roughness={1} />
        </mesh>
      );

    default:
      return (
        <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color="#8a8f98" roughness={0.9} wireframe={false} />
        </mesh>
      );
  }
}
