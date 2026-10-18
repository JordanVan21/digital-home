import { assetById, type SceneObject } from "@house/contracts";
import { useLighting } from "../theme";
import { lightSpecFor } from "./lightBudget";
export function AssetLight({
  object,
  enabled,
  shadow,
}: {
  object: SceneObject;
  enabled: boolean;
  shadow: boolean;
}) {
  const boost = useLighting().lamps,
    light = lightSpecFor(object, assetById);
  if (!enabled || !light || object.lightOn === false) return null;
  return (
    <pointLight
      position={
        light.position.map((n, i) => n * object.dimensionsM[i]) as [
          number,
          number,
          number,
        ]
      }
      color={light.color}
      intensity={light.intensity * boost}
      distance={light.distanceM ?? 4}
      decay={2}
      castShadow={shadow}
      shadow-mapSize={[512, 512]}
      shadow-bias={-0.002}
    />
  );
}
