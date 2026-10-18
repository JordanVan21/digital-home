import {
  RoomFixtureSchema,
  ScanFixtureSchema,
  type RoomFixture,
  type RoomShell,
  type SceneSpec,
} from "./schemas";
import { createFixtureScene, roomShell } from "./fixtures";
import test2Json from "./rooms/test2-room.json";
import demoRoomJson from "./rooms/demo-room.json";
import demoScanJson from "./rooms/demo-scan.json";

/** A loadable room: its immutable shell plus the arrangement it starts from. */
export type RoomDefinition = {
  roomId: string;
  name: string;
  shell: RoomShell;
  createScene: () => SceneSpec;
  photoCamera?: RoomFixture["photoCamera"];
  referenceImage?: string;
};

export const livingRoom: RoomDefinition = {
  roomId: createFixtureScene().roomId,
  name: "Living room",
  shell: roomShell,
  createScene: createFixtureScene,
};

export function roomFromFixture(
  fixture: RoomFixture,
  name = fixture.name,
): RoomDefinition {
  return {
    roomId: fixture.scene.roomId,
    name,
    shell: fixture.shell,
    createScene: () => structuredClone(fixture.scene),
    photoCamera: fixture.photoCamera,
    referenceImage: fixture.referenceImage,
  };
}

// Imported from Jordan's sandbox by scripts/import-jordan-fixtures.mjs.
export const test2Fixture = RoomFixtureSchema.parse(test2Json);
export const demoRoomFixture = RoomFixtureSchema.parse(demoRoomJson);
export const demoScanFixture = ScanFixtureSchema.parse(demoScanJson);
