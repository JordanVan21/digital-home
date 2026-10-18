import {
  catalog,
  demoRoomFixture,
  demoScanFixture,
  livingRoom,
  roomFromFixture,
  test2Fixture,
  type RoomDefinition,
} from "@house/contracts";
import { reproduceScanObject } from "@house/scene-engine";

const SCAN_SCENE_ID = "5ce70000-0000-4000-8000-000000000002";

/**
 * The RoomPlan scan reproduced into a scene: a stand-in for the server-side
 * import, matching each scanned object to a catalog asset or a placeholder.
 */
export const scannedStudio: RoomDefinition = {
  roomId: demoScanFixture.roomId,
  name: "Scanned studio",
  shell: demoScanFixture.shell,
  createScene: () => ({
    schemaVersion: 1,
    id: SCAN_SCENE_ID,
    roomId: demoScanFixture.roomId,
    shellId: demoScanFixture.shell.id,
    revision: 0,
    objects: demoScanFixture.scanObjects.map((s) =>
      reproduceScanObject(s, catalog),
    ),
    lightingPreset: "daylight",
    updatedAt: "2026-10-17T12:00:00.000Z",
  }),
};

export const rooms: RoomDefinition[] = [
  livingRoom,
  roomFromFixture(test2Fixture, "test2 · warm living room"),
  roomFromFixture(demoRoomFixture, "Demo studio"),
  scannedStudio,
];

export const roomById = (roomId: string): RoomDefinition | undefined =>
  rooms.find((r) => r.roomId === roomId);
