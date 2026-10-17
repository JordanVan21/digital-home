import { memo, useEffect, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { LockKeyhole } from "lucide-react";
import { useStore } from "zustand";
import {
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Vector3,
} from "three";
import type { SceneObject } from "@house/contracts";
import { DragSession, editor } from "../state/editor";
import { Model } from "./Model";
import { Selection } from "./Selection";
import { labelLayer } from "./labelLayer";
import { useLighting } from "../theme";
import { ObjectToolbar } from "../components/ObjectToolbar";
const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
export const Furniture = memo(function Furniture({
  object,
}: {
  object: SceneObject;
}) {
  const selected = useStore(
    editor.interaction,
    (s) => s.selectedId === object.id,
  );
  const { lamps } = useLighting();
  const hovered = useStore(
    editor.interaction,
    (s) => s.hoveredId === object.id,
  );
  const group = useRef<Group>(null),
    outline = useRef<Group>(null);
  const drag = useRef({
    session: new DragSession(editor),
    active: false,
    offset: new Vector3(),
    point: new Vector3(),
    lastValidation: 0,
    valid: true,
    startX: 0,
    startY: 0,
    moved: false,
    transform: structuredClone(object.transform),
  });
  const returning = useRef(false);
  const latest = useRef(object);
  latest.current = object;
  useEffect(() => {
    const cancel = () => {
      if (drag.current.active) {
        drag.current.session.cancel();
        drag.current.active = false;
        returning.current = true;
      }
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      if (drag.current.active) drag.current.session.cancel();
    };
  }, []);
  useFrame((_, delta) => {
    const state = drag.current;
    if (state.active && !editor.interaction.getState().dragging) {
      state.active = false;
      state.session.cancel();
      returning.current = true;
    }
    if (returning.current && group.current) {
      const target = new Vector3(...latest.current.transform.position);
      group.current.position.lerp(target, 1 - Math.exp(-delta * 20));
      if (group.current.position.distanceToSquared(target) < 0.000001) {
        group.current.position.copy(target);
        returning.current = false;
      }
    }
    if (outline.current && (selected || hovered || state.active))
      outline.current.traverse((o) => {
        const color =
          state.active && !state.valid
            ? "#e36856"
            : selected
              ? "#9187ff"
              : "#ffffff";
        if (o instanceof LineSegments)
          (o.material as LineBasicMaterial).color.set(color);
        if (o instanceof Mesh)
          (o.material as MeshBasicMaterial).color.set(
            state.active && !state.valid ? "#ff9988" : "#c7c1ff",
          );
      });
  });
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || !editor.scene.getState().ready) return;
    e.stopPropagation();
    editor.select(object.id);
    if (editor.interaction.getState().tool === "rotate") {
      editor.rotate();
      return;
    }
    const state = drag.current;
    if (!state.session.begin(object.id)) return;
    returning.current = false;
    state.active = true;
    state.valid = true;
    state.moved = false;
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.transform = structuredClone(object.transform);
    floorPlane.constant = -object.transform.position[1];
    if (e.ray.intersectPlane(floorPlane, state.point))
      state.offset
        .copy(state.point)
        .sub(new Vector3(...object.transform.position));
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (!state.active) return;
    e.stopPropagation();
    if (
      Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < 3 &&
      !state.moved
    )
      return;
    if (!e.ray.intersectPlane(floorPlane, state.point)) return;
    state.moved = true;
    state.point.sub(state.offset);
    const snap = e.shiftKey ? 0.1 : 0;
    const x = snap ? Math.round(state.point.x / snap) * snap : state.point.x,
      z = snap ? Math.round(state.point.z / snap) * snap : state.point.z;
    state.transform = {
      ...object.transform,
      position: [x, object.transform.position[1], z],
    };
    group.current?.position.set(x, object.transform.position[1], z);
    const now = performance.now();
    if (now - state.lastValidation > 45) {
      state.valid = state.session.preview(state.transform).ok;
      state.lastValidation = now;
    }
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (!state.active) return;
    e.stopPropagation();
    state.active = false;
    state.session.preview(state.transform);
    const valid = state.session.release();
    returning.current = !valid;
    if ((e.target as Element).hasPointerCapture?.(e.pointerId))
      (e.target as Element).releasePointerCapture(e.pointerId);
  };
  const cancel = () => {
    if (drag.current.active) {
      drag.current.active = false;
      drag.current.session.cancel();
      returning.current = true;
    }
  };
  const dimensions = object.dimensionsM;
  const labelY = dimensions[1] + 0.2;
  return (
    <group
      ref={group}
      position={object.transform.position}
      quaternion={object.transform.rotation}
      scale={object.transform.scale}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!editor.interaction.getState().dragging)
          editor.interaction.setState({ hoveredId: object.id });
      }}
      onPointerOut={() => {
        if (!editor.interaction.getState().dragging)
          editor.interaction.setState({ hoveredId: null });
      }}
    >
      <mesh position={[0, dimensions[1] / 2, 0]}>
        <boxGeometry args={dimensions} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <Model object={object} />
      {object.category === "lamp" && lamps > 0 && (
        <pointLight
          position={[0, dimensions[1] * 0.86, 0]}
          intensity={0.6 * lamps}
          distance={2.5}
          decay={2}
          color="#ffcd80"
        />
      )}
      <Selection
        ref={outline}
        dimensions={dimensions}
        selected={selected}
        hovered={hovered}
      />
      {object.locked && !selected && (
        <Html
          portal={labelLayer}
          zIndexRange={[2, 0]}
          position={[0, labelY, 0]}
          center
          style={{ pointerEvents: "none" }}
        >
          <span
            className="lock-badge"
            aria-label={`${object.displayName} locked`}
          >
            <LockKeyhole size={10} />
            <span>Locked</span>
          </span>
        </Html>
      )}
      {selected && (
        <Html
          portal={labelLayer}
          position={[0, labelY + 0.12, 0]}
          center
          zIndexRange={[5, 0]}
        >
          <ObjectToolbar object={object} />
        </Html>
      )}
    </group>
  );
});
