import demoRoom from '@house/contracts/fixtures/demo-room.json';
import demoScan from '@house/contracts/fixtures/demo-scan.json';
import test2Room from '@house/contracts/fixtures/test2-room.json';
import { RoomFixtureSchema, ScanFixtureSchema, type SceneSpec } from '@house/contracts';
import { normalizeShell, reproduceScanObject } from '@house/scene-engine';
import type { AssetCatalog } from '../catalog/AssetCatalog';
import type { ScenePersistence } from '../persistence/ScenePersistence';
import { photoCamera } from '../scene/photoCamera';
import { setScene, type SceneSource } from './store';

/** Scene sources offered by the picker. */
export const SCENE_SOURCES: { id: SceneSource; label: string }[] = [
  { id: 'demo-room', label: 'Demo room' },
  { id: 'demo-scan', label: 'From scan' },
  { id: 'test2', label: 'test2 (photo)' },
];

/** Reference image for scenes reproduced from a photo (dev/demo overlay). */
export const referenceImage: { current: string | null } = { current: null };

const SCAN_SCENE_ID = '5ce70000-0000-4000-8000-000000000002';

/**
 * Scan → scene reproduction (stand-in for the server-side import worker): each RoomPlan object
 * becomes the best-fitting verified catalog asset, or a labelled placeholder, at the scanned pose.
 */
export function sceneFromScan(catalog: AssetCatalog): { shell: ReturnType<typeof normalizeShell>; scene: SceneSpec; name: string } {
  const f = ScanFixtureSchema.parse(demoScan);
  const shell = normalizeShell(f.shell);
  const objects = f.scanObjects.map((so) => reproduceScanObject(so, catalog.list()));
  return {
    name: f.name,
    shell,
    scene: {
      schemaVersion: 1, id: SCAN_SCENE_ID, roomId: f.roomId, shellId: shell.id, revision: 0,
      objects, lightingPreset: 'warm-interior', updatedAt: '2026-10-17T12:00:00.000Z',
    },
  };
}

export async function loadSource(source: SceneSource, catalog: AssetCatalog, persistence: ScenePersistence) {
  let shell;
  let seed: SceneSpec;
  let name: string;
  photoCamera.current = null;
  referenceImage.current = null;
  if (source === 'demo-scan') {
    ({ shell, scene: seed, name } = sceneFromScan(catalog));
  } else {
    const f = RoomFixtureSchema.parse(source === 'test2' ? test2Room : demoRoom);
    shell = normalizeShell(f.shell);
    seed = f.scene;
    name = f.name;
    photoCamera.current = f.photoCamera ?? null;
    referenceImage.current = f.referenceImage ?? null;
  }
  // The latest saved working scene wins over the fixture (reload restores committed state).
  const scene = await persistence.ensureScene(seed, shell);
  setScene({ source, roomName: name, shell, scene, catalog });
}
