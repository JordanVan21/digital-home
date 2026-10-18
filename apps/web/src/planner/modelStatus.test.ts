import { expect, it } from "vitest";
import { assetById, createFixtureScene } from "@house/contracts";
import { modelKey, modelStatuses } from "./modelStatus";

it("separates loaded models, loading files, missing matches and failed downloads", () => {
  const scene = createFixtureScene();
  const [loaded, waiting] = scene.objects.filter((o) => o.assetId);
  const states = modelStatuses(
    scene,
    assetById,
    new Set([modelKey(loaded)]),
    [],
  );
  expect(states[loaded.id]).toBe("ready");
  expect(states[waiting.id]).toBe("loading");
  expect(states[scene.objects.find((o) => !o.assetId)!.id]).toBe("placeholder");
  const failed = modelStatuses(scene, assetById, new Set(), [
    `http://127.0.0.1:5191${assetById[waiting.assetId!].glbStorageKey}`,
  ]);
  expect(failed[waiting.id]).toBe("failed");
});
