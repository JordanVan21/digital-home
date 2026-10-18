import { forwardRef, useEffect, useMemo } from "react";
import { BufferGeometry, Float32BufferAttribute, Group } from "three";
import { assetById, type SceneObject } from "@house/contracts";

import { colliderBlocks, tiltedDimensions } from "@house/scene-engine";
import { compoundExteriorPositions } from "./compoundOutline";

/** Current collider exterior, mounted inside the furniture's live transform. */
export const CollisionOutline = forwardRef<Group, { object: SceneObject }>(
  function CollisionOutline({ object }, ref) {
    const [w, h, d] = tiltedDimensions(object.dimensionsM, object.tilt);
    const boxes = colliderBlocks(object, assetById);
    const lines = useMemo(() => {
      const geometry = new BufferGeometry().setAttribute(
        "position",
        new Float32BufferAttribute(
          compoundExteriorPositions(boxes, [w, h, d]).slice(),
          3,
        ),
      );
      geometry.scale(w, h, d).translate(-w / 2, 0, -d / 2);
      return geometry;
    }, [boxes, w, h, d]);
    useEffect(() => () => lines.dispose(), [lines]);
    return (
      <group ref={ref} name="collision-outline">
        <lineSegments geometry={lines} raycast={() => null} renderOrder={9}>
          <lineBasicMaterial
            color="#9187ff"
            transparent
            opacity={0.65}
            depthTest={false}
          />
        </lineSegments>
      </group>
    );
  },
);
