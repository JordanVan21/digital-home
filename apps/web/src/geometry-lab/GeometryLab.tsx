import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { Box3, InstancedMesh, Matrix4, Mesh, Sphere, Vector3 } from "three";
import { catalog, type AssetSpec } from "@house/contracts";
import {
  bakeGeometry,
  benchmarkProfile,
  buildProfile,
  probeContacts,
  rayContacts,
  type Profile,
} from "./queries";
import "./lab.css";
const files = [
  "coffee-table",
  "desk-chair",
  "sofa",
  "olive-tree",
  "polyhaven-ceramic-vase",
];
const assets = files.map(
  (file) => catalog.find((a) => a.glbStorageKey === `/models/${file}.glb`)!,
);
type Overlay = "box" | "compound" | "surface" | "none";
type Loaded = { profile: Profile; alphaMaterials: number };
function Compound({ boxes }: { boxes: Box3[] }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const matrix = new Matrix4(),
      size = new Vector3(),
      center = new Vector3();
    boxes.forEach((box, i) => {
      box.getSize(size);
      box.getCenter(center);
      matrix.makeScale(size.x, size.y, size.z);
      matrix.setPosition(center);
      ref.current?.setMatrixAt(i, matrix);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [boxes]);
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, boxes.length]}
      raycast={() => null}
    >
      <boxGeometry />
      <meshBasicMaterial
        color="#58b5ff"
        wireframe
        transparent
        opacity={0.32}
        depthTest={false}
      />
    </instancedMesh>
  );
}
function ModelScene({
  asset,
  overlay,
  probe,
  radius,
  fromY,
  onReady,
  onProbe,
}: {
  asset: AssetSpec;
  overlay: Overlay;
  probe: number[];
  radius: number;
  fromY: number;
  onReady: (value: Loaded) => void;
  onProbe: (value: number[]) => void;
}) {
  const gltf = useGLTF(asset.glbStorageKey, false, true);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  const profile = useMemo(() => buildProfile(bakeGeometry(model)), [model]);
  useEffect(() => {
    const masked = new Set();
    model.traverse((node) => {
      if (node instanceof Mesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          if (material.alphaTest > 0 || material.transparent)
            masked.add(material);
    });
    onReady({ profile, alphaMaterials: masked.size });
    return () => profile.geometry.dispose();
  }, [model, profile, onReady]);
  const sphere = new Sphere(new Vector3(...probe), radius),
    contact = probeContacts(profile, sphere),
    hits = rayContacts(profile, probe[0], probe[2], fromY);
  const size = profile.bounds.getSize(new Vector3()),
    center = profile.bounds.getCenter(new Vector3());
  const line = useMemo(
    () =>
      new Float32Array([probe[0], fromY, probe[2], probe[0], -0.1, probe[2]]),
    [probe, fromY],
  );
  return (
    <group dispose={null}>
      <primitive
        object={model}
        onClick={(e: { stopPropagation(): void; point: Vector3 }) => {
          e.stopPropagation();
          onProbe(e.point.toArray());
        }}
      />
      {overlay === "box" && (
        <mesh position={center} raycast={() => null}>
          <boxGeometry args={size.toArray()} />
          <meshBasicMaterial color="#f2b36d" wireframe depthTest={false} />
        </mesh>
      )}
      {overlay === "compound" && <Compound boxes={profile.boxes} />}
      {overlay === "surface" && (
        <mesh geometry={profile.geometry} raycast={() => null}>
          <meshBasicMaterial
            color="#bd9aff"
            wireframe
            transparent
            opacity={0.22}
            depthTest={false}
          />
        </mesh>
      )}
      <mesh position={probe as [number, number, number]} raycast={() => null}>
        <sphereGeometry args={[radius, 20, 12]} />
        <meshStandardMaterial
          color={contact.surface ? "#ff887e" : "#5cddbb"}
          transparent
          opacity={0.85}
        />
      </mesh>
      <lineSegments raycast={() => null}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[line, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color="#c7b6ff" transparent opacity={0.7} />
      </lineSegments>
      {hits.surface !== null && (
        <mesh
          position={[probe[0], hits.surface, probe[2]]}
          raycast={() => null}
        >
          <sphereGeometry args={[0.018, 12, 8]} />
          <meshBasicMaterial color="#c2a0ff" depthTest={false} />
        </mesh>
      )}
      {hits.box !== null && (
        <mesh position={[probe[0], hits.box, probe[2]]} raycast={() => null}>
          <sphereGeometry args={[0.012, 12, 8]} />
          <meshBasicMaterial color="#f2b36d" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
class LabBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div role="alert" className="lab-error">
        Geometry experiment failed: {this.state.error}.{" "}
        <a href="/">Return to editor</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="lab-slider">
      <span>
        {label}
        <output>{value.toFixed(3)} m</output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={0.005}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export default function GeometryLab() {
  const [asset, setAsset] = useState(assets[0]),
    [overlay, setOverlay] = useState<Overlay>("compound"),
    [loaded, setLoaded] = useState<Loaded | null>(null);
  const [probe, setProbe] = useState<number[]>([0, 0.15, 0.15]),
    [radius, setRadius] = useState(0.025),
    [fromY, setFromY] = useState(1.2);
  const [bench, setBench] = useState<ReturnType<
      typeof benchmarkProfile
    > | null>(null),
    [running, setRunning] = useState(false);
  const ready = useCallback((value: Loaded) => setLoaded(value), []);
  const profile = loaded?.profile;
  const contacts = profile
    ? probeContacts(profile, new Sphere(new Vector3(...probe), radius))
    : null;
  const hits = profile ? rayContacts(profile, probe[0], probe[2], fromY) : null;
  const choose = (value: string) => {
    const next = assets.find((a) => a.id === value)!;
    if (next.id === asset.id) return;
    setLoaded(null);
    setBench(null);
    setAsset(next);
    setProbe([0, next.dimensionsM[1] * 0.3, next.dimensionsM[2] * 0.15]);
    setFromY(next.dimensionsM[1] + 0.3);
  };
  const position = (axis: number, value: number) =>
    setProbe((p) => p.map((v, i) => (i === axis ? value : v)));
  const run = () => {
    if (!profile) return;
    setRunning(true);
    setTimeout(() => {
      try {
        setBench(benchmarkProfile(profile));
      } finally {
        setRunning(false);
      }
    }, 50);
  };
  return (
    <main className="geometry-lab">
      <aside className="lab-panel">
        <a href="/">← Back to House editor</a>
        <p className="lab-eyebrow">ISOLATED EXPERIMENT</p>
        <h1>Shape inspection lab</h1>
        <p>
          Compare the enclosing box, a 4 cm compound-box approximation, and
          actual triangle-surface queries. This view never saves or changes your
          room.
        </p>
        <label className="lab-select">
          Model
          <select
            aria-label="Lab model"
            disabled={running}
            value={asset.id}
            onChange={(e) => choose(e.target.value)}
          >
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <label className="lab-select">
          Overlay
          <select
            aria-label="Geometry overlay"
            value={overlay}
            onChange={(e) => setOverlay(e.target.value as Overlay)}
          >
            <option value="box">Original box</option>
            <option value="compound">Compound boxes</option>
            <option value="surface">Model triangle wireframe</option>
            <option value="none">Model only</option>
          </select>
        </label>
        <p role="status" aria-label="Geometry build status">
          {profile
            ? `${asset.title}: ${profile.triangles.toLocaleString()} triangles · ${profile.boxes.length} compound boxes`
            : "Loading model and building geometry…"}
        </p>
        {profile && (
          <p className="lab-muted">
            Build {profile.buildMs.toFixed(1)} ms (one-time). BVH{" "}
            {profile.bvhMs.toFixed(1)} ms; compound{" "}
            {profile.compoundMs.toFixed(1)} ms.{" "}
            {profile.interiorCells.toLocaleString()} enclosed grid cells.
          </p>
        )}
        {!!loaded?.alphaMaterials && (
          <p className="lab-notice">
            Alpha-masked/transparent material: triangle queries include
            invisible parts of textured leaf cards.
          </p>
        )}
        <h2>Contact probe</h2>
        <p className="lab-muted">
          Click a visible surface or move this sphere. A green sphere means no
          triangle contact; it can still be inside a closed solid.
        </p>
        {(["X", "Y", "Z"] as const).map((axis, i) => (
          <Slider
            key={axis}
            label={`Probe ${axis}`}
            value={probe[i]}
            min={i === 1 ? -0.1 : -asset.dimensionsM[i] / 2 - 0.2}
            max={
              i === 1
                ? asset.dimensionsM[1] + 0.3
                : asset.dimensionsM[i] / 2 + 0.2
            }
            onChange={(v) => position(i, v)}
          />
        ))}
        <Slider
          label="Probe radius"
          value={radius}
          min={0.005}
          max={0.15}
          onChange={setRadius}
        />
        <div className="lab-results">
          {contacts &&
            (["box", "compound", "surface"] as const).map((key) => (
              <div key={key}>
                <span>
                  {key === "surface"
                    ? "Mesh surface"
                    : `${key === "box" ? "Box" : "Compound"} volume`}
                </span>
                <strong data-testid={`probe-${key}`}>
                  {contacts[key] ? "Contact" : "Clear"}
                </strong>
              </div>
            ))}
        </div>
        <h2>Top-down surface ray</h2>
        <Slider
          label="Ray start height"
          value={fromY}
          min={0}
          max={asset.dimensionsM[1] + 0.5}
          onChange={setFromY}
        />
        <div className="lab-results">
          {hits &&
            (["box", "compound", "surface"] as const).map((key) => (
              <div key={key}>
                <span>
                  {key === "surface"
                    ? "Mesh surface"
                    : key === "box"
                      ? "Box"
                      : "Compound"}
                </span>
                <strong data-testid={`ray-${key}`}>
                  {hits[key] === null ? "No hit" : `${hits[key]!.toFixed(3)} m`}
                </strong>
              </div>
            ))}
        </div>
        <p className="lab-notice">
          Surface hit ≠ stable support. Open meshes, interior containment, alpha
          masks, voxel-filled openings and physical stability still need
          validation before editor integration.
        </p>
        <button
          className="lab-button"
          disabled={!profile || running}
          onClick={run}
        >
          {running ? "Benchmarking…" : "Run query benchmark"}
        </button>
        {bench && (
          <>
            <p className="lab-muted">
              300 identical 2.5 cm probes. Query p95 only; this is not an FPS
              test.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Method</th>
                  <th>p95 (ms)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(bench.methods).map(([key, value]) => (
                  <tr key={key}>
                    <td>{key}</td>
                    <td>{value.p95Ms.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="lab-muted">
              Mesh-pair surface intersections:{" "}
              {bench.meshPairSurfaceIntersections
                .map((p) => `${p.ms.toFixed(2)} ms`)
                .join(" / ")}
              . Containment is not covered.
            </p>
          </>
        )}
      </aside>
      <section className="lab-viewport" aria-label="Geometry experiment viewer">
        <LabBoundary key={asset.id}>
          <Canvas
            key={asset.id}
            camera={{ position: [2.8, 2.1, 3.3], fov: 42, near: 0.01, far: 40 }}
            dpr={[1, 1.5]}
          >
            <color attach="background" args={["#e6e8ec"]} />
            <ambientLight intensity={1.8} />
            <directionalLight position={[3, 5, 4]} intensity={3} />
            <Suspense fallback={null}>
              <ModelScene
                asset={asset}
                overlay={overlay}
                probe={probe}
                radius={radius}
                fromY={fromY}
                onReady={ready}
                onProbe={setProbe}
              />
            </Suspense>
            <Grid
              args={[8, 8]}
              position={[0, -0.01, 0]}
              cellSize={0.2}
              sectionSize={1}
              fadeDistance={12}
            />
            <OrbitControls
              makeDefault
              target={[0, asset.dimensionsM[1] * 0.45, 0]}
              minDistance={0.3}
              maxDistance={12}
            />
          </Canvas>
        </LabBoundary>
        <div className="lab-legend">
          Amber: enclosing box · Blue: compound boxes · Purple: mesh surface
        </div>
      </section>
    </main>
  );
}
