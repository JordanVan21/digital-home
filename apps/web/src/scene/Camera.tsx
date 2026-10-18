import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { Box3, PerspectiveCamera, Sphere, Vector3 } from "three";
import { useStore } from "zustand";
import { insidePoint } from "@house/scene-engine";
import { editor, type CameraView } from "../state/editor";
import { cameraPose, roomBounds, selectionBounds } from "./cameraPose";
export function Camera() {
  const controls = useRef<ComponentRef<typeof CameraControls>>(null),
    keys = useRef(new Set<string>()),
    fast = useRef(false);
  const room = useStore(editor.room, (s) => s.room),
    { camera, size, invalidate } = useThree();
  const direction = useRef(new Vector3()),
    target = useRef(new Vector3()),
    projection = useRef(new Vector3());
  const previous = useRef<
    | {
        position: number[];
        target: number[];
        view: CameraView;
        plan: boolean;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    editor.motion.projectPoint = (point) => {
      const p = projection.current.fromArray(point).project(camera);
      return [((p.x + 1) * size.width) / 2, ((1 - p.y) * size.height) / 2];
    };
  }, [camera, size.width, size.height]);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const bounds = roomBounds(room.shell),
      floor = room.shell.floor.elevationY,
      height = room.shell.ceilingHeightM ?? 2.6;
    const boundary = new Box3(
      new Vector3(bounds.minX + 0.08, floor, bounds.minZ + 0.08),
      new Vector3(
        bounds.maxX - 0.08,
        floor + height - 0.05,
        bounds.maxZ - 0.08,
      ),
    );
    const configure = (view: CameraView, walk = false) => {
      if ((view !== "selection" && view !== "room") || c.maxDistance === 0.01) {
        c.minPolarAngle = view === "top" ? 0.001 : 0.15;
        c.maxPolarAngle = walk
          ? Math.PI - 0.08
          : view === "top"
            ? 0.001
            : view === "eye"
              ? Math.PI / 2 + 0.001
              : Math.PI / 2 - 0.08;
      }
      c.minDistance = walk ? 0.01 : 0.35;
      c.maxDistance = walk
        ? 0.01
        : Math.max(
            17,
            (bounds.maxX - bounds.minX + bounds.maxZ - bounds.minZ) * 2,
          );
      c.dollyToCursor = !walk;
      c.boundaryEnclosesCamera = false;
      c.setBoundary(view === "selection" ? undefined : boundary);
      if (camera instanceof PerspectiveCamera) {
        camera.fov = walk ? 60 : view === "eye" ? 50 : 39;
        camera.near = 0.05;
        camera.updateProjectionMatrix();
      }
    };
    const look = (
      position: readonly number[],
      target: readonly number[],
      smooth: boolean,
    ) => {
      void c.setLookAt(
        position[0],
        position[1],
        position[2],
        target[0],
        target[1],
        target[2],
        smooth,
      );
      invalidate();
    };
    const apply = (view: CameraView, smooth = true) => {
      configure(view);
      if (view === "selection") {
        const id = editor.interaction.getState().selectedId,
          box = id ? selectionBounds(editor.working(), [id]) : undefined;
        if (box) {
          const sphere = new Box3(
            new Vector3(...box.min),
            new Vector3(...box.max),
          ).getBoundingSphere(new Sphere());
          sphere.radius += 0.15;
          void c.fitToSphere(sphere, smooth);
        }
      } else if (view === "room") {
        const sphere = new Box3(
          new Vector3(bounds.minX, floor, bounds.minZ),
          new Vector3(bounds.maxX, floor + height, bounds.maxZ),
        ).getBoundingSphere(new Sphere());
        sphere.radius += 0.3;
        void c.fitToSphere(sphere, smooth);
      } else if (view === "photo" && room.photoCamera) {
        if (camera instanceof PerspectiveCamera) {
          camera.fov = room.photoCamera.fov;
          camera.updateProjectionMatrix();
        }
        look(room.photoCamera.position, room.photoCamera.target, smooth);
      } else {
        const pose = cameraPose(
          room.shell,
          view === "top" || view === "eye" ? view : "iso",
        );
        look(pose.position, pose.target, smooth);
      }
      invalidate();
    };
    const rest = () => {
      c.boundaryEnclosesCamera = editor.interaction.getState().walk;
    };
    c.addEventListener("rest", rest);
    apply("iso", false);
    const unsubscribe = editor.interaction.subscribe((s, prev) => {
      c.enabled = !s.dragging;
      if (s.dragging) {
        c.stop();
        keys.current.clear();
      }
      const requested =
        s.cameraRequest !== prev.cameraRequest ||
        s.resetView !== prev.resetView;
      if (s.walk !== prev.walk) {
        keys.current.clear();
        if (s.walk) {
          previous.current = {
            position: camera.position.toArray(),
            target: c.getTarget(new Vector3()).toArray(),
            view: prev.cameraView,
            plan: prev.planView,
          };
          configure("eye", true);
          const pose = cameraPose(room.shell, "eye");
          look(
            pose.position,
            [pose.position[0], pose.position[1], pose.position[2] - 0.01],
            true,
          );
        } else if (!requested && previous.current) {
          configure(previous.current.view);
          look(previous.current.position, previous.current.target, true);
          editor.interaction.setState({ planView: previous.current.plan });
        }
      }
      if (requested)
        apply(s.resetView !== prev.resetView ? "iso" : s.cameraView);
    });
    const down = (e: KeyboardEvent) => {
      const state = editor.interaction.getState();
      if (
        !state.walk ||
        state.dragging ||
        state.browser ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (e.target as HTMLElement)?.closest?.(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      fast.current = e.shiftKey;
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        e.preventDefault();
        keys.current.add(key);
        invalidate();
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.key.toLowerCase());
      fast.current = e.shiftKey;
    };
    const blur = () => {
      keys.current.clear();
      fast.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      unsubscribe();
      c.removeEventListener("rest", rest);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      keys.current.clear();
    };
  }, [room, camera, invalidate]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    camera.getWorldDirection(direction.current);
    camera.position.toArray(editor.motion.cameraPosition);
    direction.current.toArray(editor.motion.cameraDirection);
    c.getTarget(target.current).toArray(editor.motion.cameraTarget);
    const s = editor.interaction.getState();
    if (!s.walk || s.dragging || s.browser || !keys.current.size) return;
    const forward =
        Number(keys.current.has("w")) - Number(keys.current.has("s")),
      side = Number(keys.current.has("d")) - Number(keys.current.has("a")),
      amount =
        (Math.min(dt, 0.05) * (fast.current ? 3 : 1.5)) /
        Math.max(1, Math.hypot(forward, side));
    const dir = direction.current;
    const length = Math.hypot(dir.x, dir.z) || 1,
      fx = dir.x / length,
      fz = dir.z / length;
    const next: [number, number] = [
      camera.position.x + (fx * forward - fz * side) * amount,
      camera.position.z + (fz * forward + fx * side) * amount,
    ];
    if (insidePoint(next, room.shell.floor.polygonXZ)) {
      if (forward) void c.forward(forward * amount, false);
      if (side) void c.truck(side * amount, 0, false);
    }
    invalidate();
  });
  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.18}
      draggingSmoothTime={0.12}
      dollySpeed={0.8}
    />
  );
}
