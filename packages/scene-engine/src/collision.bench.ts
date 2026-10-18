import { bench, describe } from "vitest";
import { assetById, createFixtureScene, fixtureId } from "@house/contracts";
import { objectsCollide } from "./collision";
import { collisionReference } from "./collisionReference.test-utils";
const objects = createFixtureScene().objects;
const desk = structuredClone(objects.find((o) => o.id === fixtureId(109))!);
desk.transform.position = [0, 0, 0];
desk.transform.rotation = [0, 0, 0, 1];
const chair = structuredClone(objects.find((o) => o.id === fixtureId(110))!);
chair.transform.position = [0, 0, 0.5];
chair.transform.rotation = [0, 1, 0, 0];
// Warm the asset tree before measuring repeated interactive queries.
objectsCollide(desk, chair, assetById);
describe("desk / tucked chair (same geometry and tolerance)", () => {
  bench(
    "linear sub-box pairs",
    () => {
      collisionReference(desk, chair, assetById);
    },
    { time: 1000 },
  );
  bench(
    "cached BVH",
    () => {
      objectsCollide(desk, chair, assetById);
    },
    { time: 1000 },
  );
});
