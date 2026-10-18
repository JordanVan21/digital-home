import type { RoomShell, SceneSpec } from "./schemas";
import { createFixtureScene, roomShell } from "./fixtures";

/** A loadable room: its immutable shell plus the arrangement it starts from. */
export type RoomDefinition = {
  roomId: string;
  name: string;
  shell: RoomShell;
  createScene: () => SceneSpec;
};

export const livingRoom: RoomDefinition = {
  roomId: createFixtureScene().roomId,
  name: "Living room",
  shell: roomShell,
  createScene: createFixtureScene,
};

export const rooms: RoomDefinition[] = [livingRoom];

export const roomById = (roomId: string): RoomDefinition | undefined =>
  rooms.find((r) => r.roomId === roomId);
