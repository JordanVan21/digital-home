import {
  forwardRef,
  Suspense,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentRef,
} from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useProgress } from "@react-three/drei";
import { Vector3, type WebGLRenderer, type Scene, type Camera } from "three";
import { assetById, type RoomShell, type SceneSpec } from "@house/contracts";
import type { RoomView } from "@house/aesthetic-planner";
import { Model } from "../scene/Model";
import { AssetLight } from "../scene/AssetLight";
import { lightBudget } from "../scene/lightBudget";
import { Room } from "../scene/Room";
import { Lighting } from "../scene/Lighting";
import { labelLayer } from "../scene/labelLayer";

export type CaptureApi = { capture: () => Promise<RoomView[]> };
const frame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function Capture({
  scene: snapshot,
  shell,
  api,
}: {
  scene: SceneSpec;
  shell: RoomShell;
  api: React.Ref<CaptureApi>;
}) {
  const { gl, scene, camera } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const xs = shell.floor.polygonXZ.map((p) => p[0]),
    zs = shell.floor.polygonXZ.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...zs) - Math.min(...zs),
    3,
  );
  useLayoutEffect(() => {
    camera.position.set(cx + span * 1.15, span * 1.2, cz + span * 1.15);
    controls.current?.target.set(cx, 0.5, cz);
    controls.current?.update();
  }, [camera, cx, cz, span, shell.id]);
  useImperativeHandle(
    api,
    () => ({
      async capture() {
        const oldPosition = camera.position.clone(),
          oldQuaternion = camera.quaternion.clone();
        const oldTarget = controls.current?.target.clone();
        if (controls.current) controls.current.enabled = false;
        try {
          const until = Date.now() + 15_000;
          while (useProgress.getState().active && Date.now() < until)
            await frame();
          // Give mounted GLBs and material effects time to commit, including a just-changed candidate.
          for (let n = 0; n < 8; n++) await frame();
          const views: RoomView[] = [];
          for (const name of ["top", "angle-a", "angle-b"] as const) {
            const direction =
              name === "top"
                ? [0, 1.85, 0.001]
                : name === "angle-a"
                  ? [1.1, 1.1, 1.1]
                  : [-1.1, 1.1, -1.1];
            camera.position.set(
              cx + direction[0] * span,
              direction[1] * span,
              cz + direction[2] * span,
            );
            controls.current?.target.set(cx, 0.4, cz);
            controls.current?.update();
            camera.lookAt(cx, 0.4, cz);
            for (let n = 0; n < 4; n++) await frame();
            gl.render(scene, camera);
            views.push(captureView(gl, scene, camera, snapshot, name));
          }
          return views;
        } finally {
          camera.position.copy(oldPosition);
          camera.quaternion.copy(oldQuaternion);
          if (oldTarget) controls.current?.target.copy(oldTarget);
          if (controls.current) controls.current.enabled = true;
          controls.current?.update();
        }
      },
    }),
    [gl, scene, camera, snapshot, cx, cz, span],
  );
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      minDistance={1}
      maxDistance={span * 5}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}

function captureView(
  gl: WebGLRenderer,
  _scene: Scene,
  camera: Camera,
  snapshot: SceneSpec,
  name: RoomView["name"],
): RoomView {
  const image = document.createElement("canvas");
  image.width = 768;
  image.height = 512;
  const ctx = image.getContext("2d")!;
  ctx.drawImage(gl.domElement, 0, 0, image.width, image.height);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 768, 28);
  ctx.fillStyle = "#222";
  ctx.font = "14px sans-serif";
  ctx.fillText(
    `${name} · actual proposal · numbered objects follow scene order`,
    12,
    19,
  );
  const errors = useProgress.getState().errors;
  const unavailableObjectIds: string[] = [];
  snapshot.objects.forEach((object, i) => {
    const asset = object.assetId ? assetById[object.assetId] : null;
    if (
      !asset ||
      errors.includes(asset.glbStorageKey) ||
      useProgress.getState().active
    )
      unavailableObjectIds.push(object.id);
    const p = new Vector3(...object.transform.position);
    p.y += object.dimensionsM[1] + 0.12;
    p.project(camera);
    if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return;
    const x = (p.x + 1) * 384,
      y = (1 - p.y) * 256;
    const label = `${i + 1}${unavailableObjectIds.includes(object.id) ? " placeholder" : ""}`;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x - 4, y - 14, ctx.measureText(label).width + 8, 20);
    ctx.fillStyle = "#202020";
    ctx.fillText(label, x, y);
  });
  return {
    name,
    image: image.toDataURL("image/jpeg", 0.8),
    unavailableObjectIds,
  };
}

export const PlannerViewport = forwardRef<
  CaptureApi,
  { scene: SceneSpec; shell: RoomShell }
>(function PlannerViewport({ scene, shell }, ref) {
  const budget = lightBudget(scene, assetById);
  return (
    <div
      className="planner-viewport"
      ref={(el) => {
        if (el) labelLayer.current = el;
      }}
    >
      <Canvas
        shadows
        camera={{ fov: 39, near: 0.1, far: 150 }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={1}
      >
        <Lighting />
        <Room />
        {scene.objects.map((o) => (
          <group
            key={o.id}
            position={o.transform.position}
            quaternion={o.transform.rotation}
            scale={o.transform.scale}
          >
            <AssetLight
              object={o}
              enabled={budget.active.has(o.id)}
              shadow={budget.shadows.has(o.id)}
            />
            <Suspense fallback={null}>
              <Model
                object={
                  !o.assetId
                    ? { ...o, displayName: `Placeholder: ${o.displayName}` }
                    : o
                }
              />
            </Suspense>
          </group>
        ))}
        <Capture scene={scene} shell={shell} api={ref} />
      </Canvas>
    </div>
  );
});
