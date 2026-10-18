import type { RoomShell, SceneSpec } from "@house/contracts";
import { normalizeRoomScan, ScanRejectedError } from "@house/scan-import";

const MAX_SCAN_BYTES = 20_000_000;

export type ScanImportOutcome =
  | { ok: true; shell: RoomShell; scene: SceneSpec; warnings: string[] }
  | { ok: false; error: string };

/**
 * Debug loader standing in for the Database/render-agent hand-off: parses a raw
 * RoomPlan export (the JSON the iPhone app shares) and normalizes it with the same
 * pure function the server will run. Objects stay positioned data with
 * assetId null; matching them to 3D assets belongs to the render agent.
 */
export async function importScanFile(file: File): Promise<ScanImportOutcome> {
  if (file.size > MAX_SCAN_BYTES) return { ok: false, error: "Scan file is too large." };
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    return { ok: false, error: "That file isn't a valid scan (not JSON)." };
  }
  try {
    const { shell, scene, warnings } = normalizeRoomScan(raw);
    return { ok: true, shell, scene, warnings };
  } catch (error) {
    if (error instanceof ScanRejectedError) return { ok: false, error: error.message };
    throw error;
  }
}
