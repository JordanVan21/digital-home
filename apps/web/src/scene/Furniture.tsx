import { memo, useEffect, useRef, useState } from "react";
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
  Quaternion,
  Vector3,
} from "three";
import type { SceneObject, Transform } from "@house/contracts";
import {
  snapToSurface,
  tiltedDimensions,
  validateOp,
  yawOf,
  worldYaw,
} from "@house/scene-engine";
import { DragSession, editor } from "../state/editor";
import { Model } from "./Model";
import { CollisionOutline } from "./CollisionOutline";
import { SnapGuide, type SnapGuideHandle } from "./SnapGuide";
import { SwivelRing } from "./SwivelRing";
import { labelLayer } from "./labelLayer";
import { useLighting } from "../theme";
import { ObjectToolbar } from "../components/ObjectToolbar";

const floorPlane = new Plane(new Vector3(0, 1, 0), 0);
const SNAP = Math.PI / 12;
const INVALID = "#e36856";
const target = new Vector3();
const targetQuat = new Quaternion();
const ringQuat = new Quaternion();
const upAxis = new Vector3(0, 1, 0);

export const Furniture = memo(function Furniture({
  object,
  isNew = false,
}: {
  object: SceneObject;
  isNew?: boolean;
}) {
  const selected = useStore(
    editor.interaction,
    (s) => s.selectedId === object.id,
  );
  const hovered = useStore(
    editor.interaction,
    (s) => s.hoveredId === object.id,
  );
  const movePlane = useStore(editor.interaction, (s) => s.movePlane);
  const tool = useStore(editor.interaction, (s) => s.tool);
  const boundingBoxes = useStore(editor.interaction, (s) => s.boundingBoxes);
  const conflict = useStore(editor.draft, (s) => !!s.conflicts[object.id]);
  const resolved = useStore(editor.draft, (s) =>
    s.resolved.includes(object.id),
  );
  const { lamps } = useLighting();
  const [hasShape, setHasShape] = useState(false);
  const [swiveling, setSwiveling] = useState(false);
  const [pulse, setPulse] = useState(false);
  const ringFrame = useRef<Group>(null);
  const group = useRef<Group>(null),
    outline = useRef<Group>(null),
    heightGuide = useRef<Group>(null),
    angleLabel = useRef<HTMLSpanElement>(null);
  const snapGuide = useRef<SnapGuideHandle>(null);
  const drag = useRef({
    session: new DragSession(editor),
    mode: null as "move" | "swivel" | null,
    plane: new Plane(),
    height: false,
    offset: new Vector3(),
    point: new Vector3(),
    lastValidation: 0,
    valid: true,
    startX: 0,
    startY: 0,
    moved: false,
    startYaw: 0,
    startAngle: 0,
    transform: structuredClone(object.transform),
  });
  // Mount at the given transform; afterwards the frame loop eases toward the live scene.
  const initial = useRef(object.transform);
  const latest = useRef(object);
  latest.current = object;

  useEffect(() => {
    if (!resolved) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 1600);
    return () => clearTimeout(t);
  }, [resolved]);

  const endGesture = () => {
    snapGuide.current?.update();
    const state = drag.current;
    if (state.mode === "move") state.session.cancel();
    if (state.mode === "swivel") {
      editor.clearMotion();
      editor.interaction.setState({ dragging: false });
      setSwiveling(false);
    }
    state.mode = null;
  };
  useEffect(() => {
    window.addEventListener("blur", endGesture);
    return () => {
      window.removeEventListener("blur", endGesture);
      endGesture();
    };
  }, []);

  useFrame((_, delta) => {
    const state = drag.current;
    if (state.mode && !editor.interaction.getState().dragging) endGesture();
    if (heightGuide.current) {
      const interaction = editor.interaction.getState();
      heightGuide.current.visible =
        interaction.movePlane === "height" || interaction.heightModifier;
    }
    const g = group.current;
    const preview = editor.interaction.getState().dragging
      ? editor.motion.transforms.get(object.id)
      : undefined;
    if (g && !state.mode && preview) {
      g.position.fromArray(preview.position);
      g.quaternion.fromArray(preview.rotation);
      g.scale.fromArray(preview.scale);
    } else if (g && !state.mode) {
      // Ease toward the piece's transform in the working scene (draft or accepted),
      // so discard, undo and resolver moves glide instead of jumping.
      const live =
        editor.working().objects.find((o) => o.id === object.id) ??
        latest.current;
      g.scale.fromArray(live.transform.scale);
      target.fromArray(live.transform.position);
      targetQuat.fromArray(live.transform.rotation);
      const k = 1 - Math.exp(-delta * 20);
      if (g.position.distanceToSquared(target) > 1e-8)
        g.position.lerp(target, k);
      else g.position.copy(target);
      if (g.quaternion.angleTo(targetQuat) > 1e-4)
        g.quaternion.slerp(targetQuat, k);
      else g.quaternion.copy(targetQuat);
    }
    if (g && ringFrame.current) {
      ringQuat.setFromAxisAngle(upAxis, yawOf(g.quaternion.toArray()));
      ringFrame.current.quaternion
        .copy(g.quaternion)
        .invert()
        .multiply(ringQuat);
    }
    const invalid = state.mode ? !state.valid : conflict;
    if (
      outline.current &&
      (selected || hovered || state.mode || conflict || pulse)
    )
      outline.current.traverse((o) => {
        const color = invalid
          ? INVALID
          : pulse
            ? "#6fcf97"
            : selected
              ? "#9187ff"
              : "#ffffff";
        if (o instanceof LineSegments)
          (o.material as LineBasicMaterial).color.set(color);
        if (o instanceof Mesh)
          (o.material as MeshBasicMaterial).color.set(
            invalid ? "#ff9988" : "#c7c1ff",
          );
      });
  });

  const liveCheck = (transform: Transform) => {
    const state = drag.current;
    const now = performance.now();
    if (now - state.lastValidation > 45) {
      state.valid = validateOp(
        editor.working(),
        { type: "move", objectId: object.id, transform },
        editor.context(),
      ).ok;
      state.lastValidation = now;
    }
  };

  const setMovePlane = (
    e: ThreeEvent<PointerEvent>,
    current: Transform,
    height: boolean,
  ) => {
    const state = drag.current;
    state.height = height;
    if (height) {
      const normal = new Vector3(e.ray.direction.x, 0, e.ray.direction.z);
      if (normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
      state.plane.setFromNormalAndCoplanarPoint(
        normal.normalize(),
        new Vector3(...current.position),
      );
    } else state.plane.set(new Vector3(0, 1, 0), -current.position[1]);
    if (e.ray.intersectPlane(state.plane, state.point))
      state.offset.copy(state.point).sub(new Vector3(...current.position));
  };
  // ----- Move: drag across the floor -----
  const down = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || !editor.scene.getState().ready) return;
    e.stopPropagation();
    editor.select(object.id);
    if (latest.current.locked) {
      editor.notify(
        `${latest.current.displayName} is locked. Unlock it first.`,
      );
      return;
    }
    if (editor.interaction.getState().tool === "rotate") {
      ringDown(e);
      return;
    }
    const state = drag.current;
    if (!state.session.begin(object.id)) return;
    state.mode = "move";
    state.valid = !conflict;
    state.moved = false;
    state.startX = e.clientX;
    state.startY = e.clientY;
    const current = latest.current.transform;
    state.transform = structuredClone(current);
    const interaction = editor.interaction.getState();
    setMovePlane(
      e,
      current,
      interaction.movePlane === "height" || interaction.heightModifier,
    );
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (state.mode === "swivel") return ringMove(e);
    if (state.mode !== "move") return;
    e.stopPropagation();
    const interaction = editor.interaction.getState();
    const height =
      interaction.movePlane === "height" || interaction.heightModifier;
    if (height !== state.height) {
      setMovePlane(e, state.transform, height);
      return;
    }
    if (
      Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < 3 &&
      !state.moved
    )
      return;
    if (!e.ray.intersectPlane(state.plane, state.point)) return;
    state.moved = true;
    state.point.sub(state.offset);
    const snap = e.shiftKey ? 0.1 : 0;
    const current = state.transform;
    const snapped = (n: number) => (snap ? Math.round(n / snap) * snap : n);
    const position: Transform["position"] = state.height
      ? [current.position[0], snapped(state.point.y), current.position[2]]
      : [snapped(state.point.x), current.position[1], snapped(state.point.z)];
    const raw = { ...current, position };
    const contact = e.altKey
      ? { transform: raw }
      : snapToSurface(
          editor.working(),
          latest.current,
          raw,
          editor.context().room,
        );
    state.transform = contact.transform;
    editor.previewMove(object.id, state.transform);
    group.current?.position.fromArray(state.transform.position);
    snapGuide.current?.update(contact.surface, state.transform.position);
    liveCheck(state.transform);
  };
  const up = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (state.mode === "swivel") return ringUp(e);
    if (state.mode !== "move") return;
    e.stopPropagation();
    state.mode = null;
    snapGuide.current?.update();
    state.session.preview(state.transform);
    state.session.release();
    if ((e.target as Element).hasPointerCapture?.(e.pointerId))
      (e.target as Element).releasePointerCapture(e.pointerId);
  };

  // ----- Swivel: drag the ring to rotate freely; Shift snaps to 15° -----
  const pointerAngle = (e: ThreeEvent<PointerEvent>) => {
    const [cx, y, cz] = latest.current.transform.position;
    floorPlane.constant = -y;
    if (!e.ray.intersectPlane(floorPlane, drag.current.point)) return null;
    return Math.atan2(drag.current.point.x - cx, drag.current.point.z - cz);
  };
  const ringDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || latest.current.locked) return;
    e.stopPropagation();
    const angle = pointerAngle(e);
    if (angle === null) return;
    const valid = validateOp(
      editor.working(),
      {
        type: "move",
        objectId: object.id,
        transform: latest.current.transform,
      },
      editor.context(),
      { allowConflicts: true },
    );
    if (!valid.ok) {
      editor.notify(valid.error.message);
      return;
    }
    const state = drag.current;
    state.mode = "swivel";
    state.valid = !conflict;
    state.startYaw = yawOf(latest.current.transform.rotation);
    state.startAngle = angle;
    state.transform = structuredClone(latest.current.transform);
    editor.interaction.setState({ dragging: true });
    setSwiveling(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const ringMove = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (state.mode !== "swivel") return;
    e.stopPropagation();
    const angle = pointerAngle(e);
    if (angle === null) return;
    let yaw = state.startYaw + (angle - state.startAngle);
    if (e.shiftKey) yaw = Math.round(yaw / SNAP) * SNAP;
    const rotation = worldYaw(
      latest.current.transform.rotation,
      yaw - state.startYaw,
    );
    group.current?.quaternion.fromArray(rotation);
    state.transform = { ...latest.current.transform, rotation };
    editor.previewMove(object.id, state.transform);
    const degrees = ((((yaw * 180) / Math.PI) % 360) + 360) % 360;
    if (angleLabel.current)
      angleLabel.current.textContent = `${Math.round(degrees)}°`;
    liveCheck(state.transform);
  };
  const ringUp = (e: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    if (state.mode !== "swivel") return;
    e.stopPropagation();
    endGesture();
    const before = latest.current.transform.rotation;
    if (JSON.stringify(before) !== JSON.stringify(state.transform.rotation))
      editor.suggest({
        type: "move",
        objectId: object.id,
        transform: state.transform,
      });
    if ((e.target as Element).hasPointerCapture?.(e.pointerId))
      (e.target as Element).releasePointerCapture(e.pointerId);
  };

  // Unscaled size after tilt; the group applies the transform scale.
  const dimensions = tiltedDimensions(object.dimensionsM, object.tilt);
  const labelY = dimensions[1] + 0.2;
  return (
    <>
      <group
        ref={group}
        name={`furniture-${object.id}`}
        position={initial.current.position}
        quaternion={initial.current.rotation}
        scale={object.transform.scale}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => endGesture()}
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
        <mesh
          position={[0, dimensions[1] / 2, 0]}
          raycast={hasShape ? () => null : undefined}
        >
          <boxGeometry args={dimensions} />
          <meshBasicMaterial visible={false} />
        </mesh>
        <Model object={object} onShape={setHasShape} />
        {object.category === "lamp" && lamps > 0 && (
          <pointLight
            position={[0, dimensions[1] * 0.86, 0]}
            intensity={0.6 * lamps}
            distance={2.5}
            decay={2}
            color="#ffcd80"
          />
        )}
        {boundingBoxes && <CollisionOutline ref={outline} object={object} />}

        {selected && !object.locked && tool !== "rotate" && (
          <group
            ref={heightGuide}
            name="height-guide"
            visible={movePlane === "height"}
          >
            <mesh
              position={[dimensions[0] / 2 + 0.12, dimensions[1] / 2, 0]}
              raycast={() => null}
            >
              <cylinderGeometry args={[0.008, 0.008, dimensions[1] + 0.5, 8]} />
              <meshBasicMaterial color="#8b84ff" depthTest={false} />
            </mesh>
            {[1, -1].map((direction) => (
              <mesh
                key={direction}
                position={[
                  dimensions[0] / 2 + 0.12,
                  dimensions[1] / 2 + direction * (dimensions[1] / 2 + 0.3),
                  0,
                ]}
                rotation={[direction < 0 ? Math.PI : 0, 0, 0]}
                raycast={() => null}
              >
                <coneGeometry args={[0.045, 0.12, 12]} />
                <meshBasicMaterial color="#8b84ff" depthTest={false} />
              </mesh>
            ))}
          </group>
        )}
        {selected && !object.locked && tool === "rotate" && (
          <group ref={ringFrame} name="world-swivel-frame">
            <SwivelRing
              ref={angleLabel}
              dimensions={dimensions}
              active={swiveling}
              onDown={ringDown}
              onMove={ringMove}
              onUp={ringUp}
              onCancel={() => endGesture()}
            />
          </group>
        )}
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
        {isNew && !selected && (
          <Html
            portal={labelLayer}
            zIndexRange={[2, 0]}
            position={[0, labelY, 0]}
            center
            style={{ pointerEvents: "none" }}
          >
            <span className="new-badge">New</span>
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
      {selected && !object.locked && <SnapGuide ref={snapGuide} />}
    </>
  );
});
