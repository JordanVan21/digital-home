import type { RoomShell, SceneSpec } from "@house/contracts";
import { normalizeRoomScan, ScanRejectedError } from "@house/scan-import";
import { fixtureAsset } from "../fixtures/assetCatalog";

const MAX_SCAN_BYTES = 20_000_000;

export type ScanImportOutcome =
  | { ok: true; shell: RoomShell; scene: SceneSpec; warnings: string[] }
  | { ok: false; error: string };

/**
 * Desktop stand-in for the worker's scan-import job: parses a raw RoomPlan export
 * (the JSON the iPhone app shares) and normalizes it with the same pure function
 * the server will run. Catalog assets are fit to the scanned envelope; categories
 * without a verified asset keep a neutral proxy (assetId null).
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
    const { shell, scene, warnings } = normalizeRoomScan(raw, {
      resolveAsset: (category, envelope) => {
        const asset = fixtureAsset(category);
        if (!asset) return null;
        // Fit uniformly inside the scanned envelope, preserving the artist's proportions.
        const fit = Math.min(...envelope.map((n, i) => n / asset.dimensionsM[i]));
        return {
          assetId: asset.id,
          dimensionsM: asset.dimensionsM.map((n) => n * fit) as [number, number, number],
          displayName: asset.title.replace(/ \d+$/, ""),
        };
      },
    });
    return { ok: true, shell, scene, warnings };
  } catch (error) {
    if (error instanceof ScanRejectedError) return { ok: false, error: error.message };
    throw error;
  }
}
