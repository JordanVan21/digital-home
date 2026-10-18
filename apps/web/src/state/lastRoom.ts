/** Per-device convenience: reopen the room this viewer had open last. */
const KEY = "house.lastRoom.v1";
export function readLastRoom(): string | undefined {
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
export function rememberRoom(roomId: string) {
  try {
    window.localStorage.setItem(KEY, roomId);
  } catch {
    // Storage may be unavailable; the default room opens instead.
  }
}
